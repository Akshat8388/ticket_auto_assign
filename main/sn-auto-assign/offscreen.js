// ---- ServiceNow Auto-Assign: offscreen audio player ----
// Plays a short chime when a ticket is grabbed. Runs in an extension
// "offscreen document" so it isn't subject to a webpage's autoplay
// restrictions (which would otherwise block audio in a background tab).

function playChime() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const now = ctx.currentTime;

  const notes = [
    { freq: 880, start: 0, duration: 0.12 },   // A5
    { freq: 1320, start: 0.1, duration: 0.18 } // E6
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
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "playSound") {
    playChime();
  }
});
