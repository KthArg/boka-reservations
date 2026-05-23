const ALIVE_INTERVAL_MS = 30_000;

function logAlive() {
  console.log(`[worker] alive — ${new Date().toISOString()}`);
}

logAlive();
setInterval(logAlive, ALIVE_INTERVAL_MS);
