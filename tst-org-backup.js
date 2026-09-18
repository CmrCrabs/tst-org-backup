const TST_ID = "treestyletab@piro.sakura.ne.jp";
const EXT_ID = browser.runtime.getManifest().browser_specific_settings.gecko.id;

const onErr = (e) => {
    console.error(e);
};

browser.runtime.onMessageExternal.addListener(onMessageExternal);
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    onMessage(message, sender, sendResponse).catch(onErr);
    return true;
});

browser.tabs.onRemoved.addListener(() => {
    updateWrittenState("pending");
    debounce(updateLocalState, timeout);
});
browser.tabs.onMoved.addListener(() => {
    updateWrittenState("pending");
    debounce(updateLocalState, timeout);
});
browser.tabs.onUpdated.addListener(
    () => {
        updateWrittenState("pending");
        debounce(updateLocalState, timeout);
    },
    { properties: ["status", "pinned"] },
);

browser.runtime.onStartup.addListener(onStartup);
browser.runtime.onInstalled.addListener(onInstalled);

registerToTST();
let timeout = (await browser.storage.local.get("timeout")).timeout;

// TODO fix debouncing

function onInstalled() {
    browser.storage.local.set({ timeout: 3000 });
}

function onStartup() {
    updateWrittenState("suspended");
    updateBackupState(false);
}

async function registerToTST() {
    const result = await browser.runtime
        .sendMessage(TST_ID, {
            type: "register-self",
            name: browser.i18n.getMessage("tst-org-backup"),
            icons: browser.runtime.getManifest().icons,
            listeningTypes: [
                "wait-for-shutdown",
                "ready",
                "permissions-changed",
                "tree-attached",
                "tree-detached",
            ],
            allowBulkMessaging: true,
            style: ` `,
            permissions: ["tabs"],
        })
        .catch(onErr);
    console.log("Registered to TST");

    browser.runtime
        .sendMessage(TST_ID, {
            type: "wait-for-shutdown",
        })
        .finally(() => {
            console.log("TST has been shutdown.");
        });
}

async function readTSTTabs() {
    let raw_tree = await browser.runtime.sendMessage(TST_ID, {
        type: "get-tree",
        window: 0,
        tabs: "*",
    });

    return raw_tree.map((t) => ({
        id: t.id,
        indent: t.indent,
        index: t.index,
        pinned: t.pinned,
        url: t.url,
        title: t.title,
    }));
}

function generateOrg(tabs) {
    return tabs
        .map((t) => `${"*".repeat(t.indent + 1)} ${t.pinned ? "PINNED " : ""}[[${t.url}][${t.title}]]`)
        .join("\n");
}

async function readLocalFile() {
    let response = await fetch("http://localhost:8080/tst-org-backup/read-file").catch(onErr);
    return await response.text();
}

async function readTimestamp() {
    let response = await fetch("http://localhost:8080/tst-org-backup/read-timestamp").catch(onErr);
    let responseStr = await response.text();
    return parseInt(responseStr.replaceAll(" ", ""));
}

async function writeEmacs(body) {
    let response = await fetch("http://localhost:8080/tst-org-backup/write", {
        method: "POST",
        headers: {
            "Content-Type": "text/plain",
        },
        body: body,
    }).then((r) => r.text(), onErr);
    return response;
}

function debounce(callback, wait) {
    let timeoutId = null;
    return (...args) => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
            console.log("executing callback");
            callback(...args);
        }, wait);
    };
}

function parseOrg(org) {
    return org
        .split("\n")
        .filter((l) => l[0] === "*")
        .map((line, index) => {
            let l = line.split("[");
            return {
                indent: l[0].split(" ").at(0).trim().length - 1,
                id: null,
                pinned: l[0].includes("PINNED"),
                index: index,
                url: l[2].slice(0, -1),
                title: l[3].slice(0, -2),
            };
        });
}

async function updateLocalState(override = false) {
    let autoBackup = (await browser.storage.local.get("autoBackup")).autoBackup;
    if (autoBackup || override) {
        console.log("Attempting Local File Write...");
        let writable = await Writable();

        if (writable || override) {
            let tabs = await readTSTTabs();
            let org = generateOrg(tabs);
            let response = await writeEmacs(org);
            console.log(response);

            await updateModificationTime();
        } else {
            console.log("...Write stopped, writing suspended.");
        }
    }
    updateWrittenState((await Writable()) ? "written" : "suspended");
}

async function updateTSTState() {
    let org = await readLocalFile();
    let localTabs = parseOrg(org);
    let tstTabs = await readTSTTabs();

    // TODO open , pin, indent

    console.log("Synced TST state with local file.");

    await updateModificationTime();
    updateWrittenState((await Writable()) ? "written" : "suspended");
}

async function updateModificationTime() {
    let timestamp = await readTimestamp();
    await browser.storage.local.set({ modificationTime: timestamp });
}

async function updateBackupState(state) {
    let autoBackup = (await browser.storage.local.get("autoBackup")).autoBackup;
    if (autoBackup != state) {
        await browser.storage.local.set({ autoBackup: state });

        console.log(`Auto Backups have been ${state ? "enabled" : "disabled"}.`);
        browser.runtime
            .sendMessage("tst-org-backup@zfazam", `${state ? "backupOn" : "backupOff"}`)
            .catch((e) => {
                console.log("Can't update popup's state (closed).");
            });
    }
}

async function updateWrittenState(state) {
    let writtenState = (await browser.storage.local.get("writtenState")).writtenState;
    if (writtenState != state) {
        await browser.storage.local.set({ writtenState: state });

        browser.runtime.sendMessage("tst-org-backup@zfazam", state).catch((e) => {
            console.log("Can't update popup's state (closed).");
        });
    }
}

async function Writable() {
    let timestamp = await readTimestamp();
    let savedTimestamp = await browser.storage.local.get("modificationTime");
    return timestamp === savedTimestamp.modificationTime;
}

async function onMessageExternal(message, sender) {
    switch (sender.id) {
        case TST_ID:
            if (message && message.messages) {
                for (const oneMessage of message.messages) {
                    onMessageExternal(oneMessage, sender);
                }
            }
            switch (message && message.type) {
                case "permissions-changed":
                case "ready":
                    registerToTST();
                    break;
                case "tree-attached":
                case "tree-detached":
                    await updateWrittenState("pending");
                    debounce(updateLocalState, timeout);
                    break;
            }
            break;
    }
}

async function onMessage(message, sender, sendResponse) {
    switch (sender.id) {
        case EXT_ID:
            let writtenState = (await browser.storage.local.get("writtenState")).writtenState;
            let autoBackup = (await browser.storage.local.get("autoBackup")).autoBackup;
            let timeout = (await browser.storage.local.get("timeout")).timeout;
            switch (message.type) {
                case "statusUpdate":
                    sendResponse({
                        writtenState: writtenState,
                        autoBackup: autoBackup,
                        timeout: timeout,
                    });
                    break;
                case "updateTST":
                    updateTSTState();
                    sendResponse("success");
                    break;
                case "updateLocal":
                    updateLocalState(true);
                    sendResponse("success");
                    break;

                case "updateTimeout":
                    browser.storage.local.set({ timeout: message.value });
                    console.log(message.value);
                    sendResponse("success");
                    break;
                case "BackupOn":
                    updateBackupState(true);

                    if (writtenState === "pending") {
                        updateLocalState();
                    }
                    sendResponse("success");
                    break;
                case "BackupOff":
                    updateBackupState(false);
                    sendResponse("success");
                    break;
            }
            break;
    }
}
