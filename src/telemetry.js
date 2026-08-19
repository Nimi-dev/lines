/* Telemetry client (v6.6): offline-first event stream to /api/log.
   - queue persists in STORE (localStorage) so nothing is lost offline
   - flush is batched, retried, and fired on visibility loss via sendBeacon
   - all ids are random; the data is the user's own, on the user's own infra.
   Logging must NEVER affect gameplay: every call is wrapped and best-effort. */
import { makeEvent, appendToQueue, takeBatch, randomId } from "./telemetry-core.js";

const QKEY = "lines-tel-queue-v1";
const DKEY = "lines-tel-device-v1";

export const createTelemetry = ({ store, appVer, endpoint = "/api/log", fetchFn }) => {
  let queue = [];
  let deviceId = null;
  const sessionId = randomId();
  let loaded = false, flushing = false, timer = null;
  const doFetch = fetchFn || ((...a) => fetch(...a));

  const persist = async () => { try { if (store) await store.set(QKEY, JSON.stringify(queue)); } catch (e) {} };

  const load = async () => {
    if (loaded) return; loaded = true;
    try {
      const d = store && (await store.get(DKEY));
      if (d && d.value) deviceId = d.value;
      else { deviceId = randomId(); if (store) await store.set(DKEY, deviceId); }
    } catch (e) { deviceId = deviceId || randomId(); }
    try { const q = store && (await store.get(QKEY)); if (q && q.value) queue = JSON.parse(q.value); } catch (e) {}
    schedule(3000);
  };

  const log = (type, data) => {
    try {
      if (!deviceId) deviceId = randomId();
      const e = makeEvent(type, data, { newId: randomId, now: () => Date.now(), deviceId, sessionId, appVer });
      queue = appendToQueue(queue, e);
      persist();
      schedule(type === "snapshot" ? 500 : 5000);
    } catch (err) {}
  };

  const flush = async () => {
    if (flushing || !queue.length) return;
    flushing = true;
    try {
      const { batch, rest } = takeBatch(queue, 100);
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (res && res.ok) { queue = rest; await persist(); if (queue.length) schedule(1500); }
      else schedule(60000); // server unhappy — back off, keep the queue
    } catch (e) { schedule(60000); } // offline — retry later, data is safe
    flushing = false;
  };

  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(flush, ms); };

  const beacon = () => {
    try {
      if (!queue.length || typeof navigator === "undefined" || !navigator.sendBeacon) return;
      const { batch, rest } = takeBatch(queue, 100);
      if (navigator.sendBeacon(endpoint, new Blob([JSON.stringify({ events: batch })], { type: "application/json" }))) {
        queue = rest; persist();
      }
    } catch (e) {}
  };

  return { load, log, flush, beacon, _state: () => ({ queue, deviceId, sessionId }) };
};
