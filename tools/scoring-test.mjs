// Machine-checks of the v6.3 memory model's derived properties (see the brief
// in CLAUDE.md's design doctrine and src/scoring.js). These are the properties
// the design chat demanded with numbers attached — not vibes.
import assert from "node:assert/strict";
import { MEM, retrievability, foldResult, owned } from "../src/scoring.js";

const DAY = 86400000, MIN = 60000;
const t0 = Date.parse("2026-08-19T08:00:00Z");

// 1. cold ✓ decays below OWN by roughly the next day (identifiability: a lucky
//    guess is crowned for less than a day, then must be confirmed spaced)
{
  const { rec } = foldResult(null, true, t0, "start");
  assert.equal(rec.H, MEM.H0);
  const Rnext = retrievability(rec, t0 + DAY);
  assert.ok(Rnext < MEM.OWN, `cold ✓ still owned next day (R=${Rnext.toFixed(3)})`);
  assert.ok(retrievability(rec, t0 + 6 * 3600000) >= MEM.OWN, "cold ✓ should survive the same session");
}

// 2. same-minute repeats earn ~nothing (the seven-reps complaint, derived)
{
  let { rec } = foldResult(null, true, t0, "start");
  const h1 = rec.H;
  for (let i = 1; i <= 7; i++) ({ rec } = foldResult(rec, true, t0 + i * MIN, "start"));
  assert.ok(rec.H < h1 * 1.05, `7 same-minute reps grew H by ${(100 * (rec.H / h1 - 1)).toFixed(1)}% (should be ≈0)`);
}

// 3. spaced success at low R earns the most (desirable difficulty)
{
  const { rec } = foldResult(null, true, t0, "start");
  const spaced = foldResult(rec, true, t0 + 2 * DAY, "start").rec;   // hard retrieval
  const cramme = foldResult(rec, true, t0 + 10 * MIN, "start").rec;  // trivial retrieval
  assert.ok(spaced.H > cramme.H * 2, "spaced hard recall must outgrow a crammed one");
}

// 4. daily-success trajectory reaches multi-day stability within a week, and
//    the schedule spaces itself out (H grows monotonically)
{
  let rec = null, t = t0, prevH = 0;
  for (let d = 0; d < 7; d++) {
    ({ rec } = foldResult(rec, true, t, "start"));
    assert.ok(rec.H > prevH, "H must grow on spaced successes");
    prevH = rec.H; t += DAY;
  }
  assert.ok(rec.H > 5, `a week of daily successes should own multi-day stability (H=${rec.H.toFixed(1)}d)`);
  assert.ok(rec.H < 60, "a week of successes must not overshoot to months");
}

// 5. miss on owned ground cracks and demotes below OWN immediately
{
  let { rec } = foldResult(null, true, t0, "start");
  ({ rec } = foldResult(rec, true, t0 + DAY, "start"));
  ({ rec } = foldResult(rec, true, t0 + 3 * DAY, "start"));
  const R = retrievability(rec, t0 + 3 * DAY + 3600000);
  assert.ok(R >= MEM.OWN, "setup: position should be owned");
  const res = foldResult(rec, false, t0 + 3 * DAY + 3600000, "4...Qf6");
  assert.ok(res.cracked, "miss on owned ground must flag a crack");
  assert.ok(!owned(res.rec, t0 + 3 * DAY + 2 * 3600000), "cracked position must need re-earning (relearn gate)");
  assert.equal(res.rec.cracks, 1);
  // one clean hand-play clears relearn and re-opens the gate
  const fixed = foldResult(res.rec, true, t0 + 3 * DAY + 2 * 3600000, "4...Qf6").rec;
  assert.ok(owned(fixed, t0 + 3 * DAY + 3 * 3600000), "a clean hand-play must clear relearn");
}

// 6. vacation-return: 21 days idle, R≈0, one success restores ownership for
//    the session and grows stability strongly (no due-avalanche punishment)
{
  let { rec } = foldResult(null, true, t0, "start");
  ({ rec } = foldResult(rec, true, t0 + DAY, "start"));
  const back = t0 + 22 * DAY;
  assert.ok(retrievability(rec, back) < 0.05, "setup: long absence should decay hard");
  const hBefore = rec.H;
  ({ rec } = foldResult(rec, true, back, "start"));
  assert.ok(rec.H > hBefore * 2.5, "hard-won recall after absence must earn a large stability gain");
}

// 7. via-doors and events accumulate; events cap
{
  let rec = null;
  for (let i = 0; i < 60; i++) ({ rec } = foldResult(rec, i % 5 !== 0, t0 + i * DAY, i % 2 ? "4...Qf6" : "4...Bc5", 800 + i));
  assert.equal(rec.ev.length, MEM.EV_CAP);
  assert.equal(rec.seen, 60);
  assert.ok(rec.via["4...Qf6"][0] + rec.via["4...Bc5"][0] === 60, "every hand encounter must be door-logged");
  assert.ok(rec.ev.every((e) => e.length === 4 && typeof e[0] === "number"), "event shape [tMin, ok, door, latMs]");
}

console.log("scoring: 7 derived properties of the v6.3 memory model verified.");
