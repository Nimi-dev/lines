// Verifies the telemetry pipeline end to end in Node: event validation, the
// offline queue (cap + snapshot preservation), the client's flush/backoff
// against a mock network, and both Pages Functions against a mock D1.
import assert from "node:assert/strict";
import { EVENT_TYPES, makeEvent, validateEvent, validateBatch, appendToQueue, takeBatch, QUEUE_CAP, randomId } from "../src/telemetry-core.js";
import { createTelemetry } from "../src/telemetry.js";
import { onRequestPost } from "../functions/api/log.js";
import { onRequestGet as exportGet } from "../functions/api/export.js";
import { onRequestGet as healthGet } from "../functions/api/health.js";

const ctx = { newId: randomId, now: () => 1755600000000, deviceId: "dev-12345678", sessionId: "ses-1234", appVer: "v6.6·git" };

// 1. events + validation
{
  const e = makeEvent("hand_play", { key: "k", clean: 1, latMs: 812 }, ctx);
  assert.equal(validateEvent(e), null);
  assert.throws(() => makeEvent("nonsense", {}, ctx));
  assert.equal(validateEvent({ ...e, t: 99 }), "bad timestamp");
  assert.equal(validateEvent({ ...e, dev: "x" }), "bad device");
  const vb = validateBatch({ events: [e, { ...e, id: "short" }] });
  assert.equal(vb.ok.length, 1); assert.equal(vb.bad.length, 1);
  assert.ok(validateBatch({}).error && validateBatch({ events: [] }).error);
}

// 2. queue: cap drops oldest non-snapshot first, snapshots survive
{
  let q = [];
  q = appendToQueue(q, makeEvent("snapshot", { big: 1 }, ctx));
  for (let i = 0; i < QUEUE_CAP + 50; i++) q = appendToQueue(q, makeEvent("hand_play", { i }, ctx));
  assert.equal(q.length, QUEUE_CAP);
  assert.equal(q[0].type, "snapshot", "snapshots must survive the cap");
  const { batch, rest } = takeBatch(q, 100);
  assert.equal(batch.length, 100); assert.equal(rest.length, QUEUE_CAP - 100);
}

// 3. client: flush drains on success, retains on failure, persists via store
{
  const kv = {};
  const store = { get: async (k) => (kv[k] == null ? null : { value: kv[k] }), set: async (k, v) => { kv[k] = String(v); } };
  let served = [], failNext = false;
  const fetchFn = async (url, opts) => {
    if (failNext) { failNext = false; throw new Error("offline"); }
    served.push(...JSON.parse(opts.body).events);
    return { ok: true };
  };
  const tel = createTelemetry({ store, appVer: "v6.6·git", fetchFn });
  await tel.load();
  tel.log("app_open", { ver: "v6.6·git" });
  tel.log("hand_play", { key: "k1", clean: 1 });
  await tel.flush();
  assert.equal(served.length, 2);
  assert.equal(tel._state().queue.length, 0);
  failNext = true;
  tel.log("run_end", { run: "MIE·F1", misses: 0 });
  await tel.flush();
  assert.equal(tel._state().queue.length, 1, "failed flush must retain the queue");
  await tel.flush();
  assert.equal(tel._state().queue.length, 0);
  // device id persists across instances
  const tel2 = createTelemetry({ store, appVer: "v6.6·git", fetchFn });
  await tel2.load();
  assert.equal(tel2._state().deviceId, tel._state().deviceId, "device id must persist");
  assert.notEqual(tel2._state().sessionId, tel._state().sessionId, "session ids differ per open");
}

