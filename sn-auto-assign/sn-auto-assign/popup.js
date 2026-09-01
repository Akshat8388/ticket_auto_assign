const $ = (id) => document.getElementById(id);

const ICONS = {
  assigned: "✅",
  error: "⚠️",
  skip: "⏭️",
  info: "ℹ️"
};

async function load() {
  const cfg = await chrome.storage.local.get(["assigneeName", "pollMinutes", "running", "log"]);
  $("assigneeName").value = cfg.assigneeName || self.SN_DEFAULTS.assigneeName;
  $("pollMinutes").value = cfg.pollMinutes || self.SN_DEFAULTS.pollMinutes;
  setRunningUI(!!cfg.running);
  renderLog(cfg.log || []);
}

function setRunningUI(running) {
  const btn = $("toggle");
  btn.textContent = running ? "Stop Monitoring" : "Start Monitoring";
  btn.className = running ? "stop" : "";
  $("statusDot").className = "dot" + (running ? " running" : "");
  $("statusText").textContent = running ? "Running" : "Stopped";
}

function renderLog(log) {
  const el = $("log");
  if (!log || log.length === 0) {
    el.innerHTML = '<div class="empty-log">No activity yet.</div>';
    return;
  }
  const recent = log.slice(0, 3);
  el.innerHTML = "";
  for (const e of recent) {
    const div = document.createElement("div");
    div.className = "entry " + (e.type || "info");
    const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const icon = ICONS[e.type] || ICONS.info;
    const msg = e.type === "assigned" ? `Grabbed ${e.number}` : (e.message || "");
    div.innerHTML = `<span class="icon">${icon}</span><span class="time">${time}</span><span class="msg">${msg}</span>`;
    el.appendChild(div);
  }
}

$("assigneeName").addEventListener("change", (e) => {
  chrome.storage.local.set({ assigneeName: e.target.value.trim() });
});

$("pollMinutes").addEventListener("change", (e) => {
  chrome.storage.local.set({ pollMinutes: parseFloat(e.target.value) || 1 });
});

$("toggle").addEventListener("click", async () => {
  const cfg = await chrome.storage.local.get(["running"]);
  const next = !cfg.running;
  await chrome.storage.local.set({ running: next });
  setRunningUI(next);
});

$("clearLog").addEventListener("click", async () => {
  await chrome.storage.local.set({ log: [] });
  renderLog([]);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.log) renderLog(changes.log.newValue || []);
  if (changes.running) setRunningUI(!!changes.running.newValue);
});

load();
