/* POST /api/log — telemetry ingest (Cloudflare Pages Function, D1-backed).
   Body: { events: [ {id, t, type, dev, ses, ver, data}, ... ] } (≤200/batch).
   Idempotent: INSERT OR REPLACE on the client-generated event id, so client
   retries can never duplicate history. Same-origin only (the PWA); no PII —
   the payload is the user's own training data on the user's own account. */
import { validateBatch } from "../../src/telemetry-core.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "no database bound" }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }
  const { ok, bad, error } = validateBatch(body);
  if (error) return json({ error }, 400);
  if (ok.length) {
    const stmt = env.DB.prepare(
      "INSERT OR REPLACE INTO events (id, t, type, dev, ses, ver, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    );
    await env.DB.batch(ok.map((e) => stmt.bind(e.id, e.t, e.type, e.dev, e.ses, e.ver, JSON.stringify(e.data || {}))));
  }
  return json({ stored: ok.length, rejected: bad });
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
