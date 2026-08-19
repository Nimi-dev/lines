// Round-trip audit: a synthetic training state pushed through the export
// serializer and back through the restore parser must reproduce itself exactly
// (positions, days, via-doors, run records, lifetime). This is the user's
// backup path across origins — it must never break.
//
// buildExport/parseImport below are faithful ports of buildExport/doImport in
// src/app.jsx (they live inside the Gauntlet component and close over React
// state, so they cannot be imported directly; the app file must not be
// refactored). The source-anchor checks at the bottom fail this tool if the
// app-side implementations drift — keep the ports in sync.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadApp } from "./_load.mjs";

const app = await loadApp();
const { RUNS, REP, APP_VER, dayInfo } = app;

/* ---- port of buildExport (src/app.jsx, Gauntlet) ---- */
function buildExport({ conf, days, lifeRuns, lifeClean }) {
  const positions = {};
  for (const r of RUNS) r.userKeys.forEach((k2, j2) => {
    if (!positions[k2]) positions[k2] = { at: r.id + "@" + (j2 + 1), move: (REP.user[k2] || {}).san || "?", runs: [] };
    if (positions[k2].runs.indexOf(r.id) < 0) positions[k2].runs.push(r.id);
  });
  const runsDict = {};
  RUNS.forEach((r) => { runsDict[r.sig] = { id: r.id, label: r.label, pack: r.packId, kind: r.kind, moves: r.sans.filter(Boolean).join(" ") }; });
  const mastery = {};
  Object.keys(conf).forEach((k2) => {
    const at = (positions[k2] || { at: "off-tree" }).at;
    const r = conf[k2];
    mastery[at] = { c: Math.round(r.c * 100) / 100, seen: r.seen || 0, miss: r.miss || 0, cracks: r.cracks || 0, via: r.via || {}, move: (positions[k2] || {}).move, sharedBy: (positions[k2] || { runs: [] }).runs.length };
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
    _schema: "mastery[pos].c: confidence 0-1 (proven>=0.8; +0.4*(1-c) on first clean hand-play per day; *0.25 on miss). via[door]=[handEncounters,misses] keyed by the opponent move that led in. days[date].plays[run]={m:misses,u:handMoves,ff:fastForwarded,fx:fixedOnRedo}. Positions labeled runId@userPlyIndex.",
    meta: { app: APP_VER, exported: new Date().toISOString(), runs: RUNS.length, positions: REP.totalUser, lifetime: { runs: lifeRuns, clean: lifeClean } },
    runs: runsDict,
    mastery,
    days: daysX,
  };
}

/* ---- port of doImport (src/app.jsx, Gauntlet); setters become returned state ---- */
function parseImport(txt) {
  try {
    const d = JSON.parse(txt);
    const at2key = {}, id2sig = {};
    for (const r of RUNS) {
      id2sig[r.id] = r.sig;
      r.userKeys.forEach((k2, j2) => { const at = r.id + "@" + (j2 + 1); if (!at2key[at]) at2key[at] = k2; });
    }
    if (d.mastery) {
      const nc = {};
      Object.keys(d.mastery).forEach((at) => {
        const k2 = at2key[at]; if (!k2) return;
        const m = d.mastery[at];
        nc[k2] = { c: m.c || 0, seen: m.seen || 0, miss: m.miss || 0, cracks: m.cracks || 0, via: m.via || {} };
      });
      const nd = {};
      Object.keys(d.days || {}).forEach((ds) => {
        const rec = d.days[ds] || {}; const plays = {};
        Object.keys(rec.plays || {}).forEach((id) => { const sg = id2sig[id]; if (sg) plays[sg] = rec.plays[id]; });
        nd[ds] = { plays, cracks: (rec.cracks || []).map((at) => at2key[at]).filter(Boolean) };
      });
      const nh = {}, nm = {};
      Object.keys(nc).forEach((k2) => {
        if ((nc[k2].seen || 0) > (nc[k2].miss || 0)) nh[k2] = true;
        if (nc[k2].miss) nm[k2] = nc[k2].miss;
      });
      const lt = (d.meta || {}).lifetime || {};
      return { ok: true, nc, nd, nh, nm, lifeRuns: lt.runs || 0, lifeClean: lt.clean || 0 };
    }
    return { ok: false, msg: "unrecognized format" };
  } catch (e) { return { ok: false, msg: "could not parse" }; }
}

/* ---- synthetic training state over the real tree ---- */
assert.ok(RUNS.length > 0, "RUNS is empty");
const conf = {}, days = {};
let n = 0;
for (const r of RUNS) {
  r.userKeys.forEach((k2, j2) => {
    if (conf[k2]) return;
    n++;
    if (n % 3 === 0) return; // leave a third of the tree untrained
    const opp = REP.opp[k2] || [];
    const via = {};
    if (j2 > 0 && opp.length) via[opp[0].san || opp[0].m] = [1 + (n % 4), n % 2];
    conf[k2] = { c: Math.round(((n * 7) % 100)) / 100, seen: 1 + (n % 6), miss: n % 3, cracks: n % 2, via };
  });
}
const sigs = RUNS.map((r) => r.sig);
days["2026-08-15"] = {
  plays: { [sigs[0]]: { m: 0, u: RUNS[0].uCount, ff: 2, fx: 0 }, [sigs[1]]: { m: 2, u: RUNS[1].uCount, ff: 0, fx: 1 } },
  cracks: [RUNS[1].userKeys[1]],
};
days["2026-08-17"] = {
  plays: Object.fromEntries(sigs.slice(0, 5).map((sg, i) => [sg, { m: i % 2, u: RUNS[i].uCount, ff: i, fx: 0 }])),
  cracks: [RUNS[0].userKeys[0], RUNS[4].userKeys[2]],
};
const state = { conf, days, lifeRuns: 57, lifeClean: 31 };

/* ---- the round trip ---- */
const exported = JSON.stringify(buildExport(state));
const r = parseImport(exported);
assert.ok(r.ok, "restore parser rejected a fresh export");

assert.deepStrictEqual(r.nc, conf, "mastery state (positions/via-doors) did not round-trip exactly");
const expectedDays = Object.fromEntries(Object.entries(days).map(([ds, rec]) => [ds, { plays: rec.plays, cracks: rec.cracks }]));
assert.deepStrictEqual(r.nd, expectedDays, "day records did not round-trip exactly");
assert.equal(r.lifeRuns, 57, "lifetime runs lost");
assert.equal(r.lifeClean, 31, "lifetime clean lost");

// run records: every run appears in the export with its identity intact
const ex = JSON.parse(exported);
for (const run of RUNS) {
  const rec = ex.runs[run.sig];
  assert.ok(rec, `run ${run.id} missing from export run records`);
  assert.equal(rec.id, run.id);
  assert.equal(rec.pack, run.packId);
  assert.equal(rec.kind, run.kind);
}
// addresses must be unambiguous: distinct positions never share an at-label
const ats = new Set();
for (const at of Object.keys(ex.mastery)) {
  assert.ok(!ats.has(at), `duplicate position address ${at}`);
  ats.add(at);
}

/* ---- source anchors: fail loudly if the app-side serializer/parser drift ---- */
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app.jsx"), "utf8");
for (const anchor of [
  'at: r.id + "@" + (j2 + 1)',
  'const at2key = {}, id2sig = {};',
  'nc[k2] = { c: m.c || 0, seen: m.seen || 0, miss: m.miss || 0, cracks: m.cracks || 0, via: m.via || {} };',
  'mastery[at] = { c: Math.round(r.c * 100) / 100, seen: r.seen || 0, miss: r.miss || 0, cracks: r.cracks || 0, via: r.via || {}',
]) {
  assert.ok(src.includes(anchor), `src/app.jsx serializer/parser changed (anchor not found: ${anchor}) — update the ports in tools/roundtrip.mjs to match`);
}

console.log(`roundtrip: ${Object.keys(conf).length} positions, ${Object.keys(days).length} days, ${RUNS.length} run records — exact state equality after export→restore.`);
