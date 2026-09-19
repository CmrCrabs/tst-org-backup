const EXT_ID = browser.runtime.getManifest().browser_specific_settings.gecko.id;

let toggleBackupBox = document.getElementById("toggleBackup");
let writtenLabel = document.getElementById("writtenLabel");
let timeoutInput = document.getElementById("timeoutInput");

async function updateTST() {
    await browser.runtime.sendMessage(EXT_ID, { type: "updateTST" });
}

async function updateLocal() {
    await browser.runtime.sendMessage(EXT_ID, { type: "updateLocal" });
}

async function updateTimeout() {
    await browser.runtime.sendMessage(EXT_ID, {
        type: "updateTimeout",
        value: timeoutInput.value,
    });
}

async function toggleBackup() {
    let toggleBtn = document.getElementById("toggleBackup");

    switch (toggleBtn.checked) {
        case true:
            await browser.runtime.sendMessage(EXT_ID, { type: "BackupOn" });
            break;
        case false:
            await browser.runtime.sendMessage(EXT_ID, { type: "BackupOff" });
            break;
    }
}

async function getStatus() {
    let status = await browser.runtime.sendMessage(EXT_ID, { type: "statusUpdate" }).catch((e) => {
        console.log("Background script has not been started.");
    });
    return status;
}

function statusLabel(message) {
    switch (message) {
        case "pending":
            return "Write is pending.";
        case "written":
            return "Current state has been written.";
        case "suspended":
            return "Writing suspended, manual intervention required.";
    }
}

function onMessage(message, sender, sendResponse) {
    switch (sender.id) {
        case EXT_ID:
            switch (message) {
                case "pending":
                case "written":
                case "suspended":
                    writtenLabel.innerHTML = statusLabel(message);
                    break;
                case "backupOn":
                    toggleBackupBox.checked = true;
                    break;
                case "backupOff":
                    toggleBackupBox.checked = false;
                    break;
            }
            break;
    }
}
browser.runtime.onMessage.addListener(onMessage);

getStatus().then((status) => {
    toggleBackupBox.checked = status.autoBackup;
    writtenLabel.innerHTML = statusLabel(status.writtenState);
    timeoutInput.value = status.timeout;
});

document.getElementById("updateTSTBtn").addEventListener("click", updateTST);
document.getElementById("updateLocalBtn").addEventListener("click", updateLocal);
toggleBackupBox.addEventListener("click", toggleBackup);
timeoutInput.addEventListener("change", updateTimeout);
