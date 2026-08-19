/* GET /api/health — deploy verification for the backend layer:
   confirms the function runs and whether the D1 binding is live. */
export async function onRequestGet({ env }) {
  let db = "unbound", events = null;
  if (env.DB) {
    try {
      const r = await env.DB.prepare("SELECT COUNT(*) n FROM events").first();
      db = "ok"; events = r.n;
    } catch (e) { db = "error: " + (e.message || e); }
  }
  return new Response(JSON.stringify({ ok: true, db, events, read_token_set: !!env.READ_TOKEN }),
    { headers: { "content-type": "application/json" } });
}
