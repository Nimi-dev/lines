// Content audit: the teaching-quality bar for every pack that can enter the
// gauntlet (core Scotch + learnable shield packs). Prose is content, and
// content is verified — a silent note is a blank card in the study walk and a
// bare "He plays 5...Nd5" in the drill. Off-repertoire study packs are exempt:
// they are read once, not drilled daily.
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";

const { PACKS, EXTRAS, CORE_PACK_IDS, LEARNABLE_PACK_IDS, BLACK_PACK_IDS } = await loadApp();

/* A ratchet, not a blanket rule. Packs listed here are at the bar and must stay
   there — the audit fails if one regresses. Every other gauntlet pack is
   reported with its coverage but does not fail the build, so new content can
   land unfinished and be brought up deliberately. Add a pack here once it is
   complete; that is the only way the bar ever moves. */
const COMPLETE = ["mieses", "classical", "steinitz", "hoover", "declines", "petroff", "russian", "philidor", "hanham", "alien"];
const inGauntlet = [...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS, ...(BLACK_PACK_IDS || [])];
const missingFromTree = COMPLETE.filter((id) => !inGauntlet.includes(id));
assert.equal(missingFromTree.length, 0, `COMPLETE lists pack(s) not in the gauntlet tree: ${missingFromTree.join(", ")}`);
const GATED = COMPLETE;

// the drill flashes only the first sentence of an opponent-move note
const firstSentence = (t) => { const m = t.match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : t; };
const FLASH_MAX = 150;

let notes = 0, whys = 0, drills = 0, checks = 0;
for (const p of PACKS.filter((x) => GATED.includes(x.id))) {
  const ex = EXTRAS[p.id] || {};
  const where = (what) => `${p.id}: ${what}`;

  p.dream.forEach((d, i) => {
    assert.ok(d.note && d.note.trim(), where(`dream ply ${i} (${d.san}) has no note`));
    notes++;
    const f = firstSentence(d.note);
    assert.ok(f.length <= FLASH_MAX, where(`dream ply ${i} (${d.san}) first sentence is ${f.length} chars, over the ${FLASH_MAX} flash budget`));
    assert.ok(d.chunk && p.chunkGoals[d.chunk], where(`dream ply ${i} (${d.san}) has chunk "${d.chunk}" with no chunkGoal`));
    assert.ok(p.chunks[d.chunk], where(`dream ply ${i} (${d.san}) has chunk "${d.chunk}" with no chunk title`));
    if (d.why) { whys++; assert.ok(d.why.q && d.why.a, where(`why block on ${d.san} is missing q or a`)); }
  });
  checks++;

  p.danger.plies.forEach((d, i) => {
    assert.ok(d.note && d.note.trim(), where(`danger ply ${i} (${d.san}) has no note`));
    notes++;
  });
  for (const f of ex.futures || []) {
    assert.ok(f.t && f.note, where(`future "${f.t}" needs both a title and a note`));
    assert.ok(f.moves.length, where(`future "${f.t}" has no moves`));
  }

  // every chunk that has a goal must also have a thinking-hint (the drill's ◈ button)
  for (const k of Object.keys(p.chunkGoals)) {
    assert.ok(ex.hints && ex.hints[k], where(`chunk ${k} has a goal but no thinking-hint in EXTRAS`));
  }

  for (const d of p.drills || []) {
    assert.ok(d.prompt && d.reason, where(`drill ${d.id} needs a prompt and a reason`));
    if (d.kind === "move") assert.ok((d.hints || []).length >= 2, where(`move drill ${d.id} needs 2 hints`));
    if (d.kind === "goal") assert.ok((d.options || []).length >= 3 && d.correct != null, where(`goal drill ${d.id} needs 3 options and a correct index`));
    drills++;
  }
  assert.ok((p.drills || []).length >= 4, where("needs at least 4 drills"));

  // the payoff has to be stated, or the line is just moves
  for (const f of ["eyebrow", "headline", "body", "revealTitle", "reveal"]) {
    assert.ok(p.promise[f], where(`promise.${f} is empty`));
  }
  for (const f of ["eyebrow", "headline", "survival", "bailoutNote"]) {
    assert.ok(p.danger[f], where(`danger.${f} is empty`));
  }

  const packWhys = p.dream.filter((d) => d.why).length;
  assert.ok(packWhys >= 2, where(`only ${packWhys} why-block(s) — a drilled pack carries at least 2`));
}

// everything else in the tree: reported, not enforced
const pending = [];
for (const p of PACKS.filter((x) => inGauntlet.includes(x.id) && !GATED.includes(x.id))) {
  const dn = p.dream.filter((d) => d.note && d.note.trim()).length;
  const gn = p.danger ? p.danger.plies.filter((d) => d.note && d.note.trim()).length : 0;
  const gt = p.danger ? p.danger.plies.length : 0;
  pending.push(`${p.id} ${dn}/${p.dream.length} dream, ${gn}/${gt} danger, ${p.dream.filter((d) => d.why).length} why`);
}
if (pending.length) {
  console.log(`content-audit: ${pending.length} gauntlet pack(s) below the bar (reported, not enforced — add to COMPLETE when done):`);
  for (const line of pending) console.log(`    · ${line}`);
}
console.log(`content-audit: ${GATED.length} packs held at the bar — ${notes} annotated plies, ${whys} why-blocks, ${drills} drills; every ply speaks, every chunk has a goal and a hint.`);
