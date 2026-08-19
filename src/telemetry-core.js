/* Telemetry core (v6.6) — pure logic shared by the client (src/telemetry.js
   wraps it with STORE + fetch) and the server-side validator, so the whole
   pipeline is testable in Node (tools/telemetry-test.mjs).

   Design constraints:
   - Events are the EXPERIENCE LOG: enough for a future analysis session to
     reconstruct what the user saw, did, and got back — without guessing.
   - Offline-first: events queue locally and flush in batches; the app never
     blocks on the network and never loses data to a dead connection.
   - Idempotent ingest: every event carries a client-generated id; the server
     upserts, so retries and double-flushes cannot duplicate history. */

export const EVENT_TYPES = [
  "app_open",        // { ver }
  "hand_play",       // { key, run, ply, clean, door, latMs, R, H, owned } — one per hand-tested position
  "run_end",         // { run, misses, hand, ff, clean, cracks, redo }
  "day_complete",    // { date, runs, misses, acc, clean }
  "learn_walk",      // { run }
  "learn_try",       // { run, slips, passed }
  "learn_done",      // { run } — line entered the gauntlet
  "restore",         // { positions, days, source }
  "games_analysis",  // { side, games, coverage, leaks, misses } — summary only
  "snapshot",        // { mem, days, learn, lifetime } — full state, periodic
];

export const makeEvent = (type, data, ctx) => {
  if (!EVENT_TYPES.includes(type)) throw new Error("unknown event type: " + type);
  return {
    id: ctx.newId(),               // client-unique; server upserts on it
    t: Math.round(ctx.now()),      // ms epoch
    type,
    dev: ctx.deviceId,             // random per-install id
    ses: ctx.sessionId,            // random per-app-open id
    ver: ctx.appVer,
    data: data || {},
  };
};

/* validation used verbatim by the ingest endpoint */
export const validateEvent = (e) => {
  if (!e || typeof e !== "object") return "not an object";
  if (typeof e.id !== "string" || e.id.length < 8 || e.id.length > 64) return "bad id";
  if (!EVENT_TYPES.includes(e.type)) return "bad type";
  if (!Number.isFinite(e.t) || e.t < 1700000000000 || e.t > 4100000000000) return "bad timestamp";
  if (typeof e.dev !== "string" || e.dev.length < 8 || e.dev.length > 64) return "bad device";
  if (typeof e.ses !== "string" || e.ses.length < 4 || e.ses.length > 64) return "bad session";
  if (typeof e.ver !== "string" || e.ver.length > 24) return "bad ver";
  const payload = JSON.stringify(e.data || {});
  if (payload.length > 200000) return "payload too large"; // snapshots are the big ones
  return null;
};

export const validateBatch = (body) => {
  if (!body || !Array.isArray(body.events)) return { error: "events[] required" };
  if (body.events.length === 0 || body.events.length > 200) return { error: "1..200 events per batch" };
  const bad = [];
  const ok = [];
  for (const e of body.events) {
    const err = validateEvent(e);
    if (err) bad.push({ id: e && e.id, err });
    else ok.push(e);
  }
  return { ok, bad };
};

/* client-side queue fold: append, cap, and drain logic (storage-agnostic) */
export const QUEUE_CAP = 500; // oldest non-snapshot events drop first beyond this
export const appendToQueue = (queue, event) => {
  const q = [...queue, event];
  if (q.length <= QUEUE_CAP) return q;
  const idx = q.findIndex((e) => e.type !== "snapshot");
  return idx >= 0 ? [...q.slice(0, idx), ...q.slice(idx + 1)] : q.slice(1);
};
export const takeBatch = (queue, n = 100) => ({ batch: queue.slice(0, n), rest: queue.slice(n) });

export const randomId = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
