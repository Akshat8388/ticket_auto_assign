// ---- ServiceNow Auto-Assign: unified content script ----
// Runs in EVERY frame on the domain (all_frames:true) because ServiceNow's
// Next Experience shell reuses generic iframe URLs (e.g. welcome.do) and
// swaps content into them via AJAX, so we can't rely on the frame's own
// location.href to know what's inside it. Instead we look at the actual
// DOM: if we see list rows, treat this frame as the queue list; if we see
// the assigned_to field, treat it as a ticket form.

// Continuous alert loop: once a ticket is grabbed, keep chiming every few
// seconds in whichever ServiceNow tab(s) are open, until the person clicks
// "Stop Alert" in the popup. Runs once per real tab (guarded to the
// top-level frame) so nested iframes don't multiply the sound.
if (window === window.top) {
  setInterval(async () => {
    try {
      const { ringing } = await chrome.storage.local.get(["ringing"]);
      if (ringing) playChime();
    } catch (e) {
      // extension context may be briefly unavailable during navigation
    }
  }, 3000);
}

(async function () {
  // Safety net: if a save just happened and this page reloaded before our
  // setTimeout got to fire, this flag (persisted in storage) survives that
  // reload and bounces us back to the queue on the very next page load.
  const { pendingReturnToQueue } = await chrome.storage.local.get(["pendingReturnToQueue"]);
  if (pendingReturnToQueue) {
    await chrome.storage.local.set({ pendingReturnToQueue: false });
    const { queueListUrl } = await chrome.storage.local.get(["queueListUrl"]);
    window.location.href = queueListUrl || self.SN_DEFAULTS.queueListUrl;
    return;
  }

  const rows = document.querySelectorAll("tr.list_row");
  if (rows.length > 0) {
    await handleListPage(rows);
    return;
  }

  const assignedToField = document.querySelector('input[id="sys_display.incident.assigned_to"]');
  if (assignedToField) {
    await handleFormPage();
    return;
  }
})();

function findAssignedToColumnIndex() {
  const candidates = document.querySelectorAll("th, td");
  for (const el of candidates) {
    if (el.tagName === "TH" && el.textContent.trim() === "Assigned to") {
      return [...el.parentElement.children].indexOf(el);
    }
  }
  return null;
}

async function handleListPage(rows) {
  const cfg = await chrome.storage.local.get(["running"]);
  if (!cfg.running) return;

  console.log("[SN Auto-Assign] list frame detected, rows:", rows.length);

  const assignedIdx = findAssignedToColumnIndex();
  console.log("[SN Auto-Assign] assigned-to column index:", assignedIdx);

  if (assignedIdx === null) {
    chrome.runtime.sendMessage({
      type: "listScan",
      found: false,
      error: "Could not locate the 'Assigned to' column header on this list."
    });
    return;
  }

  for (const row of rows) {
    const cells = [...row.children];
    const cell = cells[assignedIdx];
    if (!cell) continue;

    const cellText = cell.textContent.trim().toLowerCase();
    const isEmpty = cell.querySelector("a") === null && (cellText === "" || cellText === "(empty)");
    if (isEmpty) {
      const link = row.querySelector("a.formlink") || row.querySelector('a[href*="incident.do?sys_id="]');
      if (link && link.href) {
        const locked = await claimLock(link.href);
        if (!locked) {
          console.log("[SN Auto-Assign] already being processed elsewhere, skipping:", link.href);
          continue;
        }
        console.log("[SN Auto-Assign] unassigned row found, opening:", link.href);
        await chrome.storage.local.set({ pendingAssign: true });
        window.location.href = link.href;
        return;
      }
    }
  }

  console.log("[SN Auto-Assign] no unassigned rows this pass.");
  chrome.runtime.sendMessage({ type: "listScan", found: false });
}

function extractSysId(url) {
  const match = url.match(/sys_id=([a-f0-9]{32})/i);
  return match ? match[1] : url;
}

async function claimLock(ticketUrl, lockMs = 20000) {
  const key = extractSysId(ticketUrl);
  const { processingLocks } = await chrome.storage.local.get(["processingLocks"]);
  const locks = processingLocks || {};
  const now = Date.now();

  // Clean up expired locks while we're here
  for (const k of Object.keys(locks)) {
    if (now - locks[k] > lockMs) delete locks[k];
  }

  if (locks[key] && now - locks[key] < lockMs) {
    return false; // someone else claimed this ticket recently
  }

  locks[key] = now;
  await chrome.storage.local.set({ processingLocks: locks });
  return true;
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [
      { freq: 880, start: 0, duration: 0.12 },
      { freq: 1320, start: 0.1, duration: 0.18 }
    ];
    notes.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.25, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    });
    setTimeout(() => ctx.close(), 600);
  } catch (e) {
    console.log("[SN Auto-Assign] could not play chime:", e.message);
  }
}

async function typeIntoField(input, text, delayMs = 80) {
  input.focus();
  input.value = "";
  for (const char of text) {
    input.value += char;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
    await new Promise((r) => setTimeout(r, delayMs));
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function returnToQueue(delayMs) {
  await chrome.storage.local.set({ pendingReturnToQueue: true });
  setTimeout(async () => {
    const { queueListUrl } = await chrome.storage.local.get(["queueListUrl"]);
    window.location.href = queueListUrl || self.SN_DEFAULTS.queueListUrl;
  }, delayMs);
}

async function finish(result, delayMs = 1500) {
  console.log("[SN Auto-Assign] form result:", result);
  chrome.runtime.sendMessage({ type: "formResult", result });
  await returnToQueue(delayMs);
}

async function handleFormPage() {
  const cfg = await chrome.storage.local.get(["pendingAssign", "queueListUrl", "assigneeName"]);
  if (!cfg.pendingAssign) return;
  await chrome.storage.local.set({ pendingAssign: false });

  console.log("[SN Auto-Assign] form frame detected, attempting assign...");

  const input = document.querySelector('input[id="sys_display.incident.assigned_to"]');
  if (!input) {
    await finish({ __snAssign: "error", message: "assigned_to input not found on form." });
    return;
  }

  const existing = input.value.trim();
  if (existing) {
    await finish({ __snAssign: "skip", message: `Already assigned to ${existing}.` });
    return;
  }

  const assigneeName = cfg.assigneeName || self.SN_DEFAULTS.assigneeName;

  // Type it out like a real keystroke sequence, so ServiceNow's own
  // debounced lookup starts counting from the last character typed
  // rather than a single instantaneous value change.
  await typeIntoField(input, assigneeName);

  // Give the AJAX resolve lookup time to finish after the last keystroke.
  await new Promise((r) => setTimeout(r, 1800));

  const saveBtn = document.querySelector("#sysverb_update_and_stay");
  if (!saveBtn) {
    await finish({ __snAssign: "error", message: "Save button (#sysverb_update_and_stay) not found." });
    return;
  }

  const numberField =
    document.querySelector('input[id="sys_display.incident.number"]') ||
    document.querySelector('input[id="sys_readonly.incident.number"]') ||
    document.querySelector('input[id="incident.number"]');
  const number = numberField ? numberField.value : "(unknown)";

  saveBtn.click();
  await chrome.storage.local.set({ ringing: true, ringingNumber: number });

  await finish({ __snAssign: "assigned", number, ticketUrl: window.location.href }, 2500);
}
