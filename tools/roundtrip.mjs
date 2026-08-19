// Round-trip audit (v6.3 schema): a synthetic training state pushed through the
// export serializer and back through the restore parser must reproduce itself
// exactly (positions, H/last/relearn, via-doors, event logs, days, run records,
// lifetime) — on the default tree AND the extended (learned-packs) tree.
// Also: a v6.2-era export (c-based confidence) must still restore as a seed.
//
// buildExport/parseImport below are faithful ports of buildExport/doImport in
// src/app.jsx (they live inside the Gauntlet component and close over React
// state). The source-anchor checks at the bottom fail this tool if the
// app-side implementations drift — keep the ports in sync.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadApp } from "./_load.mjs";

const app = await loadApp();
const { APP_VER, dayInfo, buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS } = app;
const { retrievability, seedFromConf } = await import("../src/scoring.js");

/* ---- port of buildExport (src/app.jsx, Gauntlet) ---- */
function buildExport(T, { conf, days, lifeRuns, lifeClean, learnedSigs = {} }) {
  const RUNS = T.RUNS, REP = T.REP;
  const positions = {};
  for (const r of RUNS) r.userKeys.forEach((k2, j2) => {
    if (!positions[k2]) positions[k2] = { at: r.id + "@" + (j2 + 1), move: (REP.user[k2] || {}).san || "?", runs: [] };
    if (positions[k2].runs.indexOf(r.id) < 0) positions[k2].runs.push(r.id);
  });
  const runsDict = {};
  RUNS.forEach((r) => { runsDict[r.sig] = { id: r.id, label: r.label, pack: r.packId, kind: r.kind, side: r.side, moves: r.sans.filter(Boolean).join(" ") }; });
  const mastery = {};
  const nowX = Date.now();
  Object.keys(conf).forEach((k2) => {
    const at = (positions[k2] || { at: "off-tree" }).at;
    const r = conf[k2];
    mastery[at] = { H: Math.round((r.H || 0) * 100) / 100, last: r.last ? new Date(r.last).toISOString() : null,
      R: Math.round(retrievability(r, nowX) * 100) / 100, relearn: !!r.relearn,
      seen: r.seen || 0, miss: r.miss || 0, cracks: r.cracks || 0, via: r.via || {}, ev: r.ev || [],
      move: (positions[k2] || {}).move, sharedBy: (positions[k2] || { runs: [] }).runs.length };
  });
  const daysX = {};
  Object.keys(days).forEach((ds) => {
    const rec = days[ds] || {};
    const plays = {};
    Object.keys(rec.plays || {}).forEach((sg) => { plays[(runsDict[sg] || { id: sg }).id] = rec.plays[sg]; });
    daysX[ds] = { plays, cracks: (rec.cracks || []).map((k2) => (positions[k2] || { at: "?" }).at) };
    const inf = dayInfo(days, ds);
    if (inf) daysX[ds].summary = inf;
  });
  return {
    meta: { app: APP_VER, exported: new Date().toISOString(), runs: RUNS.length, positions: REP.totalUser, lifetime: { runs: lifeRuns, clean: lifeClean } },
    runs: runsDict, mastery, days: daysX,
    learn: { learned: learnedSigs },
  };
}

/* ---- port of doImport (src/app.jsx, Gauntlet); setters become returned state ---- */
function parseImport(T, txt) {
  try {
    const d = JSON.parse(txt);
    const at2key = {}, id2sig = {};
    for (const r of T.RUNS) {
      id2sig[r.id] = r.sig;
      r.userKeys.forEach((k2, j2) => { const at = r.id + "@" + (j2 + 1); if (!at2key[at]) at2key[at] = k2; });
    }
    if (d.mastery) {
      const nc = {};
      Object.keys(d.mastery).forEach((at) => {
        const k2 = at2key[at]; if (!k2) return;
        const m = d.mastery[at];
        nc[k2] = m.H != null
          ? { H: m.H || 0, last: m.last ? Date.parse(m.last) : 0, relearn: !!m.relearn, seen: m.seen || 0, miss: m.miss || 0, cracks: m.cracks || 0, via: m.via || {}, ev: m.ev || [] }
          : seedFromConf(m.c || 0, m.seen, m.miss, m.cracks, m.via, Date.now());
      });
      const nd = {};
      Object.keys(d.days || {}).forEach((ds) => {
        const rec = d.days[ds] || {}; const plays = {};
        Object.keys(rec.plays || {}).forEach((id) => { const sg = id2sig[id]; if (sg) plays[sg] = rec.plays[id]; });
        nd[ds] = { plays, cracks: (rec.cracks || []).map((at) => at2key[at]).filter(Boolean) };
      });
      const lt = (d.meta || {}).lifetime || {};
      return { ok: true, nc, nd, lifeRuns: lt.runs || 0, lifeClean: lt.clean || 0, learned: (d.learn || {}).learned || {} };
    }
    return { ok: false };
  } catch (e) { return { ok: false }; }
}

