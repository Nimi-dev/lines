// Retrodiction harness: a scoring model is secretly a miss predictor — so test
// it as one. Replays per-position event vectors (from a v6.3 export) through
// candidate models; before each event, each model predicts P(recall); Brier
// score against what actually happened. The v6.3 model must beat the nulls.
//
// Usage: node tools/retrodict.mjs [path/to/export.json]
// With no export (or too little data) it runs on a synthetic forgetful-student
// log as a self-test, so the harness itself stays verified in CI.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEM, retrievability, foldResult } from "../src/scoring.js";

const MODELS = {
  "v6.3 (H,R)": () => {
    let rec = null;
    return { predict: (t) => (rec ? retrievability(rec, t) : 0.1),
      update: (t, clean, door) => { rec = foldResult(rec, clean, t, door).rec; } };
  },
  "null: flat 3-day": () => {
    let last = 0;
    return { predict: (t) => (last ? (t - last < 3 * 86400000 ? 0.9 : 0.3) : 0.1),
      update: (t) => { last = t; } };
  },
  "null: always 0.7": () => ({ predict: () => 0.7, update: () => {} }),
  "null: frequency": () => {
    let seen = 0, ok = 0;
    return { predict: () => (seen ? ok / seen : 0.1), update: (t, clean) => { seen++; if (clean) ok++; } };
  },
};

function evalModels(positions) {
  const brier = {}, n = {};
  for (const name of Object.keys(MODELS)) { brier[name] = 0; n[name] = 0; }
  for (const ev of positions) {
    const inst = {};
    for (const name of Object.keys(MODELS)) inst[name] = MODELS[name]();
    for (const [tMin, clean, door] of ev) {
      const t = tMin * 60000;
      for (const name of Object.keys(MODELS)) {
        const p = inst[name].predict(t);
        brier[name] += (p - (clean ? 1 : 0)) ** 2; n[name]++;
        inst[name].update(t, clean, door);
      }
    }
  }
  const out = {};
  for (const name of Object.keys(MODELS)) out[name] = n[name] ? brier[name] / n[name] : null;
  return { out, events: Object.values(n)[0] || 0 };
}

// load export if given
let positions = null, source = "synthetic";
const path = process.argv[2];
if (path) {
  try {
    const d = JSON.parse(readFileSync(path, "utf8"));
    positions = Object.values(d.mastery || {}).map((m) => m.ev || []).filter((ev) => ev.length >= 3);
    source = `${path} (${positions.length} positions with ≥3 events)`;
    if (positions.reduce((a, ev) => a + ev.length, 0) < 40) { positions = null; source += " — too thin, using synthetic"; }
  } catch (e) { console.error("could not read export:", e.message); }
}
if (!positions) {
  // synthetic forgetful student: true memory follows an H-like process with noise —
  // NOT the same constants as the model, so this is a fair (if friendly) test.
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  positions = [];
  const t0 = 1755000000000;
  // gaps mix same-day bursts with long absences — the regime where timing-blind
  // baselines (like per-position frequency) cannot follow the memory dynamics
  const GAPS = [0.002, 0.02, 0.3, 1, 1, 2, 5, 12, 25]; // days
  for (let p = 0; p < 80; p++) {
    let trueH = 0.4 + rnd() * 0.8, last = 0, t = t0 + rnd() * 86400000;
    const ev = [];
    const sessions = 8 + Math.floor(rnd() * 10);
    for (let i = 0; i < sessions; i++) {
      const pRecall = last ? Math.pow(2, -((t - last) / 86400000) / trueH) : 0.2;
      const clean = rnd() < 0.08 + 0.88 * pRecall; // small guessing floor + memory
      ev.push([Math.round(t / 60000), clean ? 1 : 0, "start"]);
      if (clean) trueH *= 1 + 1.8 * (1 - pRecall); else trueH = Math.max(0.1, trueH * 0.35);
      last = t;
      t += GAPS[Math.floor(rnd() * GAPS.length)] * 86400000;
    }
    positions.push(ev);
  }
}

const { out, events } = evalModels(positions);
console.log(`retrodict: ${source} · ${events} predictions`);
const ranked = Object.entries(out).sort((a, b) => a[1] - b[1]);
for (const [name, b] of ranked) console.log(`  ${b.toFixed(4)}  ${name}`);
if (source === "synthetic") {
  assert.equal(ranked[0][0], "v6.3 (H,R)", "the v6.3 model must beat every null on the synthetic log");
  console.log("retrodict: v6.3 model beats all null baselines (synthetic self-test).");
} else {
  console.log(ranked[0][0] === "v6.3 (H,R)"
    ? "v6.3 model wins on your real history."
    : `⚠ ${ranked[0][0]} predicts your misses better than the live model — investigate before v6.4.`);
}
