import { setTimeout } from "node:timers/promises";

// The full dev stack launches its own catalog service on this port. Concurrently
// stops this process if the service exits during setup or the stack is stopped.
const healthUrl = "http://127.0.0.1:8010/api/health";
console.log(`Waiting for the local Gaia catalog service at ${healthUrl}`);

while (true) {
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) })
    .catch(() => null);
  await response?.body?.cancel().catch(() => {});
  if (response?.ok) break;
  await setTimeout(500);
}