/* ---- run the round trip on a tree ---- */
function roundtrip(T, label) {
  assert.ok(T.RUNS.length > 0, "RUNS is empty");
  const conf = {}, days = {};
  const base = Date.parse("2026-08-01T09:00:00Z");
  let n = 0;
  for (const r of T.RUNS) {
    r.userKeys.forEach((k2, j2) => {
      if (conf[k2]) return;
      n++;
      if (n % 3 === 0) return; // leave a third untrained
      const opp = T.REP.opp[k2] || [];
      const door = j2 > 0 && opp.length ? (opp[0].san || opp[0].m) : "start";
      const via = { [door]: [1 + (n % 4), n % 2] };
      const ev = [[Math.round((base + n * 8.64e7) / 60000), n % 2, door, 700 + n * 13], [Math.round((base + (n + 1) * 8.64e7) / 60000), 1, door, 950]];
      conf[k2] = { H: Math.round((0.5 + (n % 17) * 0.83) * 100) / 100, last: base + (n % 9) * 8.64e7,
        relearn: n % 7 === 0, seen: 1 + (n % 6), miss: n % 3, cracks: n % 2, via, ev };
    });
  }
  const sigs = T.RUNS.map((r) => r.sig);
  days["2026-08-15"] = {
    plays: { [sigs[0]]: { m: 0, u: T.RUNS[0].uCount, ff: 2, fx: 0 }, [sigs[1]]: { m: 2, u: T.RUNS[1].uCount, ff: 0, fx: 1 } },
    cracks: [T.RUNS[1].userKeys[1]],
  };
  days["2026-08-17"] = {
    plays: Object.fromEntries(sigs.slice(0, 5).map((sg, i) => [sg, { m: i % 2, u: T.RUNS[i].uCount, ff: i, fx: 0 }])),
    cracks: [T.RUNS[0].userKeys[0], T.RUNS[4].userKeys[2]],
  };
  const learnedSigs = { [T.RUNS[0].sig]: 1755500000000, [T.RUNS[2].sig]: 1755500001000 };
  const state = { conf, days, lifeRuns: 57, lifeClean: 31, learnedSigs };

  const exported = JSON.stringify(buildExport(T, state));
  const r = parseImport(T, exported);
  assert.ok(r.ok, "restore parser rejected a fresh export");
  assert.deepStrictEqual(r.nc, conf, `[${label}] memory state (H/last/relearn/via/ev) did not round-trip exactly`);
  const expectedDays = Object.fromEntries(Object.entries(days).map(([ds, rec]) => [ds, { plays: rec.plays, cracks: rec.cracks }]));
  assert.deepStrictEqual(r.nd, expectedDays, `[${label}] day records did not round-trip exactly`);
  assert.equal(r.lifeRuns, 57); assert.equal(r.lifeClean, 31);
  assert.deepStrictEqual(r.learned, learnedSigs, `[${label}] learned-lines set did not round-trip`);

  const ex = JSON.parse(exported);
  for (const run of T.RUNS) {
    const rec = ex.runs[run.sig];
    assert.ok(rec, `[${label}] run ${run.id} missing from export run records`);
    assert.equal(rec.id, run.id); assert.equal(rec.pack, run.packId); assert.equal(rec.kind, run.kind);
  }
  const ats = new Set();
  for (const at of Object.keys(ex.mastery)) { assert.ok(!ats.has(at), `duplicate position address ${at}`); ats.add(at); }
  return { positions: Object.keys(conf).length, runs: T.RUNS.length };
}

const dflt = roundtrip(buildTree(CORE_PACK_IDS), "core");
const full = roundtrip(buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]), "core+learned");
const blk = roundtrip(buildTree(app.BLACK_PACK_IDS, "black"), "black");

/* ---- v6.2 export still restores (best-effort seed) ---- */
{
  const T = buildTree(CORE_PACK_IDS);
  const at = T.RUNS[0].id + "@1";
  const legacy = JSON.stringify({ mastery: { [at]: { c: 0.85, seen: 9, miss: 1, cracks: 0, via: { start: [9, 1] } } }, days: {}, meta: { lifetime: { runs: 5, clean: 2 } } });
  const r = parseImport(T, legacy);
  assert.ok(r.ok && r.nc[T.RUNS[0].userKeys[0]], "v6.2 export must still restore");
  const rec = r.nc[T.RUNS[0].userKeys[0]];
  assert.equal(rec.H, 3, "proven v6.2 position should seed H=3d");
  assert.equal(rec.seen, 9); assert.equal(rec.via.start[0], 9);
  assert.equal(r.lifeRuns, 5);
}

/* ---- source anchors: fail loudly if the app-side serializer/parser drift ---- */
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app.jsx"), "utf8");
for (const anchor of [
  'at: r.id + "@" + (j2 + 1)',
  'const at2key = {}, id2sig = {};',
  'mastery[at] = { H: Math.round((r.H || 0) * 100) / 100, last: r.last ? new Date(r.last).toISOString() : null,',
  '? { H: m.H || 0, last: m.last ? Date.parse(m.last) : 0, relearn: !!m.relearn, seen: m.seen || 0, miss: m.miss || 0, cracks: m.cracks || 0, via: m.via || {}, ev: m.ev || [] }',
  ': seedFromConf(m.c || 0, m.seen, m.miss, m.cracks, m.via, Date.now())',
  'learn: { learned: LEARN.state().learned }',
  'if (d.learn && d.learn.learned) LEARN.replace(d.learn.learned);',
]) {
  assert.ok(src.includes(anchor), `src/app.jsx serializer/parser changed (anchor not found: ${anchor}) — update the ports in tools/roundtrip.mjs to match`);
}

console.log(`roundtrip: exact equality on core (${dflt.positions} pos/${dflt.runs} runs), core+learned (${full.positions}/${full.runs}), black (${blk.positions}/${blk.runs}); v6.2 exports seed correctly.`);
