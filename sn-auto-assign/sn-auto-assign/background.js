importScripts("constants.js");

// ---- ServiceNow Auto-Assign: background service worker ----

const ALARM_NAME = "sn-reload";

async function getConfig() {
  const cfg = await chrome.storage.local.get([
    "queueListUrl",
    "pollMinutes",
    "running",
    "workerTabId",
    "log"
  ]);
  return {
    queueListUrl: cfg.queueListUrl || self.SN_DEFAULTS.queueListUrl,
    pollMinutes: cfg.pollMinutes || self.SN_DEFAULTS.pollMinutes,
    running: !!cfg.running,
    workerTabId: cfg.workerTabId || null,
    log: cfg.log || []
  };
}

async function pushLog(entry) {
  const { log } = await getConfig();
  const newLog = [{ ts: new Date().toISOString(), ...entry }, ...log].slice(0, 50);
  await chrome.storage.local.set({ log: newLog });
}

async function ensureWorkerTab() {
  const cfg = await getConfig();
  if (!cfg.queueListUrl) return null;

  if (cfg.workerTabId) {
    try {
      const tab = await chrome.tabs.get(cfg.workerTabId);
      if (tab) return tab.id;
    } catch {
      // tab no longer exists, fall through to create a new one
    }
  }

  const tab = await chrome.tabs.create({ url: cfg.queueListUrl, active: false });
  await chrome.storage.local.set({ workerTabId: tab.id });
  return tab.id;
}

async function startMonitoring() {
  const cfg = await getConfig();
  if (!cfg.queueListUrl) {
    await pushLog({ type: "error", message: "Set the queue list URL first." });
    return;
  }
  await ensureWorkerTab();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(cfg.pollMinutes, 1) });
  await pushLog({ type: "info", message: "Monitoring started." });
}

async function stopMonitoring() {
  chrome.alarms.clear(ALARM_NAME);
  await pushLog({ type: "info", message: "Monitoring stopped." });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const cfg = await getConfig();
  if (!cfg.running) return;
  const tabId = await ensureWorkerTab();
  if (tabId) {
    try {
      await chrome.tabs.reload(tabId);
    } catch (err) {
      await pushLog({ type: "error", message: `Reload failed: ${err.message}` });
    }
  }
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.running) {
    if (changes.running.newValue) startMonitoring();
    else stopMonitoring();
  }
});

// Content scripts report results here for the popup log
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "formResult") {
    const r = msg.result || {};
    if (r.__snAssign === "assigned") {
      pushLog({ type: "assigned", number: r.number || "(unknown)" });
      chrome.notifications.create("", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `Ticket grabbed: ${r.number || ""}`,
        message: "Assigned to you and saved"
      });
    } else if (r.__snAssign === "skip") {
      pushLog({ type: "info", message: r.message || "Ticket already assigned, skipped." });
    } else {
      pushLog({ type: "error", message: r.message || "Unknown form result." });
    }
  } else if (msg.type === "listScan") {
    if (msg.found === false) {
      // quiet heartbeat, no unassigned tickets this pass
    } else if (msg.error) {
      pushLog({ type: "error", message: msg.error });
    }
  }
});
