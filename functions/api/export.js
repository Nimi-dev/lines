/* GET /api/export?token=…&since=<ms>&type=<type>&limit=<n>&format=ndjson|json
   The experience stream, for analysis sessions. Guarded by READ_TOKEN (a
   Pages secret) — training data leaves the database only with the token.
   Default: newest-first JSON; ndjson streams oldest-first for pipelines. */
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "no database bound" }, 503);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!env.READ_TOKEN || token !== env.READ_TOKEN) return json({ error: "unauthorized" }, 401);

  const since = Number(url.searchParams.get("since") || 0);
  const type = url.searchParams.get("type");
  const limit = Math.min(Number(url.searchParams.get("limit") || 2000), 10000);
  const ndjson = url.searchParams.get("format") === "ndjson";

  const where = ["t >= ?1"]; const binds = [since];
  if (type) { where.push("type = ?2"); binds.push(type); }
  const order = ndjson ? "ASC" : "DESC";
  const q = `SELECT id, t, type, dev, ses, ver, data FROM events WHERE ${where.join(" AND ")} ORDER BY t ${order} LIMIT ${limit}`;
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  const rows = results.map((r) => ({ ...r, data: safeParse(r.data) }));

  if (ndjson) {
    return new Response(rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      { headers: { "content-type": "application/x-ndjson" } });
  }
  const counts = await env.DB.prepare("SELECT type, COUNT(*) n FROM events GROUP BY type").all();
  return json({ total_by_type: Object.fromEntries(counts.results.map((r) => [r.type, r.n])), count: rows.length, events: rows });
}

const safeParse = (s) => { try { return JSON.parse(s); } catch (e) { return s; } };
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
