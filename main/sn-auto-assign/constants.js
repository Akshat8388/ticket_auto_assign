// ---- Shared defaults, loaded before background.js and popup.js ----
// Baked in so a freshly-loaded unpacked extension (new folder = new storage)
// doesn't need these re-typed. Still fully editable from the popup.
self.SN_DEFAULTS = {
  queueListUrl:
    "https://gsk.service-now.com/now/nav/ui/classic/params/target/incident_list.do%3Fsysparm_query%3Dactive%253Dtrue%255EGOTOassignment_group.nameSTARTSWITHGiGi%255Eassigned_toISEMPTY%26sysparm_first_row%3D1%26sysparm_view%3D",
  assigneeName: "Akshat Bhardwaj",
  pollMinutes: 1
};
