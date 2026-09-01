// ---- ServiceNow Auto-Assign: unified content script ----
// Runs in EVERY frame on the domain (all_frames:true) because ServiceNow's
// Next Experience shell reuses generic iframe URLs (e.g. welcome.do) and
// swaps content into them via AJAX, so we can't rely on the frame's own
// location.href to know what's inside it. Instead we look at the actual
// DOM: if we see list rows, treat this frame as the queue list; if we see
// the assigned_to field, treat it as a ticket form.

(async function () {
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

    const isEmpty = cell.querySelector("a") === null && cell.textContent.trim() === "";
    if (isEmpty) {
      const link = row.querySelector("a.formlink") || row.querySelector('a[href*="incident.do?sys_id="]');
      if (link && link.href) {
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

async function returnToQueue(delayMs) {
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

  // Mirrors the tested Playwright flow: click, select-all, fill, wait for
  // ServiceNow's own AJAX to auto-resolve the reference field, then save.
  input.focus();
  input.value = assigneeName;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await new Promise((r) => setTimeout(r, 1500));

  const saveBtn = document.querySelector("#sysverb_update_and_stay");
  if (!saveBtn) {
    await finish({ __snAssign: "error", message: "Save button (#sysverb_update_and_stay) not found." });
    return;
  }

  const numberField = document.querySelector('input[id="sys_display.incident.number"]');
  const number = numberField ? numberField.value : "(unknown)";

  saveBtn.click();

  await finish({ __snAssign: "assigned", number }, 2500);
}