// 4. ingest function against a mock D1
function mockDB(rows = []) {
  const stored = new Map(rows.map((r) => [r.id, r]));
  const db = {
    stored,
    prepare: (sql) => ({
      sql,
      bind: (...args) => ({ sql, args,
        all: async () => {
          if (sql.includes("GROUP BY type")) {
            const by = {}; for (const r of stored.values()) by[r.type] = (by[r.type] || 0) + 1;
            return { results: Object.entries(by).map(([type, n]) => ({ type, n })) };
          }
          let rs = [...stored.values()].filter((r) => r.t >= (args[0] || 0));
          if (sql.includes("type = ?2")) rs = rs.filter((r) => r.type === args[1]);
          rs.sort((a, b) => (sql.includes("ASC") ? a.t - b.t : b.t - a.t));
          return { results: rs.map((r) => ({ ...r, data: JSON.stringify(r.data) })) };
        },
        first: async () => ({ n: stored.size }),
      }),
      all: async () => ({ results: (() => { const by = {}; for (const r of stored.values()) by[r.type] = (by[r.type] || 0) + 1; return Object.entries(by).map(([type, n]) => ({ type, n })); })() }),
      first: async () => ({ n: stored.size }),
    }),
    batch: async (stmts) => { for (const st of stmts) { const [id, t, type, dev, ses, ver, data] = st.args; stored.set(id, { id, t, type, dev, ses, ver, data: JSON.parse(data) }); } },
  };
  return db;
}
{
  const DB = mockDB();
  const e1 = makeEvent("hand_play", { key: "k" }, ctx);
  const req = (body) => ({ request: { json: async () => body }, env: { DB } });
  let res = await onRequestPost(req({ events: [e1, e1] })); // duplicate in one batch
  let out = JSON.parse(await res.text());
  assert.equal(out.stored, 2); assert.equal(DB.stored.size, 1, "upsert: same id stores once");
  res = await onRequestPost(req({ events: [e1] })); // retry
  assert.equal(DB.stored.size, 1, "retry cannot duplicate");
  res = await onRequestPost(req({ events: [{ bad: true }] }));
  out = JSON.parse(await res.text());
  assert.equal(out.stored, 0); assert.equal(out.rejected.length, 1);
  res = await onRequestPost({ request: { json: async () => { throw new Error("x"); } }, env: { DB } });
  assert.equal(res.status, 400);
  res = await onRequestPost({ request: { json: async () => ({ events: [e1] }) }, env: {} });
  assert.equal(res.status, 503, "unbound DB must 503, never lose silently");
}

// 5. export function: token gate + filtering
{
  const DB = mockDB();
  await onRequestPost({ request: { json: async () => ({ events: [
    makeEvent("hand_play", { key: "a" }, ctx),
    makeEvent("run_end", { run: "MIE·F1" }, { ...ctx, now: () => 1755600100000 }),
  ] }) }, env: { DB } });
  const call = (qs, env) => exportGet({ request: { url: "https://x/api/export?" + qs }, env: { DB, READ_TOKEN: "sekrit", ...env } });
  let res = await call("token=wrong");
  assert.equal(res.status, 401);
  res = await call("token=sekrit");
  let out = JSON.parse(await res.text());
  assert.equal(out.count, 2);
  assert.equal(out.events[0].type, "run_end", "default order newest-first");
  assert.deepStrictEqual(out.total_by_type, { hand_play: 1, run_end: 1 });
  res = await call("token=sekrit&type=hand_play");
  out = JSON.parse(await res.text());
  assert.equal(out.count, 1);
  res = await call("token=sekrit&format=ndjson");
  const lines = (await res.text()).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).type, "hand_play", "ndjson streams oldest-first");
  // no READ_TOKEN configured -> locked shut, not open
  res = await exportGet({ request: { url: "https://x/api/export?token=" }, env: { DB } });
  assert.equal(res.status, 401, "missing READ_TOKEN secret must fail closed");
}

// 6. health
{
  const res = await healthGet({ env: { DB: mockDB(), READ_TOKEN: "x" } });
  const out = JSON.parse(await res.text());
  assert.ok(out.ok && out.db === "ok" && out.read_token_set);
}

console.log(`telemetry: ${EVENT_TYPES.length} event types — validation, offline queue, client flush/backoff, idempotent ingest, token-gated export all verified.`);
