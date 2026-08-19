import { useState, useMemo, useEffect, useRef } from "react";
import { MEM, retrievability, foldResult, owned, seedFromConf } from "./scoring.js";
import { sanList, analyzeGames, scorePct } from "./games.js";
import { buildLineDoc, buildClusters, runStatus, grandfathered, learnNext, practiceNext } from "./learn.js";

/* ---------- palette ---------- */
const C = {
  ink: "#171310", surface: "#211B15", card: "#2A231B", line: "#3A3128",
  cream: "#EFE6D6", muted: "#A2947E",
  boardLight: "#EBECD0", boardDark: "#779556", // chess.com green board
  gold: "#D9A441", goldSoft: "rgba(217,164,65,0.16)",
  red: "#CE4A36", redSoft: "rgba(206,74,54,0.16)",
  green: "#7BAE6E",
};

/* ---------- tiny chess model (scripted lines, no rules engine) ---------- */
const sq = (n) => (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97);
const sqName = (i) => "abcdefgh"[i % 8] + (Math.floor(i / 8) + 1);
const START = (() => {
  const b = Array(64).fill(null);
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  back.forEach((p, f) => { b[f] = p; b[8 + f] = "P"; b[48 + f] = "p"; b[56 + f] = p.toLowerCase(); });
  return b;
})();
const applyMoves = (moves) => {
  const b = START.slice();
  for (const m of moves) {
    for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); b[t] = b[f]; b[f] = null; }
  }
  return b;
};
const fromTo = (m) => { const a = m.split(",")[0]; return [a.slice(0, 2), a.slice(2, 4)]; };
const GLYPH = { k: "♚︎", q: "♛︎", r: "♜︎", b: "♝︎", n: "♞︎", p: "♟︎" };

/* ============================================================
   CONTENT PACKS — a new opening is just a new object here.
   Every pack: dream line + chunk goals + danger + drills.
   ============================================================ */

const ALIEN = {
  id: "alien", family: "shield",
  chip: "👽 Alien",
  badge: "👽 ALIEN GAMBIT · WHITE",
  chunks: { A: "Chunk A · The setup", B: "Chunk B · The sacrifice", C: "Chunk C · The hunt" },
  chunkGoals: {
    A: "Reach the fork in the road: your knight proud on e4, his knight biting at it from f6. This is the square where you choose the adventure — everything before it is free.",
    B: "Trade a knight for his king's safety. When this chunk ends, his king stands on f7 and castling is gone for the rest of his life.",
    C: "The g6 fork. The hole your sacrifice dug becomes the knight's home — material returns with interest against a stranded king.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "Standard start. Nothing alien yet." },
    { m: "c7c6", san: "1...c6", chunk: "A", note: "The Caro-Kann — your trigger. This line only exists against ...c6." },
    { m: "d2d4", san: "2.d4", chunk: "A", note: "Take the center." },
    { m: "d7d5", san: "2...d5", chunk: "A", note: "Black strikes back. All book." },
    { m: "b1d2", san: "3.Nd2", chunk: "A", anchor: true, note: "First fingerprint. 3.Nc3 is normal — 3.Nd2 hides your intentions and keeps the knight route flexible." },
    { m: "d5e4", san: "3...dxe4", chunk: "A", note: "Almost everyone takes." },
    { m: "d2e4", san: "4.Nxe4", chunk: "A", note: "Recapture. Derivable — nothing to memorize." },
    { m: "g8f6", san: "4...Nf6", chunk: "A", note: "Black attacks your knight — and steps toward the trap. This square is also your bailout fork: 5.Nxf6+ is the sound exit." },
    { m: "e4g5", san: "5.Neg5!?", chunk: "B", anchor: true, note: "THE alien move. Natural is 5.Nxf6+. Instead the knight walks toward f7 — begging to be kicked." , why: { q: "Why volunteer to be kicked — what does ...h6 actually buy White?", a: "The sacrifice on f7 will need a home afterward. ...h6 removes g5 from Black's defense, and with the f-pawn about to vanish, g6 becomes an eternal hole. The knight you're 'losing' is manufacturing the outpost your other knight retires into on move 10. You aren't walking into the kick — you're commissioning it." } },
    { m: "h7h6", san: "5...h6", chunk: "B", note: "Played on sight by most club players. Exactly what you want." },
    { m: "g5f7", san: "6.Nxf7!!", chunk: "B", anchor: true, note: "The sacrifice. A whole knight to drag the king out and wreck the light squares forever." },
    { m: "e8f7", san: "6...Kxf7", chunk: "B", note: "Basically forced. Black is up a piece — and has lost castling for the rest of the game." },
    { m: "g1f3", san: "7.Nf3!", chunk: "C", anchor: true, note: "The quiet key move. Reroute: Nf3→e5 will come with check — that tempo funds the whole attack." , why: { q: "You're a piece down and playing a quiet developing move. Why isn't this too slow?", a: "Because the route is pre-paid: Nf3→e5 arrives with check, and a check is a free move. Attacks aren't funded by material — they're funded by tempi, and this knight prints them. Slow-looking moves with forced follow-ups are the fastest moves on the board." } },
    { m: "e7e6", san: "7...e6?", chunk: "C", note: "The most common reply at club level. Natural — and losing." },
    { m: "f3e5", san: "8.Ne5+", chunk: "C", note: "There's the tempo. The king must move again." },
    { m: "f7e8", san: "8...Ke8", chunk: "C", note: "Back home — but there is no home. He can never castle." },
    { m: "f1d3", san: "9.Bd3", chunk: "C", anchor: true, note: "Eyes g6 and h7. Every piece joins in before the blow lands." },
    { m: "f8e7", san: "9...Be7", chunk: "C", note: "Black develops, hoping to hide." },
    { m: "e5g6", san: "10.Ng6!", chunk: "C", anchor: true, note: "The blow. The knight lands in the hole the sacrifice built: the f-pawn is gone and ...h6 only covers g5 — nothing can ever touch g6. It forks h8 and e7." },
    { m: "h8g8", san: "10...Rg8", chunk: "C", note: "The rook slides away —" },
    { m: "g6e7", san: "11.Nxe7", chunk: "C", note: "The payoff. Material returns with interest, Black's king is stranded in the center forever, and Qh5+ still hangs in the air. This is the picture you play for." },
  ],
  promise: {
    eyebrow: "The promise · move 10",
    headline: "This is where you're going.",
    plyCount: 19, last: ["e5", "g6"], marks: ["h8", "e7"],
    body: "Before you learn a single move: this is the position the whole line buys. White is a piece down — and completely winning. Can you see why?",
    revealTitle: "10.Ng6!",
    reveal: "The knight lands in the hole the sacrifice built. The f-pawn died on move 6 and ...h6 only covers g5, so nothing can ever touch it — and it forks the rook on h8 and the bishop on e7. Material returns with interest against a king that lost castling forever.",
    chip: "At 1200–1400, opponents walk into this family of positions in roughly 7 of 10 games.",
  },
  danger: {
    eyebrow: "The danger · the tax on the dream",
    headline: "If he stays calm, you are just worse.",
    base: null, baseCount: 13,
    plies: [
      { m: "c6c5", san: "7...c5!", note: "The refutation. Cold-blooded: hit the center, ignore the ghosts." },
      { m: "f3e5", san: "8.Ne5+", note: "Survival mode. Keep checking, keep pieces on the board." },
      { m: "f7e8", san: "8...Ke8", note: "He tucks the king and keeps developing." },
      { m: "f1d3", san: "9.Bd3!", note: "The quiet killer — SF d25: +2.8. The bishop loads Bg6+ and the e5 knight waits for the fork." },
      { m: "e7e6", san: "9...e6", note: "Blocking the diagonal — too late: 10.Bg6+! Ke7 11.Nf7 forks queen and rook, and the 'refuted' gambit collects the full point. Even the correct-looking defense (...c5 and the king walk back) loses at club level; the true engine refutation is far deeper — see Survival for the honest ledger." },
    ],
    ledgerTitle: "The bet, priced at your rating (1200–1400)",
    ledger: [
      { label: "Kick with 5...h6 → walk into the sac", pct: 71, color: C.gold },
      { label: "Decline or sidestep before move 6", pct: 26, color: C.muted },
      { label: "Find 7...c5 and consolidate", pct: 3, color: C.red },
    ],
    survivalTitle: "Survival plan — drill this cold",
    survival: "The honest ledger: against PERFECT defense (engine-only moves after 6...Kxf7) the gambit is objectively about −1.6 — this is a labeled practical weapon, not sound theory. At club level the compensation converts constantly: the king is loose, the ideas are yours, and every natural defensive move loses. Know both facts and choose it on purpose.",
    bailoutTitle: "The bailout fork — move 5",
    bailoutMoves: ["e2e4","c7c6","d2d4","d7d5","b1d2","d5e4","d2e4","g8f6","e4f6","e7f6"],
    bailoutLast: ["e7", "f6"],
    bailoutNote: "The last sound exit: 5.Nxf6+ exf6 instead of 5.Neg5. Normal position, no debt. The risk decision of this whole opening lives on this square.",
  },
  drills: [
    { id: "a1", kind: "move", plyCount: 10, from: "g5", to: "f7",
      prompt: "Cold position. Your move.",
      hints: ["This is the whole point of the gambit.", "The knight on g5 has one destiny."],
      reason: "6.Nxf7!! — ...h6 was the invitation. Drag the king out." },
    { id: "a2", kind: "move", plyCount: 12, from: "g1", to: "f3",
      prompt: "You're a piece down. Your move.",
      hints: ["Bring the last knight into the hunt — with a threat in mind.", "The g1 knight has a route that hits the king with tempo."],
      reason: "7.Nf3 — heading to e5 with check. The tempo funds the attack." },
    { id: "a3", kind: "goal",
      prompt: "Quick check — what picture are you playing toward in this line?",
      options: [
        "A knight lands on g6: fork, stripped king, material returns with attack",
        "Win the d5 pawn and grind a long endgame",
        "Trade queens early into a safer structure",
      ],
      correct: 0,
      reason: "If the goal fades, the moves turn into rote — and rote decays next." },
    { id: "a4", kind: "move", plyCount: 18, from: "e5", to: "g6",
      prompt: "Everything is ready. Land the blow.",
      hints: ["The sacrifice dug a hole in his kingside. Occupy it.", "The e5 knight has a square nothing can ever touch."],
      reason: "10.Ng6! — the fork on h8 and e7. The missing f-pawn and ...h6 mean the knight can never be taken." },
    { id: "a5", kind: "move", danger: true, plyCount: 13, extra: ["c6c5"], from: "f3", to: "e5",
      prompt: "He found 7...c5 — the refutation. Survival plan?",
      hints: ["Red alert. What keeps maximum pressure right now?", "Check first. Ask questions later."],
      reason: "8.Ne5+ — keep queens on, aim at e6, avoid trades. You're worse; make him prove it." },
  ],
};

const SCOTCH = {
  id: "scotch", family: "italian",
  conflicts: [{ at: "after 3...exd4", mine: "4.Bc4!?", vs: "repertoire", theirs: "4.Nxd4 (Mieses & co.)" }],
  morphs: [{ ply: 6, when: "If he answers 4.Bc4 with 4...Nf6 instead", to: "lange", note: "the Max Lange position, via the Scotch door — one square, two openings" }],
  chip: "🥃 Scotch",
  badge: "🥃 SCOTCH GAMBIT · WHITE",
  chunks: { A: "Chunk A · The Scotch break", B: "Chunk B · The bait", C: "Chunk C · The punishment" },
  chunkGoals: {
    A: "Rip the center open by move 3. When this chunk ends the e- and d-pawns have vanished and the position is already sharper than anything he prepared for.",
    B: "Dangle two pawns and watch both disappear into his pocket. When this chunk ends he is two pawns up — and one move from ruin.",
    C: "Take everything back with checks. When this chunk ends the material is level, his king lives on f8 forever, and you castle next move.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "Standard start." },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "The open game — your trigger." },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "Attack e5." },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "Defended. All book." },
    { m: "d2d4", san: "3.d4", chunk: "A", anchor: true, note: "The Scotch break — rip the center open on move 3 instead of slow Italian maneuvering." },
    { m: "e5d4", san: "3...exd4", chunk: "A", note: "Essentially forced; e5 can't be held." },
    { m: "f1c4", san: "4.Bc4!?", chunk: "B", anchor: true, note: "The gambit choice. You don't take d4 back — you aim at f7 and develop with fury. (The bailout lives here: 4.Nxd4 is the sound main line.)" , why: { q: "The d4 pawn is free to take back. Why leave it standing?", a: "Recapturing develops nothing. Bc4 develops with a target — f7 — and in an open position a pawn is worth roughly three tempi. You're not down a pawn; you've converted it into time, and you start collecting the interest immediately." } },
    { m: "f8c5", san: "4...Bc5", chunk: "B", note: "The greedy setup: he guards his extra pawn and mirrors your bishop." },
    { m: "c2c3", san: "5.c3!", chunk: "B", anchor: true, note: "Offer a SECOND pawn. This is the bait — you want him to take." , why: { q: "Why offer a SECOND pawn — isn't one enough?", a: "Trace the queen's road to d5: Black's own d4 pawn is parked on the file. The c3 offer bribes that pawn to step off the road — the grab and the unblocking are the same physical act. Every trap has a mechanism, and this one is a single empty square: d4." } },
    { m: "d4c3", san: "5...dxc3?", chunk: "B", note: "Greed. The most common club reply — and the losing moment." },
    { m: "c4f7", san: "6.Bxf7+!!", chunk: "C", anchor: true, note: "The thematic sacrifice. The king must take — and step onto a forking diagonal." },
    { m: "e8f7", san: "6...Kxf7", chunk: "C", note: "Castling: gone forever." },
    { m: "d1d5", san: "7.Qd5+!", chunk: "C", anchor: true, note: "The fork. Check on the king — and the c5 bishop is suddenly loose. This one move is the entire trap." },
    { m: "f7f8", san: "7...Kf8", chunk: "C", note: "The king hides — there is no good square." },
    { m: "d5c5", san: "8.Qxc5+", chunk: "C", note: "Scoop the bishop — with another check." },
    { m: "d7d6", san: "8...d6", chunk: "C", note: "Blocking, at the cost of more structure." },
    { m: "c5c3", san: "9.Qxc3", chunk: "C", note: "The payoff. Every pawn is back, his king is stuck on f8 for life, and you castle next move. Material even — position winning." },
  ],
  promise: {
    eyebrow: "The promise · move 7",
    headline: "Two pawns of bait. One fork.",
    plyCount: 13, last: ["d1", "d5"], marks: ["c5"],
    body: "Before you learn a single move: this is the moment the line buys. Black is two pawns up — and completely lost. Can you see why?",
    revealTitle: "7.Qd5+!",
    reveal: "The queen forks the exposed king and the loose bishop on c5. He grabbed two pawns; you take everything back with 8.Qxc5+ and 9.Qxc3 — equal material, but his king lost castling forever and every one of your pieces develops with tempo.",
    chip: "At 1000–1600, most opponents who reach 5.c3 grab the second pawn.",
  },
  danger: {
    eyebrow: "The danger · when he declines",
    headline: "The tax here isn't losing. It's theory.",
    base: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f1c4"], baseCount: null,
    plies: [
      { m: "g8f6", san: "4...Nf6!", note: "The safest decline — he ignores your bishop and hits e4. Two Knights territory. Your dream line just evaporated." },
      { m: "e4e5", san: "5.e5", note: "Kick the knight — but know what's coming." },
      { m: "d7d5", san: "5...d5!", note: "THE move you must expect. He counterattacks your bishop instead of retreating. Autopilot dies here: 6.exf6? dxc4 hands him the bishop pair for free." },
      { m: "c4b5", san: "6.Bb5", note: "The only good square — keep the pin, keep the tension." },
      { m: "f6e4", san: "6...Ne4", note: "His knight finds the hole your pawn left behind." },
      { m: "f3d4", san: "7.Nxd4", note: "Take the pawn back. Roughly equal, fully playable — but HE chose this position, and from here the better-prepared player wins." },
    ],
    ledgerTitle: "How opponents answer the gambit (1000–1600)",
    ledger: [
      { label: "4...Bc5 → 5...dxc3, into the trap", pct: 58, color: C.gold },
      { label: "4...Nf6! — decline into theory", pct: 31, color: C.red },
      { label: "Other (4...Bb4+, 4...d6...)", pct: 11, color: C.muted },
    ],
    survivalTitle: "Preparation plan — know this cold",
    survival: "Against 4...Nf6: 5.e5 d5! 6.Bb5 Ne4 7.Nxd4 — one clean sequence, drilled until automatic. The gambit is sound; the only way to lose it is to know less than he does. Never, ever autopilot 6.exf6.",
    bailoutTitle: "The bailout fork — move 4",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4"],
    bailoutLast: ["f3", "d4"],
    bailoutNote: "The sound exit: 4.Nxd4, the main-line Scotch. No pawn owed, a rich normal game. The gambit is a choice you make fresh every game — this square is where you make it.",
  },
  drills: [
    { id: "s1", kind: "move", plyCount: 10, from: "c4", to: "f7",
      prompt: "He grabbed the second pawn. Your move.",
      hints: ["The bait worked. Now the theme of the whole gambit.", "Which piece hits the weakest square on the board?"],
      reason: "6.Bxf7+!! — drag the king onto the forking diagonal." },
    { id: "s2", kind: "move", plyCount: 12, from: "d1", to: "d5",
      prompt: "The king took. Cash in.",
      hints: ["One move attacks two things.", "The d-file is open, and c5 is loose."],
      reason: "7.Qd5+ — check, and the c5 bishop falls next move. This fork IS the trap." },
    { id: "s3", kind: "goal",
      prompt: "Quick check — what picture are you playing toward in this line?",
      options: [
        "A queen fork on d5: king dragged out, the c5 bishop scooped, castling gone",
        "Quietly regain the d4 pawn and reach an equal endgame",
        "Sacrifice the queen for a perpetual check",
      ],
      correct: 0,
      reason: "If the goal fades, the moves turn into rote — and rote decays next." },
    { id: "s4", kind: "move", plyCount: 14, from: "d5", to: "c5",
      prompt: "Finish the scoop.",
      hints: ["The fork promised you a piece. Collect — with tempo.", "The queen takes, and it's check again."],
      reason: "8.Qxc5+ — collect the bishop with check, then 9.Qxc3 restores everything." },
    { id: "s5", kind: "move", danger: true,
      moves: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f1c4","g8f6","e4e5","d7d5"],
      from: "c4", to: "b5",
      prompt: "He declined with 4...Nf6 and hit your bishop with 5...d5. Stay precise.",
      hints: ["Don't take the knight — that's the autopilot blunder.", "Save the bishop to the square that keeps the pin."],
      reason: "6.Bb5 — the one move to know. (6.exf6? dxc4 gives him the bishop pair for nothing.)" },
  ],
};

const LEGAL = {
  id: "legal", family: "italian",
  conflicts: [{ at: "after 2...Nc6", mine: "3.Bc4", vs: "repertoire", theirs: "3.d4 — the Scotch" }],
  chip: "⚡ Légal",
  badge: "⚡ LÉGAL'S MATE · WHITE",
  chunks: { A: "Chunk A · The Italian shell", B: "Chunk B · Loading the ingredients", C: "Chunk C · The illusion breaks" },
  chunkGoals: {
    A: "A normal Italian — until he plays the passive ...d6. When this chunk ends you're in the trap's natural hunting ground, and he doesn't know it.",
    B: "Load all three ingredients: bishop on f7's diagonal, knight ready to jump to d5, and his bishop lured to h5. When this chunk ends the mate already exists — it just hasn't happened yet.",
    C: "He wins your queen. Three moves later he's mated by three minor pieces while your queen sits in his pocket. The pin was always an illusion.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "Standard start." },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "The open game." },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "Attack e5." },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "Defended. All book." },
    { m: "f1c4", san: "3.Bc4", chunk: "A", anchor: true, note: "Ingredient #1 — the bishop takes aim at f7. It will matter in exactly five moves." },
    { m: "d7d6", san: "3...d6", chunk: "A", note: "The passive Paris Defense — solid-looking, and the trap's natural hunting ground." },
    { m: "b1c3", san: "4.Nc3", chunk: "B", anchor: true, note: "Ingredient #2 — this knight's whole purpose is one future jump: to d5. Nothing about this move looks aggressive. That's the beauty." , why: { q: "Nothing about this move attacks anything. Why is it an 'ingredient'?", a: "Its entire purpose is one future jump: Nd5, mate, four moves from now. The strongest preparation is invisible — it doesn't threaten, so it doesn't warn. He reads Nc3 as routine development; you are quietly loading the mating square." } },
    { m: "c8g4", san: "4...Bg4", chunk: "B", note: "The pin. He believes your f3 knight is frozen to the queen. Belief is not arithmetic." },
    { m: "h2h3", san: "5.h3!", chunk: "B", anchor: true, note: "The question. Retreat, trade, or keep the pin? His answer decides the game." , why: { q: "The trap already works — after ...Bxd1, the mate is identical with the bishop on g4. Why must h3 come first?", a: "Price a trap by its worst branch. Without h3, the calm 6...Nxe5! leaves you a piece down forever — a knight on e5 defends g4, so the bishop can never be won back. Push it to h5 first and it stands one square OUTSIDE its own protection net: after 6...Nxe5 7.Qxh5! you're simply up a pawn. h3 isn't preparation for the attack — it converts a gamble into a no-lose bet." } },
    { m: "g4h5", san: "5...Bh5?", chunk: "B", note: "Keeping the pin — ingredient #3, delivered by your opponent. (5...Bxf3 was necessary.)" },
    { m: "f3e5", san: "6.Nxe5!!", chunk: "C", anchor: true, note: "The 'pinned' knight jumps, hanging your queen with a smile. If he's greedy, he's already lost. If he's careful (6...Nxe5), you win a clean pawn — see Danger." , why: { q: "The knight is pinned to your queen. How can it legally 'just move'?", a: "A pin was never a rule — it's a threat with a price tag. Here ...Bxd1 'wins' a queen and loses to forced mate: a price he cannot pay, so the pin never truly existed. Before respecting any pin, calculate the ignore-it branch to the very end." } },
    { m: "h5d1", san: "6...Bxd1??", chunk: "C", note: "Greed takes the bait. He wins the queen — the most expensive capture of his life." },
    { m: "c4f7", san: "7.Bxf7+", chunk: "C", note: "Check — and the bishop is protected by the e5 knight, so the king cannot take it." },
    { m: "e8e7", san: "7...Ke7", chunk: "C", note: "The only legal move. The king steps onto its gravestone." },
    { m: "c3d5", san: "8.Nd5#", chunk: "C", anchor: true, note: "Mate. Ingredient #2 completes its one job. Every escape square is covered by a minor piece — with your queen watching from his pocket." },
  ],
  promise: {
    eyebrow: "The promise · move 8",
    headline: "Mate in 8. Queen not required.",
    plyCount: 15, last: ["c3", "d5"], marks: ["f7", "e5"],
    body: "Before you learn a single move: this is checkmate — and White's queen is OFF the board. He captured it two moves ago and it cost him the game. Can you see why the king has nowhere to go?",
    revealTitle: "8.Nd5#",
    reveal: "Three minor pieces deliver mate: the d5 knight checks, the f7 bishop seals e8 and e6, the e5 knight covers d7 and protects f7, and his own queen blocks d8. He 'won' your queen with ...Bxd1 — the most expensive capture of his life. The pin on f3 was always an illusion.",
    chip: "At club level, roughly half of opponents keep the pin with 5...Bh5.",
  },
  danger: {
    eyebrow: "The danger · discipline",
    headline: "This trap's only danger is you.",
    base: ["e2e4","e7e5","g1f3","b8c6","f1c4","d7d6","b1c3","c8g4","h2h3"], baseCount: null,
    plies: [
      { m: "g4f3", san: "5...Bxf3!", note: "The correct reply — he cashes the pin instead of clinging to it. No jackpot today." },
      { m: "d1f3", san: "6.Qxf3", note: "Recapture with the queen. You have the bishop pair, a pleasant game, and zero regrets. The trap costs nothing when it's declined — that's what makes it free money." },
    ],
    ledgerTitle: "How opponents answer 5.h3 (club level)",
    ledger: [
      { label: "5...Bh5? — keeps the pin, into the mate", pct: 48, color: C.gold },
      { label: "5...Bxf3 — the correct trade", pct: 41, color: C.red },
      { label: "Other retreats (...Be6, ...Bd7)", pct: 11, color: C.muted },
    ],
    survivalTitle: "The ingredients checklist — all three or don't fire",
    survival: "Nxe5 only works when: (1) your bishop hits f7, (2) a knight can jump to d5, (3) his bishop sits on h5 with ...d6 played. Missing any one, and 'Bxd1' just wins your queen for real. And if he declines with 6...Nxe5: 7.Qxh5 Nxc4 8.Qb5+! c6 9.Qxc4 — a clean extra pawn. The trap pays in every branch, but only with all three ingredients on the board.",
    bailoutTitle: "The zero-theory lane — move 5",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","f1c4","d7d6","b1c3","c8g4","d2d3"],
    bailoutLast: ["d2", "d3"],
    bailoutNote: "If you'd rather not carry the checklist: 5.d3 keeps a healthy Italian with zero risk. The trap is optional dessert — the position was already good.",
  },
  drills: [
    { id: "l1", kind: "move", plyCount: 10, from: "f3", to: "e5",
      prompt: "The pin says your knight can't move. Your move.",
      hints: ["A pin is only real if the punishment is real. Count it.", "What happens after ...Bxd1? Follow the checks to the end — then trust them."],
      reason: "6.Nxe5!! — the 'pinned' knight jumps, offering the queen. The mate is already unstoppable." },
    { id: "l2", kind: "move", plyCount: 12, from: "c4", to: "f7",
      prompt: "He took the queen. Prove him wrong.",
      hints: ["The king must be dragged to the mating square.", "Give the check your e5 knight protects."],
      reason: "7.Bxf7+ — protected by the e5 knight, so the king can't take. Only ...Ke7." },
    { id: "l3", kind: "move", plyCount: 14, from: "c3", to: "d5",
      prompt: "Finish it.",
      hints: ["Ingredient #2 was loaded on move 4 for this exact moment.", "One knight hop covers every escape square."],
      reason: "8.Nd5# — mate by three minor pieces, with your queen in his pocket." },
    { id: "l4", kind: "goal",
      prompt: "Quick check — what picture are you playing toward in this line?",
      options: [
        "Mate by three minor pieces while your queen sits 'captured' in his pocket",
        "Win the g4 bishop and grind a long endgame",
        "A perpetual check to escape with a draw",
      ],
      correct: 0,
      reason: "If the goal fades, the moves turn into rote — and rote decays next." },
    { id: "l5", kind: "move", danger: true,
      moves: ["e2e4","e7e5","g1f3","b8c6","f1c4","d7d6","b1c3","c8g4","h2h3","g4f3"],
      from: "d1", to: "f3",
      prompt: "He didn't bite — he traded on f3. Stay sound.",
      hints: ["No tricks needed anymore. Just recapture correctly.", "Which recapture keeps your structure clean and develops the queen?"],
      reason: "6.Qxf3 — bishop pair, pleasant game, zero regrets. The trap costs nothing when declined." },
  ],
};

const MORRA = {
  id: "morra", family: "shield",
  chip: "🌋 Morra",
  badge: "🌋 SMITH-MORRA · WHITE",
  chunks: { A: "Chunk A · The Morra offer", B: "Chunk B · Aiming the pieces", C: "Chunk C · The d-file detonation" },
  chunkGoals: {
    A: "Answer the Sicilian with a gift: a pawn on c3, dangled for the open files. When this chunk ends he's taken it — and paid you two open highways for one pawn.",
    B: "Aim everything before firing anything: knights to c3 and f3, bishop to c4 staring at f7. When this chunk ends he plays the 'normal' 6...Nf6 — the move that loses.",
    C: "Detonate the center with e5. Queens leave the board — and the attack doesn't care. When this chunk ends a bishop-protected knight sits on f7, forking his rook out of the game.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "Standard start." },
    { m: "c7c5", san: "1...c5", chunk: "A", note: "The Sicilian — the club player's favorite weapon. You're about to take it away." },
    { m: "d2d4", san: "2.d4", chunk: "A", note: "Strike immediately." },
    { m: "c5d4", san: "2...cxd4", chunk: "A", note: "Taken — as always." },
    { m: "c2c3", san: "3.c3!", chunk: "A", anchor: true, note: "The Morra offer. You gift the pawn for open c- and d-files and a lead in development. Your rooks will love you." , why: { q: "What exactly does the gambit pawn purchase?", a: "Two open files — c and d. Which is to say: both of your rooks' careers, and the d8 square where his king will be standing when the file detonates. Pawns are the currency of files, and the Morra spends one at the moment files are cheapest." } },
    { m: "d4c3", san: "3...dxc3", chunk: "A", note: "Most take. The gift is accepted — the files are yours." },
    { m: "b1c3", san: "4.Nxc3", chunk: "B", note: "Recapture with tempo-rich development. Derivable — nothing to memorize." },
    { m: "b8c6", san: "4...Nc6", chunk: "B", note: "Normal development." },
    { m: "g1f3", san: "5.Nf3", chunk: "B", note: "Normal development — but every piece is pointing the same direction." },
    { m: "d7d6", san: "5...d6", chunk: "B", note: "The standard Sicilian move — and here, the first step into the pit." },
    { m: "f1c4", san: "6.Bc4", chunk: "B", anchor: true, note: "The laser on f7. Remember this bishop — it silently decides the whole combination four moves from now." , why: { q: "Why does this bishop 'silently decide' the whole combination?", a: "Four moves from now a knight lands on f7, and the only question will be: can the king take it? The answer is written here — Bc4 covers f7 for the rest of the game without ever moving again. The strongest attackers are often the pieces that never move." } },
    { m: "g8f6", san: "6...Nf6??", chunk: "B", note: "The most natural developing move on the board. Played instantly by thousands of club players every day. Losing." },
    { m: "e4e5", san: "7.e5!", chunk: "C", anchor: true, note: "The detonation. The center explodes onto the pinned-open d-file." },
    { m: "d6e5", san: "7...dxe5", chunk: "C", note: "Nearly automatic — and now the d-file is a loaded gun." },
    { m: "d1d8", san: "8.Qxd8+", chunk: "C", anchor: true, note: "Trade queens INTO the attack. Club players think queenless means safe. Watch." , why: { q: "Trading queens usually kills attacks. Why does this one trade INTO the attack?", a: "Because the targets are structural — a naked king on an open file, a cornered rook — and structure survives queen trades. His king must recapture into the crossfire and then personally block his own development. Ask what your attack runs on: if it's files and tempo, the queens are optional." } },
    { m: "e8d8", san: "8...Kxd8", chunk: "C", note: "His king is now the d-file's doorman — undeveloped, unsafe, in the way." },
    { m: "f3g5", san: "9.Ng5!", chunk: "C", anchor: true, note: "The queenless killer. Threat: Nxf7+ — a royal fork on king and rook, protected by the c4 laser from move 6." },
    { m: "d8e8", san: "9...Ke8", chunk: "C", note: "He guards f7 with the king — but your bishop outnumbers him there." },
    { m: "g5f7", san: "10.Nxf7", chunk: "C", note: "The payoff. The king can't take — the c4 bishop protects the knight. The h8 rook falls next, and Black's game is a ruin after ten moves and zero queens." },
  ],
  promise: {
    eyebrow: "The promise · move 10",
    headline: "The attack that survives the queen trade.",
    plyCount: 19, last: ["g5", "f7"], marks: ["h8", "c4"],
    body: "Before you learn a single move: queens left the board two moves ago — and Black is lost anyway. The knight on f7 cannot be taken. Can you see why, and what falls next?",
    revealTitle: "10.Nxf7",
    reveal: "The c4 bishop — aimed at f7 since move 6 — protects the knight, so the king can't touch it. The h8 rook is trapped and falls next move. He played ten completely natural Sicilian moves and lost by move 10, with no queens on the board. That's the Morra: the files do the attacking.",
    chip: "At 1100–1500, 6...Nf6 is among the most common replies to the Bc4 setup.",
  },
  danger: {
    eyebrow: "The danger · when he declines",
    headline: "No gift accepted, no fireworks. Just chess.",
    base: ["e2e4","c7c5","d2d4","c5d4","c2c3"], baseCount: null,
    plies: [
      { m: "g8f6", san: "3...Nf6!", note: "The decline. He refuses the pawn entirely and hits e4. Your gambit evaporates before it starts." },
      { m: "e4e5", san: "4.e5", note: "Kick — the only testing reply." },
      { m: "f6d5", san: "4...Nd5", note: "The knight perches in the center." },
      { m: "g1f3", san: "5.Nf3", note: "Develop first. Don't rush to win the pawn back — it comes home by itself." },
      { m: "b8c6", san: "5...Nc6", note: "He develops too." },
      { m: "c3d4", san: "6.cxd4", note: "The pawn returns. You've transposed into an Alapin structure." },
      { m: "d7d6", san: "6...d6", note: "A normal, respectable middlegame. No attack, no files, no drama — HE steered the game here, and now the better-prepared player simply wins. Know this structure." },
    ],
    ledgerTitle: "How opponents answer 3.c3 (1100–1500)",
    ledger: [
      { label: "3...dxc3 — gift accepted, gambit on", pct: 68, color: C.gold },
      { label: "3...Nf6 / 3...d3 — declines", pct: 24, color: C.red },
      { label: "Other", pct: 8, color: C.muted },
    ],
    survivalTitle: "Preparation plan — know this cold",
    survival: "Against 3...Nf6: 4.e5 Nd5 5.Nf3, then cxd4 — a comfortable Alapin where you own the center. Resist chasing the c3 pawn's memory; develop and the structure pays you back. The Morra player's real enemy is impatience in the declined lines.",
    bailoutTitle: "The bailout fork — move 3",
    bailoutMoves: ["e2e4","c7c5","d2d4","c5d4","g1f3"],
    bailoutLast: ["g1", "f3"],
    bailoutNote: "The sound exit: 3.Nf3, recapturing next move into an Open Sicilian — the professional's road. The Morra is a choice you make fresh every game, on this square.",
  },
  drills: [
    { id: "m1", kind: "move", plyCount: 12, from: "e4", to: "e5",
      prompt: "He developed 'normally' with 6...Nf6. Punish it.",
      hints: ["Your d-file battery is loaded. Open it.", "Push — and count the checks on d8 once the file opens."],
      reason: "7.e5! — the center detonates onto the open d-file. After ...dxe5 the ending is already lost for him." },
    { id: "m2", kind: "move", plyCount: 14, from: "d1", to: "d8",
      prompt: "The file is open. Fire.",
      hints: ["Queenless does not mean harmless — trade INTO the attack.", "The d-file runs all the way to his queen."],
      reason: "8.Qxd8+ — his king must recapture and becomes the d-file's doorman." },
    { id: "m3", kind: "move", plyCount: 16, from: "f3", to: "g5",
      prompt: "Queens are gone. Keep attacking anyway.",
      hints: ["Attacks don't need queens — they need targets. Find his weakest square.", "One knight hop threatens a royal fork."],
      reason: "9.Ng5! — Nxf7+ next forks king and rook, and f7 is covered by the c4 bishop from move 6." },
    { id: "m4", kind: "goal",
      prompt: "Quick check — what picture are you playing toward in this line?",
      options: [
        "A queenless fork: Nxf7, protected by the c4 bishop, wins the cornered rook",
        "Win the c3 pawn back and reach an equal endgame",
        "A back-rank mate with doubled rooks",
      ],
      correct: 0,
      reason: "If the goal fades, the moves turn into rote — and rote decays next." },
    { id: "m5", kind: "move", danger: true,
      moves: ["e2e4","c7c5","d2d4","c5d4","c2c3","g8f6","e4e5","f6d5"],
      from: "g1", to: "f3",
      prompt: "He declined with 3...Nf6. No gambit today — stay solid.",
      hints: ["Don't chase the pawn — develop toward the center.", "Knight out before the recapture."],
      reason: "5.Nf3 — develop first; cxd4 comes next and you own a comfortable Alapin center." },
  ],
};


const I2N = ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6"];
const SC4 = ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4"];
const F4N = ["e2e4","e7e5","g1f3","b8c6","b1c3","g8f6"];
const CW = "e1g1,h1f1", CB = "e8g8,h8f8";

const FRIED = {
  id: "fried", family: "italian", chip: "🍖 Fried Liver", badge: "🍖 FRIED LIVER · WHITE",
  conflicts: [
    { at: "after 2...Nc6", mine: "3.Bc4", vs: "repertoire", theirs: "3.d4 — the Scotch" },
    { at: "after 3...Nf6", mine: "4.Ng5!", vs: "lange", theirs: "4.d4!?" },
  ],
  chunks: { A: "Chunk A · The Italian shell", B: "Chunk B · The bite is offered", C: "Chunk C · The king hunt" },
  chunkGoals: {
    A: "A normal Italian until he plays ...Nf6 — the Two Knights, the sharpest crossroads in the open games. When this chunk ends, the adventure is one move away.",
    B: "Force ...d5 with the fork threat, then dangle the pawn. When this chunk ends his knight stands on d5 — the most natural square on the board, and the trap square.",
    C: "His king walks to e6 and lives there. He'll grab a whole rook on the way down — and it never leaves the corner. When this chunk ends, three pieces besiege a king in the open.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "Standard start." },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "f1c4", san: "3.Bc4", chunk: "A", anchor: true, note: "The f7 laser — it decides everything six moves from now." },
    { m: "g8f6", san: "3...Nf6", chunk: "A", note: "The Two Knights: he counterattacks instead of defending. Sharpness accepted." },
    { m: "f3g5", san: "4.Ng5!", chunk: "B", anchor: true, note: "Second knight move — with a royal-fork threat on f7.", why: { q: "'Don't move the same piece twice.' Why does this rule-break profit?", a: "Principles are price tags on tempo. Break one when the threat you create costs him more than your move cost you: Nxf7 threatens queen and rook, and the only real parry — ...d5 — is a committal pawn move. The books balance in your favor." } },
    { m: "d7d5", san: "4...d5", chunk: "B", note: "Essentially forced: block the c4 diagonal." },
    { m: "e4d5", san: "5.exd5", chunk: "B", note: "And now his problem: how to deal with d5." },
    { m: "f6d5", san: "5...Nxd5?!", chunk: "B", note: "The most natural move in chess — and the trap square. (5...Na5! is the theory: see Danger.)" },
    { m: "g5f7", san: "6.Nxf7!", chunk: "C", anchor: true, note: "The Fried Liver bite: knight for the king's coat." },
    { m: "e8f7", san: "6...Kxf7", chunk: "C", note: "" },
    { m: "d1f3", san: "7.Qf3+", chunk: "C", anchor: true, note: "The move that makes it all work.", why: { q: "Why is this check different from any other check?", a: "It does double duty: check on the king AND a second attacker on the loose d5 knight. The only move that holds both is ...Ke6 — the king as bodyguard. Combinations are built from moves with two jobs; single-purpose checks are just noise." } },
    { m: "f7e6", san: "7...Ke6", chunk: "C", note: "Forced. The king will live here." },
    { m: "b1c3", san: "8.Nc3", chunk: "C", note: "Third wave onto d5." },
    { m: "c6b4", san: "8...Ncb4", chunk: "C", note: "Defending d5 and eyeing c2 — the main defense." },
    { m: "a2a3", san: "9.a3!", chunk: "C", note: "Ask the question." },
    { m: "b4c2", san: "9...Nxc2+", chunk: "C", note: "He grabs on the way down —" },
    { m: "e1d1", san: "10.Kd1", chunk: "C", note: "" },
    { m: "c2a1", san: "10...Nxa1", chunk: "C", note: "A whole rook! And a knight in prison." },
    { m: "c3d5", san: "11.Nxd5", chunk: "C", note: "The payoff. The a1 knight never comes home; queen, knight and bishop swarm a king standing on e6. Theory scores this overwhelmingly for White — a rook is cheap rent for a king hunt." },
  ],
  promise: {
    eyebrow: "The promise · move 11", headline: "His king will live on e6.",
    plyCount: 21, last: ["c3", "d5"], marks: ["e6", "a1"],
    body: "Before you learn a single move: Black is up a whole rook — and his king stands in the middle of the board with three pieces circling. Can you see why the rook doesn't matter?",
    revealTitle: "11.Nxd5",
    reveal: "The knight that ate your rook is walled into the corner forever, while every White piece attacks. His king walked to e6 on move 7 to babysit a knight — and never got to leave. Material counts pieces; chess counts pieces that participate.",
    chip: "Roughly half of club opponents recapture 5...Nxd5 on sight.",
  },
  danger: {
    eyebrow: "The danger · when he knows", headline: "5...Na5 — and now YOU need the theory.",
    base: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6","f3g5","d7d5","e4d5"], baseCount: null,
    plies: [
      { m: "c6a5", san: "5...Na5!", note: "The book move: refuse the recapture, hit your bishop first." },
      { m: "c4b5", san: "6.Bb5+", note: "" },
      { m: "c7c6", san: "6...c6", note: "He gives the pawn back on his terms —" },
      { m: "d5c6", san: "7.dxc6", note: "" },
      { m: "b7c6", san: "7...bxc6", note: "" },
      { m: "b5e2", san: "8.Be2", note: "Retreat and regroup. You keep the extra pawn —" },
      { m: "h7h6", san: "8...h6", note: "" },
      { m: "g5f3", san: "9.Nf3", note: "" },
      { m: "e5e4", san: "9...e4!", note: "— and he keeps the initiative. Main line of modern theory: 10.Ne5 holds everything, but only if you know it. Prepared-fine is the only kind of fine here." },
    ],
    ledgerTitle: "How opponents answer 5.exd5 (club level)",
    ledger: [
      { label: "5...Nxd5?! — into the hunt", pct: 52, color: C.gold },
      { label: "5...Na5! — main theory", pct: 17, color: C.red },
      { label: "Other (...Nd4, ...b5)", pct: 31, color: C.muted },
    ],
    survivalTitle: "Preparation plan — know this cold",
    survival: "vs 5...Na5: Bb5+, c6, dxc6, bxc6, Be2 — then ...h6, Nf3, ...e4, Ne5. One sequence, drilled until automatic. Pawn for you, initiative for him, preparation decides.",
    bailoutTitle: "The zero-theory lane — move 4",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6","d2d3"],
    bailoutLast: ["d2", "d3"],
    bailoutNote: "4.d3 — the quiet Italian. No fork, no hunt, no homework. The adventure is optional; this square is where you choose it.",
  },
  drills: [
    { id: "f1", kind: "move", plyCount: 10, from: "g5", to: "f7",
      prompt: "He recaptured on d5. Your move.",
      hints: ["The knight on d5 is defended only by the queen — and the king is close.", "The bite."],
      reason: "6.Nxf7! — the Fried Liver: drag the king out while d5 hangs." },
    { id: "f2", kind: "move", plyCount: 12, from: "d1", to: "f3",
      prompt: "The king took. Find the double-duty move.",
      hints: ["One move must check AND attack the loose knight.", "Count what the d1 queen sees from f3."],
      reason: "7.Qf3+ — check plus a second attacker on d5. His king must bodyguard: ...Ke6." },
    { id: "f3", kind: "goal",
      prompt: "What picture are you playing toward in this line?",
      options: [
        "A king stranded on e6, besieged by three pieces, while his extra rook rots in the corner",
        "Win the d5 pawn and castle into a safe endgame",
        "A quick perpetual check for a draw",
      ], correct: 0,
      reason: "If the goal fades, the moves turn into rote — and rote decays next." },
    { id: "f4", kind: "move", danger: true,
      moves: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6","f3g5","d7d5","e4d5","c6a5"],
      from: "c4", to: "b5",
      prompt: "He played the book 5...Na5. Stay in theory.",
      hints: ["The bishop is attacked — save it with a check.", "The b5 square hits king and c6."],
      reason: "6.Bb5+ — the only testing move; then c6, dxc6, bxc6, Be2 and you keep the pawn." },
  ],
};

const GRECO = {
  id: "greco", family: "italian", chip: "🏛 Greco", badge: "🏛 GRECO · GIUOCO PIANO · WHITE",
  conflicts: [
    { at: "after 2...Nc6", mine: "3.Bc4", vs: "repertoire", theirs: "3.d4 — the Scotch" },
    { at: "after 5...exd4", mine: "6.cxd4", vs: "spear", theirs: "6.e5!?" },
  ],
  morphs: [{ ply: 14, when: "If he declines with 8...Bxc3 instead", to: "moller" }],
  chunks: { A: "Chunk A · The quiet game", B: "Chunk B · The center detonates", C: "Chunk C · Greed, punished since 1620" },
  chunkGoals: {
    A: "The Giuoco Piano — 'the quiet game' — with one quiet move, c3, that is anything but. When this chunk ends, a full center is loaded behind it.",
    B: "Fire d4, offer e4 as a gambit. When this chunk ends he has grabbed a pawn and a knight's worth of trouble with it.",
    C: "He eats a knight, then a rook — and loses to three pieces he never developed. Greco wrote this down four hundred years ago; it still works every day.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "f1c4", san: "3.Bc4", chunk: "A", note: "" },
    { m: "f8c5", san: "3...Bc5", chunk: "A", note: "The Giuoco Piano — mirror bishops." },
    { m: "c2c3", san: "4.c3!", chunk: "A", anchor: true, note: "The humble servant.", why: { q: "c3 blocks your own knight's best square. Why is it the most ambitious move on the board?", a: "It exists for one purpose: to rebuild the full pawn center with d4 next move. Quiet openings hide sharp centers — the move looks passive precisely because its point is one tempo in the future. Judge moves by what they prepare, not what they touch." } },
    { m: "g8f6", san: "4...Nf6", chunk: "A", note: "" },
    { m: "d2d4", san: "5.d4", chunk: "B", anchor: true, note: "The point of c3, delivered." },
    { m: "e5d4", san: "5...exd4", chunk: "B", note: "" },
    { m: "c3d4", san: "6.cxd4", chunk: "B", note: "Full center. His bishop must move with check —" },
    { m: "c5b4", san: "6...Bb4+", chunk: "B", note: "" },
    { m: "b1c3", san: "7.Nc3!?", chunk: "B", anchor: true, note: "The gambit: block the check by offering the e4 pawn." },
    { m: "f6e4", san: "7...Nxe4", chunk: "B", note: "Taken." },
    { m: CW, san: "8.O-O!", chunk: "C", anchor: true, note: "Castle into the storm.", why: { q: "A pawn down, pieces hanging — why is castling the attacking move?", a: "Because here castling is ammunition, not shelter: the f1 rook loads the e-file against his king, and the back rank clears for Qb3. You are about to offer the a1 rook too — development is the collateral that makes both sacrifices sound." } },
    { m: "e4c3", san: "8...Nxc3?", chunk: "C", note: "Deeper into the pit (9...d5! was the escape — see Danger)." },
    { m: "b2c3", san: "9.bxc3", chunk: "C", note: "" },
    { m: "b4c3", san: "9...Bxc3??", chunk: "C", note: "Greed to the end." },
    { m: "d1b3", san: "10.Qb3!", chunk: "C", anchor: true, note: "The double attack: the c3 bishop and f7 at once. He can't hold both —" },
    { m: "c3a1", san: "10...Bxa1", chunk: "C", note: "— so he eats the rook. The most expensive meal in chess history:" },
    { m: "c4f7", san: "11.Bxf7+", chunk: "C", note: "The bishop is immune — Qb3 guards it — so the king can only shuffle." },
    { m: "e8f8", san: "11...Kf8", chunk: "C", note: "" },
    { m: "c1g5", san: "12.Bg5!", chunk: "C", note: "The payoff. Ne5, Bg6 and Qf3 converge on a king with zero defenders, while his extra rook — the a1 bishop's trophy — watches from the wrong corner. Greco, 1620. Club players, every day since." },
  ],
  promise: {
    eyebrow: "The promise · move 12", headline: "He wins a rook. You win the game.",
    plyCount: 23, last: ["c1", "g5"], marks: ["a1", "f7"],
    body: "Before you learn a single move: Black is up a rook for two pawns — and completely lost. Every one of his pieces is on the back rank or trapped on a1. Can you see the finish?",
    revealTitle: "12.Bg5!",
    reveal: "Threats converge faster than he can develop: Ne5 comes with Bg6 and Qf3 behind it, the f7 bishop seals the king in, and nothing he owns can reach the kingside in time. He spent four moves capturing; you spent four moves aiming. This position is why development is counted in attackers, not in material.",
    chip: "After 7.Nc3, the double capture ...Nxc3 and ...Bxc3 is the most common club continuation.",
  },
  danger: {
    eyebrow: "The danger · the correct refund", headline: "9...d5! — and the dream dissolves.",
    base: null, baseCount: 17,
    plies: [
      { m: "d7d5", san: "9...d5!", note: "The escape: return the piece before it becomes a liability." },
      { m: "c3b4", san: "10.cxb4", note: "You take the bishop back —" },
      { m: "d5c4", san: "10...dxc4", note: "— he takes yours. Material level, queens on, roughly balanced. The Greco needed his greed; against the refund, just play chess with a fine position." },
    ],
    ledgerTitle: "After 8.O-O, how club opponents continue",
    ledger: [
      { label: "...Nxc3 and ...Bxc3 — full greed", pct: 55, color: C.gold },
      { label: "...d5! at the right moment", pct: 18, color: C.red },
      { label: "Other (...Bxc3 first, ...O-O)", pct: 27, color: C.muted },
    ],
    survivalTitle: "Preparation plan",
    survival: "When ...d5 comes: cxb4, dxc4 — equal and comfortable. Do not lash out trying to 'win back' what was never lost; the compensation was always the attack, and the attack only exists against greed.",
    bailoutTitle: "The bailout fork — move 7",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","f1c4","f8c5","c2c3","g8f6","d2d4","e5d4","c3d4","c5b4","c1d2"],
    bailoutLast: ["c1", "d2"],
    bailoutNote: "The sound lane: 7.Bd2 Bxd2+ 8.Nbxd2 — a small, safe, permanent pull with zero memorization. The gambit is dessert.",
  },
  drills: [
    { id: "g1", kind: "move", plyCount: 18, from: "d1", to: "b3",
      prompt: "He took knight, then pawn, then bishop. Punish the greed.",
      hints: ["One queen move attacks two targets he can't both hold.", "The a2–g8 diagonal and the c3 bishop share a defender: none."],
      reason: "10.Qb3! — double attack on c3 and f7. Whatever he saves, the other falls." },
    { id: "g2", kind: "move", plyCount: 20, from: "c4", to: "f7",
      prompt: "He ate the rook. Send the bill.",
      hints: ["The check his king cannot answer by capturing.", "Qb3 guards the sacrifice square."],
      reason: "11.Bxf7+ — immune bishop, shuffling king, and the mating pieces arrive next." },
    { id: "g3", kind: "goal",
      prompt: "What picture are you playing toward in this line?",
      options: [
        "Three developed pieces mate a bare king while his extra rook sits captured-but-useless on a1",
        "Regain the pawn and trade into an equal endgame",
        "Win the d4 pawn back with a fork",
      ], correct: 0,
      reason: "If the goal fades, the moves turn into rote — and rote decays next." },
    { id: "g4", kind: "move", danger: true, plyCount: 17, extra: ["d7d5"], from: "c3", to: "b4",
      prompt: "He found 9...d5 — the refund. Stay sound.",
      hints: ["Take what's offered; don't chase ghosts.", "The b4 bishop is the loose piece now."],
      reason: "10.cxb4 — accept the trade-back: dxc4 next, level and fine. The attack only ever existed against greed." },
  ],
};

const MIRROR = {
  id: "mirror", family: "knights", chip: "🪞 Copycat", badge: "🪞 FOUR KNIGHTS · COPYCAT · WHITE",
  conflicts: [
    { at: "after 2...Nc6", mine: "3.Nc3", vs: "repertoire", theirs: "3.d4 — the Scotch" },
    { at: "after 3...Nf6", mine: "4.Bb5", vs: "hallo", theirs: "4.Nxe5?!" },
  ],
  chunks: { A: "Chunk A · The hall of mirrors", B: "Chunk B · The mirror cracks", C: "Chunk C · The shatter" },
  chunkGoals: {
    A: "Perfect symmetry, move after move — which suits you fine, because you move first. When this chunk ends the boards are identical and the clock on his mirror is already ticking.",
    B: "Pose a question the mirror can't answer. When this chunk ends the same knight has landed on d5 twice — and copying has become a suicide pact.",
    C: "Break the symmetry yourself, on your terms: the shattered kingside, the harassed queen, the open g-file — all his.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "The mirror begins." },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "b1c3", san: "3.Nc3", chunk: "A", note: "" },
    { m: "g8f6", san: "3...Nf6", chunk: "A", note: "Four knights, two mirrors." },
    { m: "f1b5", san: "4.Bb5", chunk: "A", anchor: true, note: "The Spanish Four Knights — the classical main line." },
    { m: "f8b4", san: "4...Bb4", chunk: "A", note: "Copied." },
    { m: CW, san: "5.O-O", chunk: "A", note: "" },
    { m: CB, san: "5...O-O", chunk: "A", note: "Copied." },
    { m: "d2d3", san: "6.d3", chunk: "A", note: "" },
    { m: "d7d6", san: "6...d6", chunk: "A", note: "Copied. He's discovered a 'strategy'." },
    { m: "c1g5", san: "7.Bg5", chunk: "B", anchor: true, note: "The first question the mirror can't answer.", why: { q: "Why is symmetry a losing strategy for the player who moves second?", a: "Because perfect symmetry is a countdown: you're always one tempo ahead, so at some point a threat arrives that copying cannot parry — the copy IS the blunder. Your whole plan is to manufacture that moment before he wakes up and breaks the mirror himself." } },
    { m: "c8g4", san: "7...Bg4?!", chunk: "B", note: "The fatal copy. (7...Bxc3! was the exit — see Danger.)" },
    { m: "c3d5", san: "8.Nd5!", chunk: "B", anchor: true, note: "Hits the b4 bishop and leans on f6 — which is pinned to his queen by your g5 bishop. The mirror has no reply..." },
    { m: "c6d4", san: "8...Nd4?", chunk: "B", note: "...so he copies anyway, deeper into the pit." },
    { m: "d5b4", san: "9.Nxb4", chunk: "B", note: "" },
    { m: "d4b5", san: "9...Nxb5", chunk: "B", note: "Still mirroring —" },
    { m: "b4d5", san: "10.Nd5!", chunk: "B", note: "The same knight, the same square, the same threat. Again." },
    { m: "b5d4", san: "10...Nd4", chunk: "B", note: "Again." },
    { m: "d5f6+", san: "11.Nxf6+!", chunk: "C", anchor: true, note: "Now the mirror shatters — on your terms, with check." },
    { m: "g7f6", san: "11...gxf6", chunk: "C", note: "Forced recapture, ruining the king's cover." },
    { m: "g5f6", san: "12.Bxf6", chunk: "C", note: "The payoff. A pawn up, the d8 queen harassed, his king naked on the dark squares — and ...Nxf3+ gxf3 only opens YOUR g-file toward his king. Copying is not a plan; it's a countdown you don't control." },
  ],
  promise: {
    eyebrow: "The promise · move 12", headline: "The mirror always breaks. Choose whose side.",
    plyCount: 23, last: ["g5", "f6"], marks: ["d8", "g7"],
    body: "Before you learn a single move: the position was perfectly symmetrical for eleven moves — and now his kingside is rubble while yours is untouched. What happened?",
    revealTitle: "12.Bxf6",
    reveal: "First-move advantage is a fuse. He copied until a threat arrived that copying couldn't answer — Nd5 against the pinned f6 knight — and every copy after that dug deeper. A pawn up, dark squares owned, his queen homeless. Symmetry didn't fail him; being second did.",
    chip: "At club level, mirroring past move 6 in the Four Knights is remarkably common.",
  },
  danger: {
    eyebrow: "The danger · when he wakes up", headline: "7...Bxc3 — the mirror breaks safely.",
    base: null, baseCount: 13,
    plies: [
      { m: "b4c3", san: "7...Bxc3!", note: "The correct un-mirroring: remove the d5 jumper before it exists." },
      { m: "b2c3", san: "8.bxc3", note: "" },
      { m: "d8e7", san: "8...Qe7", note: "Solid. He broke the symmetry first and survives — a normal maneuvering game where your bishop pair and center give a pleasant, small, honest edge. The trap needed his sleepwalking; the position never needed it." },
    ],
    ledgerTitle: "After 7.Bg5, how opponents respond",
    ledger: [
      { label: "7...Bg4?! — the copy", pct: 44, color: C.gold },
      { label: "7...Bxc3! — the correct break", pct: 30, color: C.red },
      { label: "Other (...Ne7, ...h6)", pct: 26, color: C.muted },
    ],
    survivalTitle: "When the mirror breaks safely",
    survival: "After 7...Bxc3 8.bxc3 Qe7: double the pressure slowly — Re1, h3, Nh4-f5 ideas. You have the two bishops and the better structure; no tricks required, just patience.",
    bailoutTitle: "The bailout fork — move 4",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","b1c3","g8f6","d2d4","e5d4","f3d4"],
    bailoutLast: ["f3", "d4"],
    bailoutNote: "The other lane: 4.d4 — the Scotch Four Knights. Open, honest, no mirrors. Same first three moves, entirely different life.",
  },
  drills: [
    { id: "mc1", kind: "move", plyCount: 14, from: "c3", to: "d5",
      prompt: "He copied with 7...Bg4. Ask the unanswerable question.",
      hints: ["Find the move symmetry cannot copy profitably.", "The f6 knight is pinned; one of your knights can lean on it AND hit b4."],
      reason: "8.Nd5! — double pressure the mirror can't reflect." },
    { id: "mc2", kind: "move", plyCount: 18, from: "b4", to: "d5",
      prompt: "Trades on b4 and b5 — he's still copying. Continue.",
      hints: ["The same idea works twice.", "Back to the square that started it."],
      reason: "10.Nd5! — the same threat, one tempo ahead, forever." },
    { id: "mc3", kind: "goal",
      prompt: "What picture are you playing toward in this line?",
      options: [
        "His kingside shattered by Nxf6+/Bxf6 while the mirror-image kingside of yours stays perfect",
        "Win the b4 bishop and grind an endgame",
        "A drawn symmetrical rook ending",
      ], correct: 0,
      reason: "If the goal fades, the moves turn into rote — and rote decays next." },
    { id: "mc4", kind: "move", plyCount: 20, from: "d5", to: "f6",
      prompt: "The mirror is fully wound. Shatter it.",
      hints: ["Break the symmetry with check, on your terms.", "The pinned knight falls first."],
      reason: "11.Nxf6+! — gxf6 is forced, and Bxf6 collects a pawn plus his king's roof." },
    { id: "mc5", kind: "move", danger: true, plyCount: 13, extra: ["b4c3"], from: "b2", to: "c3",
      prompt: "He woke up: 7...Bxc3. Stay sound.",
      hints: ["Just recapture — toward the center.", "Keep the structure honest."],
      reason: "8.bxc3 — bishop pair, better center, patient edge. No tricks needed once the mirror breaks safely." },
  ],
};

const HALLO = {
  id: "hallo", family: "knights", chip: "🎃 Halloween", badge: "🎃 HALLOWEEN GAMBIT · WHITE",
  conflicts: [
    { at: "after 2...Nc6", mine: "3.Nc3", vs: "repertoire", theirs: "3.d4 — the Scotch" },
    { at: "after 3...Nf6", mine: "4.Nxe5?!", vs: "mirror", theirs: "4.Bb5" },
  ],
  chunks: { A: "Chunk A · Four quiet knights", B: "Chunk B · The scare", C: "Chunk C · The stampede" },
  chunkGoals: {
    A: "The most symmetric, solid opening in chess — which is exactly why the bomb under it works. When this chunk ends, nobody suspects anything.",
    B: "Give a whole knight for one pawn — and for the whip hand. When this chunk ends the chase has begun and his knights are running backwards.",
    C: "Two pawns abreast on the fifth rank, both his knights on the back rank, f7 in the crosshairs. Objectively dubious; practically a massacre.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "b1c3", san: "3.Nc3", chunk: "A", note: "" },
    { m: "g8f6", san: "3...Nf6", chunk: "A", note: "The Four Knights: peace declared. Or so he thinks." },
    { m: "f3e5", san: "4.Nxe5?!", chunk: "B", anchor: true, note: "The Halloween Gambit: a knight for a pawn and the initiative.", why: { q: "What is the knight actually buying — and why is it unsound AND terrifying at once?", a: "It buys tempo: every pawn push that chases his knights is a free attacking move, converting material into time and space. It's unsound because of an asymmetry — time can be repaid later, material can't. And it's terrifying because the refund window (5...Nc6!) is narrow, and most club players never find it." } },
    { m: "c6e5", san: "4...Nxe5", chunk: "B", note: "Accepted — almost universally." },
    { m: "d2d4", san: "5.d4", chunk: "B", note: "Chase one." },
    { m: "e5g6", san: "5...Ng6", chunk: "B", note: "The compliant retreat — the refund window just closed." },
    { m: "e4e5", san: "6.e5", chunk: "B", note: "Chase two." },
    { m: "f6g8", san: "6...Ng8", chunk: "B", note: "Both knights home. Undo, undo." },
    { m: "f1c4", san: "7.Bc4", chunk: "C", anchor: true, note: "Own half the board; put f7 in the crosshairs." },
    { m: "d7d6", san: "7...d6", chunk: "C", note: "Gasping for air —" },
    { m: "d1f3", san: "8.Qf3!", chunk: "C", note: "The payoff. Qxf7 threats, exd6 wedges, every Black piece on the back rank. The engine mumbles about equality; the scoreboard doesn't. This position wins club games before move 20, over and over." },
  ],
  promise: {
    eyebrow: "The promise · move 8", headline: "A knight for the whole board.",
    plyCount: 15, last: ["d1", "f3"], marks: ["f7"],
    body: "Before you learn a single move: White is a knight down — and Black's entire army is on its starting squares while two White pawns stand on the fifth rank. Who's actually winning here at a club board?",
    revealTitle: "8.Qf3!",
    reveal: "The knight bought eight tempi of chasing: a two-pawn steamroller, the f7 laser, the queen already attacking. Objectively Black survives with computer moves; practically, he has to find ten of them in a row with his pieces in the box. That gap between evaluation and scoreboard is the entire gambit.",
    chip: "The compliant 5...Ng6 retreat is by far the most common club reply.",
  },
  danger: {
    eyebrow: "The danger · the refund counter", headline: "5...Nc6! and the bill arrives.",
    base: ["e2e4","e7e5","g1f3","b8c6","b1c3","g8f6","f3e5","c6e5","d2d4"], baseCount: null,
    plies: [
      { m: "e5c6", san: "5...Nc6!", note: "The refund: retreat TOWARD the queenside, inviting the chase to overextend." },
      { m: "d4d5", san: "6.d5", note: "The chase continues — it must —" },
      { m: "f8b4", san: "6...Bb4!", note: "The pin: your c3 knight can no longer hold e4." },
      { m: "d5c6", san: "7.dxc6", note: "You win the piece back, but —" },
      { m: "f6e4", san: "7...Nxe4", note: "— material is level, c3 is paralyzed, and ...bxc6 plus ...Bxc3+ collect a pawn with the better game. The center you paid for never arrives. This line is why it's a blitz weapon, not a repertoire." },
    ],
    ledgerTitle: "How opponents retreat after 5.d4",
    ledger: [
      { label: "5...Ng6 — compliant, into the stampede", pct: 61, color: C.gold },
      { label: "5...Nc6! — the refund", pct: 14, color: C.red },
      { label: "Other (...Nd3+?!, declines)", pct: 25, color: C.muted },
    ],
    survivalTitle: "Damage control in the refund line",
    survival: "After 5...Nc6 6.d5 Bb4: play 7.dxc6 and fight — develop fast, accept a worse-but-playable game, and remember why you play this: for the 61%, not the 14%. Retire it as your opposition climbs.",
    bailoutTitle: "The grown-up lane — move 4",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","b1c3","g8f6","f1b5"],
    bailoutLast: ["f1", "b5"],
    bailoutNote: "4.Bb5 — the Spanish Four Knights (see the Copycat pack). Same position, respectable life. The costume is optional.",
  },
  drills: [
    { id: "ha1", kind: "move", plyCount: 8, from: "d2", to: "d4",
      prompt: "Gambit accepted. Start collecting.",
      hints: ["The knight paid for tempo — spend it.", "Chase with a center pawn."],
      reason: "5.d4 — every chasing push is a free attacking move." },
    { id: "ha2", kind: "move", plyCount: 10, from: "e4", to: "e5",
      prompt: "One knight ran. Keep the stampede going.",
      hints: ["The other knight is still in the road.", "Second pawn, second chase."],
      reason: "6.e5 — both knights go home; the board becomes yours." },
    { id: "ha3", kind: "goal",
      prompt: "What is this gambit actually built on?",
      options: [
        "Converting a knight into eight tempi of chasing — winning on momentum before the refund arrives",
        "A forced mate on f7 in all lines",
        "Winning the e5 pawn back with interest",
      ], correct: 0,
      reason: "Know what you bought: time. It's why you must play fast, and why you retire this weapon as opponents improve." },
    { id: "ha4", kind: "move", danger: true,
      moves: ["e2e4","e7e5","g1f3","b8c6","b1c3","g8f6","f3e5","c6e5","d2d4","e5c6"],
      from: "d4", to: "d5",
      prompt: "He retreated 5...Nc6 — the refund line. Best try?",
      hints: ["Stopping now means a knight for nothing. Commit.", "Keep asking the knight questions."],
      reason: "6.d5 — the only consistent try; after ...Bb4! 7.dxc6 Nxe4 you fight a worse game. Know the bill before you shop." },
  ],
};

const MIESES = {
  id: "mieses", family: "scotch", chip: "🧱 Mieses", badge: "🧱 SCOTCH · MIESES · WHITE",
  morphs: [{ ply: 7, when: "If he plays 4...Bc5 instead", to: "classical", note: "the other main crossroads — now its own full pack" }],
  chunks: { A: "Chunk A · The Scotch break", B: "Chunk B · The structural trade", C: "Chunk C · The grip" },
  chunkGoals: {
    A: "Open the center on move 3 and recapture with the knight. When this chunk ends you're in the main-line Scotch — Kasparov's revival weapon.",
    B: "Volunteer the knight trade that 'fixes' his center — then hit f6 before the paint dries. When this chunk ends his queen babysits a loose pawn and his knight has begun a long dance.",
    C: "The c4 grip: space today, the healthier pawn majority forever. No trap anywhere — this is what a professional advantage looks like.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "d2d4", san: "3.d4", chunk: "A", anchor: true, note: "The Scotch break." },
    { m: "e5d4", san: "3...exd4", chunk: "A", note: "" },
    { m: "f3d4", san: "4.Nxd4", chunk: "A", note: "" },
    { m: "g8f6", san: "4...Nf6", chunk: "A", note: "The classical main — hitting e4." },
    { m: "d4c6", san: "5.Nxc6", chunk: "B", anchor: true, note: "The volunteer.", why: { q: "This trade hands him a broad center and a half-open file. Why do world champions offer it?", a: "Structural books are read at the end of the game: doubled c-pawns can never make a healthy passed pawn; your clean kingside 4-v-3 can. His 'nice' center is a present — your majority is a pension. And the trade is timed with a tactic: e5 lands before he can arrange a better recapture." } },
    { m: "b7c6", san: "5...bxc6", chunk: "B", note: "The center looks great. For now." },
    { m: "e4e5", san: "6.e5!", chunk: "B", anchor: true, note: "Tempo on f6 — the point of the timing." },
    { m: "d8e7", san: "6...Qe7", chunk: "B", note: "Pinning back at the loose e5 pawn —" },
    { m: "d1e2", san: "7.Qe2", chunk: "B", note: "Held. The clamp stays." },
    { m: "f6d5", san: "7...Nd5", chunk: "B", note: "The dance begins." },
    { m: "c2c4", san: "8.c4", chunk: "C", anchor: true, note: "The grip." },
    { m: "c8a6", san: "8...Ba6!", chunk: "C", note: "The main counter — pressuring c4 through the hole his structure left." },
    { m: "b2b3", san: "9.b3", chunk: "C", note: "The payoff — the modern tabiya. Bb2, Nd2 and g3 come next; you nurse the space and the majority for forty moves. No fireworks, no trap: a pension. 'Usual advantage' looks exactly like this — Kasparov–Karpov, 1990, board one of chess history." },
  ],
  promise: {
    eyebrow: "The promise · the tabiya", headline: "No trap. A pension.",
    plyCount: 17, last: ["b2", "b3"], marks: ["e5", "c4"],
    body: "Before you learn a single move: nothing is hanging, nobody is mated, and White is better in a way that lasts forty moves. Can you see where the advantage lives?",
    revealTitle: "9.b3",
    reveal: "Two places: the e5–c4 space clamp that keeps his pieces dancing, and the pawn skeleton — his doubled c-pawns can never produce a passed pawn, your kingside 4-v-3 can. Most payoffs in real openings look like this: not a combination, but a promise the endgame keeps.",
    chip: "The Mieses is the main line of the modern Scotch at every level.",
  },
  danger: {
    eyebrow: "The danger · the other crossroads", headline: "4...Bc5 — a second mainline to carry.",
    morphTo: "classical",
    base: SC4, baseCount: null,
    plies: [
      { m: "f8c5", san: "4...Bc5", note: "The other main move — and a different opening entirely." },
      { m: "c1e3", san: "5.Be3", note: "Your best: reinforce d4 with an x-ray on c5." },
      { m: "d8f6", san: "5...Qf6!", note: "The accurate reply (5...Nf6?? loses a piece to 6.Nxc6 — the tension trap). Now 6.c3 or 6.Nb5 and a rich fight. The Scotch's tax is breadth: two mainlines, both mandatory. Budget your memory accordingly." },
    ],
    ledgerTitle: "Black's 4th move at club level",
    ledger: [
      { label: "4...Nf6 — into the Mieses", pct: 41, color: C.gold },
      { label: "4...Bc5 — the second front", pct: 38, color: C.red },
      { label: "Other (...Qh4?!, ...Nxd4?!)", pct: 21, color: C.muted },
    ],
    survivalTitle: "Carrying two mainlines",
    survival: "vs 4...Bc5: 5.Be3 Qf6 6.c3 Nge7 — learn the tabiya, not deep lines. The Mieses gets your depth budget; the Bc5 world gets your pattern budget. Spending equally on both is how repertoires drown.",
    bailoutTitle: "The quieter lane — move 5",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4","g8f6","b1c3"],
    bailoutLast: ["b1", "c3"],
    bailoutNote: "5.Nc3 — the Scotch Four Knights. Less theory, less bite, entirely respectable. The Mieses is the ambitious choice, not the only one.",
  },
  drills: [
    { id: "ms1", kind: "move", plyCount: 8, from: "d4", to: "c6",
      prompt: "He played 4...Nf6. Begin the structural bargain.",
      hints: ["Trade now, while his recapture is forced toward the edge.", "The pension move."],
      reason: "5.Nxc6 — doubled pawns for him, the healthy majority for you, and e5 comes with tempo." },
    { id: "ms2", kind: "move", plyCount: 10, from: "e4", to: "e5",
      prompt: "He recaptured. Strike before he settles.",
      hints: ["The trade was timed for this exact push.", "Hit the knight while the dust is still up."],
      reason: "6.e5! — tempo on f6; his queen must babysit and his knight starts dancing." },
    { id: "ms3", kind: "goal",
      prompt: "Where does White's advantage actually live in this line?",
      options: [
        "The space clamp plus the pawn skeleton: his doubled pawns can't queen, your 4-v-3 majority can",
        "A forced win of the c6 pawn",
        "A kingside mating attack with Qh5",
      ], correct: 0,
      reason: "Payoffs without fireworks are payoffs the endgame delivers. If you can't name where the edge lives, you'll trade it away by move 20." },
    { id: "ms4", kind: "move", danger: true,
      moves: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4","f8c5"],
      from: "c1", to: "e3",
      prompt: "He chose the other crossroads: 4...Bc5. First move of front two?",
      hints: ["Reinforce the knight and add an x-ray.", "The bishop that punishes 5...Nf6??"],
      reason: "5.Be3 — solid, and the tension trap (6.Nxc6!) is loaded against natural development." },
  ],
};

const PETROFF = {
  id: "petroff", family: "shield", chip: "🎭 Petroff", badge: "🎭 PETROFF · COPYCAT TOLL · WHITE",
  chunks: { A: "Chunk A · The copy declared", B: "Chunk B · The x-ray loads", C: "Chunk C · The discovered bill" },
  chunkGoals: {
    A: "He answers your open game with a mirror: 'whatever you take, I take.' When this chunk ends you've taken first — and his copy is due.",
    B: "One quiet queen move lines up an x-ray through two knights to his king. When this chunk ends, the e-file is a loaded gun that hasn't fired.",
    C: "The knight steps aside with DISCOVERED check — and lands on his queen. A whole queen for move order. The Petroff is sound; his impatience isn't.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "g8f6", san: "2...Nf6", chunk: "A", note: "The Petroff: instead of defending e5, he counterattacks e4. 'I'll copy you.'" },
    { m: "f3e5", san: "3.Nxe5", chunk: "B", anchor: true, note: "Take first, ask later." },
    { m: "f6e4", san: "3...Nxe4?", chunk: "B", note: "The copy — natural, constant, and wrong. (Theory: 3...d6! first, THEN take. Order is everything.)" },
    { m: "d1e2", san: "4.Qe2!", chunk: "B", anchor: true, note: "The x-ray.", why: { q: "The queen move attacks a defended knight. What is it really doing?", a: "Count the file: Qe2 — his knight e4 — your knight e5 — his king e8. Both knights are temporary tenants; when they leave, the file is a loaded gun pointed at the king, and your own knight leaving IS the trigger. Moves that create alignments matter before they create threats — learn to see the file behind the pieces." } },
    { m: "e4f6", san: "4...Nf6??", chunk: "C", note: "Retreating out of the 'attack' — and pulling the trigger himself." },
    { m: "e5c6+", san: "5.Nc6+!", chunk: "C", anchor: true, note: "DISCOVERED check from the e2 queen — and the knight lands next to his queen. No square saves both." },
    { m: "f8e7", san: "5...Be7", chunk: "C", note: "Blocking the check —" },
    { m: "c6d8", san: "6.Nxd8", chunk: "C", note: "The payoff: a whole queen for correct move order. The Petroff itself is one of the soundest openings in chess — the toll is charged only on the copy played one move too early. Thousands pay it every day." },
  ],
  promise: {
    eyebrow: "The promise · move 5", headline: "A queen for a move order.",
    plyCount: 9, last: ["e5", "c6"], marks: ["e2", "d8"],
    body: "Before you learn a single move: this knight just moved out of an attack — with devastating effect. It's check, and it isn't the knight checking. Can you see the geometry?",
    revealTitle: "5.Nc6+!",
    reveal: "Discovered check: the e2 queen has stared at e8 through both knights since move 4. His retreat cleared one blocker; your jump clears the other — with the knight landing on d8's doorstep. Any block still loses the queen to Nxd8. The whole trap is one alignment, seen two moves early.",
    chip: "The premature 3...Nxe4? is among the most common club-level Petroff errors.",
  },
  danger: {
    eyebrow: "The danger · the correct order", headline: "3...d6! — and it's just the Petroff.",
    base: ["e2e4","e7e5","g1f3","g8f6","f3e5"], baseCount: null,
    plies: [
      { m: "d7d6", san: "3...d6!", note: "The correct order: evict the knight FIRST." },
      { m: "e5f3", san: "4.Nf3", note: "" },
      { m: "f6e4", san: "4...Nxe4", note: "NOW the copy is safe — no discovery exists." },
      { m: "d2d4", san: "5.d4", note: "" },
      { m: "d6d5", san: "5...d5", note: "The real Petroff tabiya: solid, symmetric, famously hard to beat. Your trap needed his impatience; against the correct order, settle in for classical chess — d3-strikes, Re1, the long game." },
    ],
    ledgerTitle: "How opponents handle move 3",
    ledger: [
      { label: "3...Nxe4? — the premature copy", pct: 37, color: C.gold },
      { label: "3...d6! — correct order", pct: 51, color: C.red },
      { label: "Other (...Qe7, ...Nc6?!)", pct: 12, color: C.muted },
    ],
    survivalTitle: "Against the correct Petroff",
    survival: "3...d6 4.Nf3 Nxe4 5.d4 d5 — then Bd3, O-O, c4 or Re1. No refutation exists; play for small pressure and better endgames. The dream line is a bonus, not the plan.",
    bailoutTitle: "The sidestep — move 3",
    bailoutMoves: ["e2e4","e7e5","g1f3","g8f6","b1c3"],
    bailoutLast: ["b1", "c3"],
    bailoutNote: "3.Nc3 — decline the whole discussion and steer toward Four Knights waters. The toll booth is optional; the Petroff main roads are long.",
  },
  drills: [
    { id: "pt1", kind: "move", plyCount: 6, from: "d1", to: "e2",
      prompt: "He copied prematurely with 3...Nxe4. Load the gun.",
      hints: ["Look down the e-file: what's aligned behind the knights?", "The quiet move that creates the alignment."],
      reason: "4.Qe2! — queen, his knight, your knight, his king: an x-ray waiting for the blockers to leave." },
    { id: "pt2", kind: "move", plyCount: 8, from: "e5", to: "c6",
      prompt: "He retreated 4...Nf6. Fire.",
      hints: ["Your knight leaving IS the trigger.", "Step aside toward his queen."],
      reason: "5.Nc6+! — discovered check plus a knight on the queen's doorstep. Any block, then Nxd8." },
    { id: "pt3", kind: "goal",
      prompt: "What is the entire trap built on?",
      options: [
        "One alignment: queen and king sharing the e-file through two temporary knights",
        "A weak f7 pawn attacked twice",
        "Winning the e5 pawn permanently",
      ], correct: 0,
      reason: "See files behind pieces and you'll find this trap's cousins in a dozen openings." },
    { id: "pt4", kind: "move", danger: true,
      moves: ["e2e4","e7e5","g1f3","g8f6","f3e5","d7d6"],
      from: "e5", to: "f3",
      prompt: "He knows the order: 3...d6. Respond correctly.",
      hints: ["The knight is evicted — go home the useful way.", "Back where it watches d4 and e5."],
      reason: "4.Nf3 — then Nxe4, d4, d5: the sound Petroff tabiya. Play chess, keep the toll booth for the impatient." },
  ],
};

const PHILIDOR = {
  id: "philidor", family: "shield", chip: "🪨 Philidor", badge: "🪨 PHILIDOR · THE PASSIVE WALL · WHITE",
  chunks: { A: "Chunk A · The wall declared", B: "Chunk B · The pin dissolved", C: "Chunk C · The opera bill" },
  chunkGoals: {
    A: "He guards e5 with a pawn instead of a piece: solid-looking, and one tempo of pressure from cracking. Open the center at once.",
    B: "His pin 'develops' into your capture. Trade off the pin, recapture with the queen — and two of your pieces now stare at f7 and b7.",
    C: "One queen move attacks two undefended points. Whichever he saves, you collect the other — the oldest winning geometry in chess.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "d7d6", san: "2...d6", chunk: "A", note: "The Philidor wall: a pawn guards e5 so no piece has to. Your most common non-Scotch reply — and the most passive." },
    { m: "d2d4", san: "3.d4", chunk: "A", anchor: true, note: "The same break as the Scotch, one move earlier in spirit: hit e5 while his pieces still sleep.", why: { q: "Why attack the strong point he just defended?", a: "Because the defender he chose can't hold the job: the e5 pawn is guarded by d6, but d6 answers to YOUR d4 pawn. A pawn defending a pawn under central tension is a liability chain, not a wall — every exchange on e5/d4 opens lines toward a king that hasn't moved. Passive setups die by one well-timed break, not by assault." } },
    { m: "c8g4", san: "3...Bg4?!", chunk: "B", note: "The pin — the classic club answer, played for 170 years. It loses material by force. (3...exd4 is the honest road: see Edge cases.)" },
    { m: "d4e5", san: "4.dxe5!", chunk: "B", anchor: true, note: "Call the pin's bluff mid-air." },
    { m: "g4f3", san: "4...Bxf3", chunk: "B", note: "He must cash the pin now — 4...dxe5?? 5.Qxd8+ Kxd8 6.Nxe5 just wins a pawn with Nxf7+ hanging over the ashes." },
    { m: "d1f3", san: "5.Qxf3", chunk: "B", note: "Recapture with the piece that ATTACKS: the queen eyes b7 and f7 from f3 already." },
    { m: "d6e5", san: "5...dxe5", chunk: "B", note: "Material restored — geometry conceded." },
    { m: "f1c4", san: "6.Bc4", chunk: "C", anchor: true, note: "The laser finds f7 — the second barrel of a two-barreled gun." },
    { m: "g8f6", san: "6...Nf6", chunk: "C", note: "Blocking the f7 threat the natural way —" },
    { m: "f3b3", san: "7.Qb3!", chunk: "C", anchor: true, note: "One queen shift, two targets: b7 hangs and f7 is attacked twice. This is the Opera Game — Morphy, Paris 1858, the most famous chess ever played — and his opponents were a duke and a count doing exactly what your opponents do.", why: { q: "Why does one queen move win material against ANY defense?", a: "Count the targets: b7 is attacked once and defended zero; f7 is attacked twice and defended once. One move cannot fix two problems two files apart — so he must choose what to lose. Double attack isn't a trick, it's arithmetic; the whole line existed to buy this geometry with tempo." } },
  ],
  promise: {
    eyebrow: "The promise · move 7", headline: "Two targets. One defender.",
    plyCount: 13, last: ["f3", "b3"], marks: ["b7", "f7"],
    body: "Before you learn a single move: material is level, nothing is captured — and Black is already losing something. Can you see the two points that cannot both survive?",
    revealTitle: "7.Qb3!",
    reveal: "b7: attacked by the queen, defended by nobody. f7: attacked by queen and bishop, defended once. His best try (7...Qe7) saves f7 and surrenders b7 — a clean pawn and the bishop pair in an endgame. This exact position is the Opera Game of 1858; club players walk into it every day, 170 years later.",
    chip: "The pin 3...Bg4?! is among the most common club replies to 3.d4 — and it has been refuted since 1858.",
  },
  danger: {
    eyebrow: "The edge case · the honest road", headline: "3...exd4 — he opens the game himself.",
    base: null, baseCount: 5,
    plies: [
      { m: "e5d4", san: "3...exd4", note: "The correct reply: trade the tension away before it costs something." },
      { m: "f3d4", san: "4.Nxd4", note: "A Scotch-like center for free: your knight owns d4 and his d6 pawn now BLOCKS his dark-square bishop instead of guarding anything." },
      { m: "g8f6", san: "4...Nf6", note: "" },
      { m: "b1c3", san: "5.Nc3", note: "" },
      { m: "f8e7", san: "5...Be7", note: "The Philidor bishop, employed as a wall ornament." },
      { m: "f1e2", san: "6.Be2", note: "" },
      { m: "e8g8,h8f8", san: "6...O-O", note: "" },
      { m: "e1g1,h1f1", san: "7.O-O", note: "The honest best-play version: no tricks, no material — just more space, a freer bishop, and a d6 pawn that will need an apology all game. Play c4 ideas, Bf3, watch d5. This is a better version of the open games you already play." },
    ],
    ledgerTitle: "How club players meet 3.d4 (≈, at your level)",
    ledger: [
      { label: "3...Bg4?! — the pin, refuted since 1858", pct: 30, color: C.gold },
      { label: "3...exd4 — the honest road", pct: 40, color: C.red },
      { label: "Other (...Nd7, ...Nf6, ...f6?!)", pct: 30, color: C.muted },
    ],
    survivalTitle: "Against the honest road",
    survival: "3...exd4 4.Nxd4 and play a free-flowing open game: Nc3, Be2, O-O, then c4 or f4 by taste. Against 3...Nd7 (the Hanham), 4.Bc4 keeps maximum pressure — watch for the classic 4...Be7?? 5.dxe5 dxe5 6.Qd5! hitting f7. Against 3...Nf6, 4.dxe5 Nxe4 5.Qd5! wins the pawn back with interest.",
    bailoutTitle: "The quiet lane",
    bailoutMoves: ["e2e4","e7e5","g1f3","d7d6","f1c4"],
    bailoutLast: ["f1", "c4"],
    bailoutNote: "3.Bc4 — decline the theory discussion, develop, and castle. The break stays in your pocket; d4 works on move 5 as well as move 3.",
  },
  drills: [
    { id: "ph1", kind: "move", plyCount: 4, from: "d2", to: "d4",
      prompt: "He built the Philidor wall with 2...d6. Answer it.",
      hints: ["The wall's defender has a job it can't keep.", "Same medicine as the Scotch: the central break."],
      reason: "3.d4 — hit e5 immediately: every exchange opens lines while his pieces are still parked." },
    { id: "ph2", kind: "move", plyCount: 6, from: "d4", to: "e5",
      prompt: "He pinned with 3...Bg4. Call the bluff.",
      hints: ["The pin only 'works' if the tension stays.", "Take — and make him prove the pin was real."],
      reason: "4.dxe5! — now 4...dxe5?? 5.Qxd8+ Kxd8 6.Nxe5 wins a pawn, so he must give the bishop for the knight." },
    { id: "ph3", kind: "move", plyCount: 12, from: "d1", to: "b3",
      prompt: "His knight blocked f7. Find the move the Opera House applauded.",
      hints: ["Two undefended points share one diagonal-and-file geometry.", "The queen re-aims; the bishop already aims."],
      reason: "7.Qb3! — double attack on b7 and f7. Morphy, 1858. He cannot save both." },
    { id: "ph4", kind: "goal",
      prompt: "Why is the 'solid' Philidor wall losing a pawn by move 7 here?",
      options: [
        "A pawn defending a pawn under central tension is a liability chain — one break plus one pin-call collapses it",
        "Because 2...d6 loses by force",
        "White's pieces are simply faster in every opening",
      ], correct: 0,
      reason: "The wall wasn't wrong — it was passive. Passive setups lose to well-timed breaks; that lesson transfers to every ...d6 system you'll ever face." },
    { id: "ph5", kind: "move", danger: true, plyCount: 5, extra: ["e5d4"], from: "f3", to: "d4",
      prompt: "He took the honest way: 3...exd4. Recapture correctly.",
      hints: ["Which piece WANTS the d4 square?", "Keep the queen home; the knight centralizes."],
      reason: "4.Nxd4 — a free Scotch-like center; his d6 pawn now just blocks his own bishop." },
  ],
};

const LANGE = {
  id: "lange", family: "italian", chip: "🌀 Max Lange", badge: "🌀 MAX LANGE ATTACK · WHITE",
  conflicts: [
    { at: "after 2...Nc6", mine: "3.Bc4", vs: "repertoire", theirs: "3.d4 — the Scotch" },
    { at: "after 3...Nf6", mine: "4.d4!?", vs: "fried", theirs: "4.Ng5!" },
  ],
  morphs: [{ ply: 6, when: "This position also arrives via the Scotch Gambit (3.d4 exd4 4.Bc4 Nf6 5.O-O)", to: "scotch" }],
  chunks: { A: "Chunk A · The hybrid break", B: "Chunk B · The e-file loads", C: "Chunk C · The rent comes due" },
  chunkGoals: {
    A: "Play the Scotch break inside the Italian: d4 against the Two Knights. When this chunk ends the center is open and the sharpest square in the position is one he can't see yet: e1.",
    B: "Castle — not for shelter, for ammunition. When this chunk ends his greedy knight sits on e4 with your rook staring through it at his king.",
    C: "Remove the prop, fork the queen, collect the pinned knight. Material comes out even; the position doesn't.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "f1c4", san: "3.Bc4", chunk: "A", note: "" },
    { m: "g8f6", san: "3...Nf6", chunk: "A", note: "Two Knights —" },
    { m: "d2d4", san: "4.d4!?", chunk: "A", anchor: true, note: "— answered with the Scotch break: the Italian-Scotch hybrid." },
    { m: "e5d4", san: "4...exd4", chunk: "A", note: "" },
    { m: CW, san: "5.O-O!", chunk: "B", anchor: true, note: "A pawn down, castling.", why: { q: "You're a pawn down and 'wasting' a move on king safety. Why is castling the most aggressive move here?", a: "Because this castling isn't shelter — it's ammunition. The point is the f1 rook's new job: Re1 onto the file his king lives on. You're paying a pawn for a file and for a tempo that hasn't happened yet. Evaluate castling by what the rook does, not where the king hides." } },
    { m: "f6e4", san: "5...Nxe4?", chunk: "B", note: "Greed on precisely the wrong file. (5...Bc5! is the real Max Lange — see Danger.)" },
    { m: "f1e1", san: "6.Re1", chunk: "B", anchor: true, note: "The rent comes due: the rook x-rays through his knight to the king." },
    { m: "d7d5", san: "6...d5", chunk: "B", note: "Propping the knight with a pawn —" },
    { m: "c4d5", san: "7.Bxd5!", chunk: "C", anchor: true, note: "Remove the prop. The bishop is expendable; the pin is not." },
    { m: "d8d5", san: "7...Qxd5", chunk: "C", note: "" },
    { m: "b1c3", san: "8.Nc3!", chunk: "C", anchor: true, note: "Fork the queen — and note the e4 knight is nailed to the king by your rook. Two problems, one move each way." },
    { m: "d5a5", san: "8...Qa5", chunk: "C", note: "The queen sidesteps —" },
    { m: "c3e4", san: "9.Nxe4", chunk: "C", note: "The payoff. Count material: dead even. Count position: open e-file with your rook on it, every White piece developed, his king stuck in the crossfire, d4 falling next. A 'usual advantage' worth a pawn any day of the week — bought entirely by his 5...Nxe4." },
  ],
  promise: {
    eyebrow: "The promise · move 9", headline: "Even material. Nothing else is even.",
    plyCount: 17, last: ["c3", "e4"], marks: ["e1", "e8"],
    body: "Before you learn a single move: no material has been won — and White is close to winning. Every imbalance here is invisible to a material counter. Can you list them?",
    revealTitle: "9.Nxe4",
    reveal: "The e-file with a rook already on it, three developed pieces to his zero, a king that can no longer castle safely into the x-ray, and the d4 pawn falling next move. He grabbed one pawn on move 5 and paid in every other currency chess has.",
    chip: "5...Nxe4 is the instinctive club reply to the hybrid break.",
  },
  danger: {
    eyebrow: "The danger · the real Max Lange", headline: "5...Bc5! — the labyrinth entrance.",
    base: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6","d2d4","e5d4","e1g1,h1f1"], baseCount: null,
    plies: [
      { m: "f8c5", san: "5...Bc5!", note: "The correct move — and the door to one of the sharpest corridors in the open games." },
      { m: "e4e5", san: "6.e5", note: "" },
      { m: "d7d5", san: "6...d5!", note: "The counter-spear —" },
      { m: "e5f6", san: "7.exf6", note: "" },
      { m: "d5c4", san: "7...dxc4", note: "" },
      { m: "f1e1+", san: "8.Re1+", note: "The file again —" },
      { m: "c8e6", san: "8...Be6", note: "" },
      { m: "f3g5", san: "9.Ng5!", note: "The Max Lange proper: both kings on a cliff edge, every move forced or fatal, theory thirty moves deep. Magnificent — and strictly members-only. Enter with the map memorized or take the bailout." },
    ],
    ledgerTitle: "How opponents meet 5.O-O",
    ledger: [
      { label: "5...Nxe4? — the greedy file", pct: 46, color: C.gold },
      { label: "5...Bc5! — the true Max Lange", pct: 33, color: C.red },
      { label: "Other (...d6, ...Be7)", pct: 21, color: C.muted },
    ],
    survivalTitle: "At the labyrinth door",
    survival: "The 5...Bc5 lines reward the better-prepared player and destroy tourists. Learn the spine — e5, d5, exf6, dxc4, Re1+, Be6, Ng5 — before playing 4.d4 in serious games, or choose the bailout and keep the hybrid for blitz.",
    bailoutTitle: "The quiet lane — move 4",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6","d2d3"],
    bailoutLast: ["d2", "d3"],
    bailoutNote: "4.d3 — the modern quiet Italian: same pieces, one-tenth the memorization, a long maneuvering game. The labyrinth will still be there when you want it.",
  },
  drills: [
    { id: "la1", kind: "move", plyCount: 10, from: "f1", to: "e1",
      prompt: "He grabbed on e4. Charge rent.",
      hints: ["Why did you castle? Use it.", "The file his king lives on."],
      reason: "6.Re1 — the x-ray pin that turns his extra pawn into a liability." },
    { id: "la2", kind: "move", plyCount: 12, from: "c4", to: "d5",
      prompt: "He propped the knight with ...d5. Your move.",
      hints: ["The prop is worth more than your bishop.", "Remove the defender, keep the pin."],
      reason: "7.Bxd5! — the pin is the asset; the bishop is just its price." },
    { id: "la3", kind: "move", plyCount: 14, from: "b1", to: "c3",
      prompt: "His queen recaptured on d5. One move, two problems.",
      hints: ["Fork the queen with development.", "Remember what the e1 rook holds in place."],
      reason: "8.Nc3! — the queen must run, and the pinned e4 knight falls next: 9.Nxe4." },
    { id: "la4", kind: "goal",
      prompt: "What did Black's extra pawn actually cost him in this line?",
      options: [
        "The e-file, three tempi of development, castling safety, and the d4 pawn — every currency except material",
        "Nothing — the line is equal",
        "His queen, to a knight fork",
      ], correct: 0,
      reason: "Advantages have currencies. When material is even, count the others — that's where 'usual advantages' live." },
    { id: "la5", kind: "move", danger: true,
      moves: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6","d2d4","e5d4","e1g1,h1f1","f8c5","e4e5","d7d5"],
      from: "e5", to: "f6",
      prompt: "The real Max Lange: 5...Bc5 6.e5 d5. Stay on the spine.",
      hints: ["Don't save the bishop — that's the tourist move.", "Take what attacks nothing yet."],
      reason: "7.exf6! — the labyrinth's spine; then dxc4, Re1+, Be6, Ng5 with everything hanging by theory." },
  ],
};

const SPEAR = {
  id: "spear", family: "italian", chip: "🗡 Center Spear", badge: "🗡 ITALIAN CENTER ATTACK · WHITE",
  conflicts: [
    { at: "after 2...Nc6", mine: "3.Bc4", vs: "repertoire", theirs: "3.d4 — the Scotch" },
    { at: "after 5...exd4", mine: "6.e5!?", vs: "greco", theirs: "6.cxd4" },
  ],
  morphs: [{ ply: 10, when: "Prefer recapturing 6.cxd4 here?", to: "greco", note: "the Greco/Møller complex — same build, other weapon" }],
  chunks: { A: "Chunk A · The quiet build", B: "Chunk B · The spear", C: "Chunk C · The desperado unravels" },
  chunkGoals: {
    A: "The Giuoco Piano again — c3 loading d4. When this chunk ends, the same quiet center that feeds the Greco is ready to fire a different weapon.",
    B: "Instead of recapturing on d4, thrust e5 — the spear that attacks his knight and lights up d5. When this chunk ends his knight has jumped to the one square that loses.",
    C: "Bd5 traps the knight; his desperado flurry burns out; you emerge a piece up for two pawns with monster bishops.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "f1c4", san: "3.Bc4", chunk: "A", note: "" },
    { m: "f8c5", san: "3...Bc5", chunk: "A", note: "" },
    { m: "c2c3", san: "4.c3", chunk: "A", anchor: true, note: "The humble servant again — d4 is loaded." },
    { m: "g8f6", san: "4...Nf6", chunk: "A", note: "" },
    { m: "d2d4", san: "5.d4", chunk: "B", anchor: true, note: "Fire." },
    { m: "e5d4", san: "5...exd4", chunk: "B", note: "" },
    { m: "e4e5", san: "6.e5!?", chunk: "B", anchor: true, note: "The spear.", why: { q: "Pushing past usually RELEASES tension. Why does this push create it?", a: "Because it attacks the f6 knight while the push itself opens the c4 bishop's view of d5 — the knight's escape squares are being switched off as it's being kicked. The punishment for the natural jump (...Ne4) is a whole piece: Bd5 hits a knight with no defenders and no squares. One pawn move, three jobs." } },
    { m: "f6e4", san: "6...Ne4?", chunk: "B", note: "The natural jump — into the pit. (Only 6...d5! holds: see Danger.)" },
    { m: "c4d5", san: "7.Bd5!", chunk: "C", anchor: true, note: "The net: the e4 knight has zero defenders and zero squares." },
    { m: "e4f2", san: "7...Nxf2", chunk: "C", note: "The desperado — selling itself for a pawn and chaos:" },
    { m: "e1f2", san: "8.Kxf2", chunk: "C", note: "" },
    { m: "d4c3+", san: "8...dxc3+", chunk: "C", note: "Discovered check from the c5 bishop — the flurry continues —" },
    { m: "f2f1", san: "9.Kf1", chunk: "C", note: "Sidestep calmly. The 'attack' is out of bullets." },
    { m: "c3b2", san: "9...cxb2", chunk: "C", note: "One last pawn —" },
    { m: "c1b2", san: "10.Bxb2", chunk: "C", note: "The payoff. A piece for two pawns, the d5 monster eyeing f7 and b7, the b2 bishop raking toward g7, and your 'exposed' king perfectly safe — every open line on this board points at HIS king. The desperado bought noise, not compensation." },
  ],
  promise: {
    eyebrow: "The promise · move 7", headline: "A knight with no squares.",
    plyCount: 13, last: ["c4", "d5"], marks: ["e4"],
    body: "Before you learn a single move: Black just played the most natural knight jump on the board — and it loses a piece on the spot. Look at e4: what defends it, and where can it go?",
    revealTitle: "7.Bd5!",
    reveal: "Nothing defends it, and every square is covered or poisoned: the spear on e5 took f6 away, d5 was switched on by the same push, and the desperado ...Nxf2 flurry burns out to a piece for two pawns. The trap was built entirely by one pawn move doing three jobs.",
    chip: "6...Ne4 is the instinctive club reply to the spear.",
  },
  danger: {
    eyebrow: "The danger · the one road", headline: "6...d5! — the spear parried.",
    base: null, baseCount: 11,
    plies: [
      { m: "d7d5", san: "6...d5!", note: "The only move — counter-thrust before retreating." },
      { m: "c4b5", san: "7.Bb5", note: "Keep the pin, keep the tension." },
      { m: "f6e4", san: "7...Ne4", note: "NOW the jump is safe — d5 guards it." },
      { m: "c3d4", san: "8.cxd4", note: "" },
      { m: "c5b4+", san: "8...Bb4+", note: "" },
      { m: "c1d2", san: "9.Bd2", note: "" },
      { m: "e4d2", san: "9...Nxd2", note: "" },
      { m: "b1d2", san: "10.Nbxd2", note: "The book tabiya: balanced, structured, a real game for both sides. The spear only skewers players who don't know this one road — which, at club level, is most of them." },
    ],
    ledgerTitle: "How opponents meet 6.e5",
    ledger: [
      { label: "6...Ne4? — the natural jump", pct: 49, color: C.gold },
      { label: "6...d5! — the one road", pct: 28, color: C.red },
      { label: "Other (...Ng4?!, ...Ne7)", pct: 23, color: C.muted },
    ],
    survivalTitle: "When he knows the road",
    survival: "6...d5 7.Bb5 Ne4 8.cxd4 Bb4+ 9.Bd2 Nxd2 10.Nbxd2 — one sequence, level and playable. Learn it as a unit; it's the toll for owning the spear.",
    bailoutTitle: "The other lane — move 6",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","f1c4","f8c5","c2c3","g8f6","d2d4","e5d4","c3d4"],
    bailoutLast: ["c3", "d4"],
    bailoutNote: "6.cxd4 Bb4+ — the Greco pack's road. Two weapons grow from the same four opening moves; this square is where they split.",
  },
  drills: [
    { id: "cs1", kind: "move", plyCount: 12, from: "c4", to: "d5",
      prompt: "He jumped 6...Ne4. Close the net.",
      hints: ["The knight has no defenders. Prove it has no squares either.", "Your bishop's diagonal was opened by your own spear."],
      reason: "7.Bd5! — attacks a knight that nothing defends and nowhere receives." },
    { id: "cs2", kind: "move", plyCount: 16, from: "f2", to: "f1",
      prompt: "Desperado: ...Nxf2, Kxf2, ...dxc3 with discovered check. Stay calm.",
      hints: ["Don't grab, don't block — the flurry is out of bullets.", "One quiet king step ends the noise."],
      reason: "9.Kf1 — sidestep; after ...cxb2 Bxb2 you're a piece up with every open line pointing at HIS king." },
    { id: "cs3", kind: "goal",
      prompt: "What made 6.e5 a spear rather than a tension release?",
      options: [
        "One push, three jobs: kick the knight, open the d5 square, and poison the natural escape",
        "It wins the d4 pawn back immediately",
        "It prepares castling queenside",
      ], correct: 0,
      reason: "Count a move's jobs. Pushes that multitask create tension; pushes that don't, release it." },
    { id: "cs4", kind: "move", danger: true, plyCount: 11, extra: ["d7d5"],
      from: "c4", to: "b5",
      prompt: "He found 6...d5 — the one road. Respond in book.",
      hints: ["Same reflex as the Scotch Gambit's declined line.", "Save the bishop where it pins."],
      reason: "7.Bb5 — keep the pin; then Ne4, cxd4, Bb4+, Bd2 into the level tabiya." },
  ],
};


const MOLLER = {
  id: "moller", family: "italian", chip: "⚙ Møller", badge: "⚙ MØLLER ATTACK · GIUOCO PIANO · WHITE",
  conflicts: [
    { at: "after 2...Nc6", mine: "3.Bc4", vs: "repertoire", theirs: "3.d4 — the Scotch" },
    { at: "after 5...exd4", mine: "6.cxd4", vs: "spear", theirs: "6.e5!?" },
  ],
  morphs: [{ ply: 14, when: "If he grabs 8...Nxc3 instead", to: "greco" }],
  chunks: { A: "Chunk A · The quiet build", B: "Chunk B · The gambit, declined properly", C: "Chunk C · The delayed repayment" },
  chunkGoals: {
    A: "The same c3 build that feeds the Greco and the Spear. One position, three weapons — this is the third.",
    B: "Gambit e4 and castle for ammunition, as in the Greco — but this time he captures the KNIGHT with the bishop. The rook-feast recipe is dead; a better one begins.",
    C: "Push past, fork the loose knights, convert to g7 — then let the pin repay the piece by force. 'A piece down' becomes even material, a stranded king, and often mate.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "f1c4", san: "3.Bc4", chunk: "A", note: "" },
    { m: "f8c5", san: "3...Bc5", chunk: "A", note: "The Giuoco Piano, once more." },
    { m: "c2c3", san: "4.c3", chunk: "A", anchor: true, note: "The humble servant — d4 loading, as always." },
    { m: "g8f6", san: "4...Nf6", chunk: "A", note: "" },
    { m: "d2d4", san: "5.d4", chunk: "B", note: "Fire." },
    { m: "e5d4", san: "5...exd4", chunk: "B", note: "" },
    { m: "c3d4", san: "6.cxd4", chunk: "B", note: "" },
    { m: "c5b4", san: "6...Bb4+", chunk: "B", note: "" },
    { m: "b1c3", san: "7.Nc3!?", chunk: "B", anchor: true, note: "The same gambit square as the Greco: e4 is offered." },
    { m: "f6e4", san: "7...Nxe4", chunk: "B", note: "Taken." },
    { m: "e1g1,h1f1", san: "8.O-O!", chunk: "B", anchor: true, note: "Castling as ammunition — the f1 rook's e-file career begins." },
    { m: "b4c3", san: "8...Bxc3", chunk: "B", note: "The sound decline. The Greco's rook feast needed ...Nxc3 first; with the bishop capture, Qb3 tricks die. New problem — new weapon." },
    { m: "d4d5", san: "9.d5!", chunk: "C", anchor: true, note: "The Møller Attack.", why: { q: "Your knight just died on c3 and you're pushing a pawn. Why not simply recapture?", a: "Recapturing lets him consolidate a clean pawn up. d5! forces the c6 knight to move FIRST — and wherever it goes, bxc3 comes next anyway, now with his pieces scattered. When two of your moves must both be played, choose the order that forces his reply in between." } },
    { m: "c6e5", san: "9...Ne5?", chunk: "C", note: "The greedy grab — eyeing c4 and f3. (9...Bf6! is the book defense: see Edge cases.)" },
    { m: "b2c3", san: "10.bxc3", chunk: "C", note: "The recapture, on your schedule." },
    { m: "e5c4", san: "10...Nxc4", chunk: "C", note: "He collects the bishop. Two black knights now float, loose, on the fourth rank." },
    { m: "d1d4", san: "11.Qd4!", chunk: "C", anchor: true, note: "One move, two targets.", why: { q: "How does one queen move deal with two knights — including one that can be defended?", a: "It attacks the RELATIONSHIP: both knights are loose, and they can't both leave. His only trick — 11...Ncd6, one knight defending the other — walks straight into Qxg7. A fork profits even when parried: the defender's contortion is the payment, collected elsewhere." } },
    { m: "c4d6", san: "11...Ncd6", chunk: "C", note: "The only try: one loose knight babysits the other." },
    { m: "d4g7", san: "12.Qxg7", chunk: "C", anchor: true, note: "The conversion — and note WHICH pawn just died: f6's future bodyguard. This capture is a promise about move 15." },
    { m: "d8f6", san: "12...Qf6", chunk: "C", note: "Offering the trade to survive the h8 pressure —" },
    { m: "g7f6", san: "13.Qxf6", chunk: "C", note: "Accept. The attack never needed queens." },
    { m: "e4f6", san: "13...Nxf6", chunk: "C", note: "" },
    { m: "f1e1", san: "14.Re1+", chunk: "C", anchor: true, note: "The file, again. This is why you castled on move 8." },
    { m: "e8d8", san: "14...Kd8", chunk: "C", note: "The forced walk." },
    { m: "c1g5", san: "15.Bg5!", chunk: "C", note: "The payoff. The f6 knight is absolutely pinned — and, thanks to move 12, undefendable forever. White regains the piece by force, often with mate or the exchange as a tip, while his king squats on d8. 'A piece down' was a bookkeeping error." },
  ],
  promise: {
    eyebrow: "The promise · move 15", headline: "He declines the greed. You win anyway.",
    plyCount: 29, last: ["c1", "g5"], marks: ["d8", "f6"],
    body: "Black is 'up a piece' — for exactly one more move. Can you see why the f6 knight is already lost?",
    revealTitle: "15.Bg5!",
    reveal: "The absolute pin: the knight cannot move (his king stands behind it) and cannot be defended (g7 died on move 12 precisely for this). The piece comes back by force — often with mate or the exchange as interest. The Møller Attack is what made the whole 7.Nc3 gambit respectable.",
    chip: "After 9.d5, nearly half of club players grab with 9...Ne5?.",
  },
  danger: {
    eyebrow: "The edge case · the book defense", headline: "9...Bf6! — the Møller proper.",
    base: null, baseCount: 17,
    plies: [
      { m: "c3f6", san: "9...Bf6!", note: "The accurate retreat: the bishop comes back to hold the long diagonal and f6." },
      { m: "f1e1", san: "10.Re1", note: "The file first — the e4 knight is the hostage." },
      { m: "c6e7", san: "10...Ne7", note: "Guarding the d5-square blockade plans and preparing ...d6." },
      { m: "e1e4", san: "11.Rxe4", note: "Piece regained. Material level; initiative yours." },
      { m: "d7d6", san: "11...d6", note: "" },
      { m: "c1g5", san: "12.Bg5", note: "Trade his best defender —" },
      { m: "f6g5", san: "12...Bxg5", note: "" },
      { m: "f3g5", san: "13.Nxg5", note: "" },
      { m: "h7h6", san: "13...h6", note: "Kicking, as he must —" },
      { m: "d1e2", san: "14.Qe2!", note: "The Møller labyrinth: after 14...hxg5 15.Re1! the rook returns with threats worth a piece. Deep, sound, century-old theory — and strictly for the prepared. This line is the tax on the whole 7.Nc3 complex." },
    ],
    ledgerTitle: "After 9.d5, how opponents respond",
    ledger: [
      { label: "9...Ne5? — the greedy grab", pct: 47, color: C.gold },
      { label: "9...Bf6! — book", pct: 26, color: C.red },
      { label: "Other (...Na5?!, ...Ne7)", pct: 27, color: C.muted },
    ],
    survivalTitle: "Carrying the book line",
    survival: "vs 9...Bf6: Re1, Ne7, Rxe4, d6, Bg5, Bxg5, Nxg5, h6, Qe2 — learn it as one breath, the way you learned the dream. If the memory budget isn't there yet, the bailout at move 7 exits the entire complex.",
    bailoutTitle: "The bailout fork — move 7",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","f1c4","f8c5","c2c3","g8f6","d2d4","e5d4","c3d4","c5b4","c1d2"],
    bailoutLast: ["c1", "d2"],
    bailoutNote: "7.Bd2 Bxd2+ 8.Nbxd2 — the same sidewalk that serves the Greco pack. One quiet trade and all three storms (Greco, Møller, and their theory) stay in the clouds.",
  },
  drills: [
    { id: "mo1", kind: "move", plyCount: 16, from: "d4", to: "d5",
      prompt: "He captured your knight with the bishop — the Greco recipe is dead. Find the Møller.",
      hints: ["Don't recapture on autopilot: force HIS reply first.", "Ask the c6 knight a question."],
      reason: "9.d5! — the knight must move now, and bxc3 follows anyway, with his pieces scattered." },
    { id: "mo2", kind: "move", plyCount: 20, from: "d1", to: "d4",
      prompt: "Two black knights float on the fourth rank. One move.",
      hints: ["Attack the relationship, not a piece.", "Centralize where both loose knights are visible."],
      reason: "11.Qd4! — the double attack; even the saving trick 11...Ncd6 pays elsewhere: Qxg7." },
    { id: "mo3", kind: "goal",
      prompt: "What is the Møller's core mechanism?",
      options: [
        "A delayed pin: Qxg7 removes the f6 defender in advance, so Re1+ and Bg5 win the piece back by force",
        "A quick Qb3 double attack, like the Greco",
        "Winning the d4 pawn back with tempo",
      ], correct: 0,
      reason: "The capture on move 12 and the pin on move 15 are one idea, three moves apart. See moves as installments of a plan and lines stop being lists." },
    { id: "mo4", kind: "move", danger: true, plyCount: 17, extra: ["c3f6"], from: "f1", to: "e1",
      prompt: "He played the book 9...Bf6. Begin the Møller proper.",
      hints: ["The e4 knight is the hostage.", "The file you castled for."],
      reason: "10.Re1 — then Ne7, Rxe4: piece regained, initiative kept, theory begun." },
  ],
};


const BUSCH = {
  id: "busch", side: "black", family: "black", chip: "🃏 Busch-Gass", badge: "🃏 BUSCH-GASS GAMBIT · BLACK",
  chunks: { A: "Chunk A · The straight-faced offer", B: "Chunk B · The refund mechanism", C: "Chunk C · The star fork" },
  chunkGoals: {
    A: "Offer the e-pawn with a bishop move and a straight face. Move two, and the game is already on your terms.",
    B: "When he grabs, don't recapture — hit the knight and open your lines. Development with threats is how gambits collect.",
    C: "The fork geometry: your bishop buys f2, your queen collects on d4 — king, bishop and e-pawn on one star. Then squat on the e-file forever.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "Attacking e5 — as he's played a thousand times." },
    { m: "f8c5", san: "2...Bc5!?", chunk: "A", anchor: true, note: "The Busch-Gass: develop, ignore the threat, offer the pawn.", why: { q: "The e5 pawn hangs and you're just... developing. What are you actually selling him?", a: "A pawn, for his king's future address. If he grabs, your pieces arrive with threats while his knight wanders; the f2 square and e-file become yours for the game. If he declines, you got a free developing move. Gambits aren't about the pawn — they're about who chooses the battlefield." } },
    { m: "f3e5", san: "3.Nxe5?!", chunk: "B", note: "Taken — the critical test, and the start of his problems." },
    { m: "b8c6", san: "3...Nc6!", chunk: "B", anchor: true, note: "The refund mechanism: hit the knight before recapturing anything. (This position even has its own name — the Chiodini Gambit.)" },
    { m: "e5c6", san: "4.Nxc6", chunk: "B", note: "Best; retreating hands you the tempo for free." },
    { m: "d7c6", san: "4...dxc6!", chunk: "B", anchor: true, note: "Toward the center: the d-file opens for your queen, the c8 bishop breathes, and f2 quietly enters the crosshairs." },
    { m: "f1c4", san: "5.Bc4?", chunk: "C", note: "The natural move — eyeing f7, blind to the geometry he just enabled. (5.d3! is the sober test: see Edge cases.)" },
    { m: "c5f2+", san: "5...Bxf2+!", chunk: "C", anchor: true, note: "Buy the square.", why: { q: "A whole bishop for the f2 pawn — what makes this shot sound rather than a lunge?", a: "Calculate the collection, not the capture: after Kxf2, Qd4+ is a STAR fork — king on f2, bishop on c4, pawn on e4, all lit by one queen move down the freshly opened d-file. That file opened when you recaptured 4...dxc6; the sacrifice only cashes what the position already saved. Sacrifices are withdrawals, never gifts." } },
    { m: "e1f2", san: "6.Kxf2", chunk: "C", note: "Forced acceptance — declining just loses the pawn for nothing." },
    { m: "d8d4+", san: "6...Qd4+!", chunk: "C", anchor: true, note: "The star fork: check on the king, teeth on the c4 bishop AND the e4 pawn. One of them falls." },
    { m: "f2e1", san: "7.Ke1", chunk: "C", note: "The king trudges home — but the door is welded shut behind him." },
    { m: "d4c4", san: "7...Qxc4", chunk: "C", note: "The piece comes back. Count material: dead even — and count everything else." },
    { m: "d2d3", san: "8.d3", chunk: "C", note: "Kicking, and cementing the target on e4." },
    { m: "c4e6", san: "8...Qe6!", chunk: "C", note: "The payoff. Material even, his king can NEVER castle, and the e-file is your property: ...Nf6, ...O-O, ...Re8 come with threats while his rooks watch from the corners. You spent a pawn deciding where the whole game happens." },
  ],
  promise: {
    eyebrow: "The promise · move 8", headline: "His king never castles. You play Black.",
    plyCount: 16, last: ["c4", "e6"], marks: ["e1", "e4"],
    body: "Material is dead even. What did the gambit actually buy?",
    revealTitle: "8...Qe6",
    reveal: "The Bxf2+/Qd4+ star fork regained everything and stranded his king on e1 forever. The e-file is yours, castling is his memory, and your plan writes itself. The Busch-Gass sells a pawn on move two to decide where the entire game will be played.",
    chip: "5.Bc4? and similar f2-blind development appears in roughly two of five club games.",
  },
  danger: {
    eyebrow: "The edge case · he doesn't blunder", headline: "5.d3! — now prove the pawn.",
    base: null, baseCount: 8,
    plies: [
      { m: "d2d3", san: "5.d3!", note: "The sober move: e4 guarded, the Bc4 fork geometry refused." },
      { m: "g8f6", san: "5...Nf6", note: "Develop with pressure — e4 must stay babysat." },
      { m: "f1e2", san: "6.Be2!", note: "Modest and correct: every ...Qd4 and ...Bxf2 trick dies here." },
      { m: "d8e7", san: "6...Qe7", note: "Pile on e4; prepare long-term play." },
      { m: "b1c3", san: "7.Nc3", note: "" },
      { m: "e8g8,h8f8", san: "7...O-O", note: "The honest position: he's a clean pawn up and consolidated. Your compensation — bishops, the half-open e-file, ...Re8 and ...b5 breaks — is real but must be proven over thirty moves. Against a booked opponent, YOU are the one gambling. That's the price tag; know it before you pay it." },
    ],
    ledgerTitle: "After 4...dxc6, how opponents continue",
    ledger: [
      { label: "5.Bc4? and f2-blind development", pct: 41, color: C.gold },
      { label: "5.d3! — solid, keeps the pawn", pct: 22, color: C.red },
      { label: "Other (5.Nc3, 5.Qe2, early declines)", pct: 37, color: C.muted },
    ],
    survivalTitle: "When he keeps the pawn",
    survival: "vs 5.d3: Nf6, then meet Be2 with Qe7, castle, and play the long game — ...Re8, ...b5-b4, the bishop pair. And if he never takes on e5 at all (3.c3, 3.Nc3), you simply got a free developing move: play chess, owe nothing.",
    bailoutTitle: "The bailout fork — move 2",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6"],
    bailoutLast: ["b8", "c6"],
    bailoutNote: "2...Nc6 — the classical road: no pawn owed, no proof required. The gambit is a mood, not a mortgage; this square is where you choose your mood.",
  },
  drills: [
    { id: "bg1", kind: "move", plyCount: 9, from: "c5", to: "f2",
      prompt: "He aimed at f7 with 5.Bc4. Aim closer.",
      hints: ["The d-file is already open — what does that make affordable?", "Buy the square his king must take on."],
      reason: "5...Bxf2+! — the withdrawal: Kxf2 walks into the Qd4+ star fork." },
    { id: "bg2", kind: "move", plyCount: 11, from: "d8", to: "d4",
      prompt: "He took the bishop. Collect.",
      hints: ["One queen move must hit three things.", "King, bishop, pawn — find the star's center."],
      reason: "6...Qd4+! — check, plus teeth on c4 and e4. The piece returns; his castling never does." },
    { id: "bg3", kind: "goal",
      prompt: "What did the gambit actually buy?",
      options: [
        "His king's permanent address — no castling ever — with the e- and f-files as your property",
        "A forced mate on f2",
        "A material advantage out of the opening",
      ], correct: 0,
      reason: "Name the purchase or you'll trade it away: every piece trade that keeps rooks on serves YOUR e-file, not his." },
    { id: "bg4", kind: "move", danger: true, plyCount: 8, extra: ["d2d3"], from: "g8", to: "f6",
      prompt: "He played the sober 5.d3. Begin proving the pawn.",
      hints: ["No tricks available — develop with pressure.", "Which piece keeps e4 a lifelong patient?"],
      reason: "5...Nf6 — then Qe7, castle, ...Re8: the thirty-move proof. Comp is a job, not a coupon." },
  ],
};


const SC4M = ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4"];

const CLASSICAL = {
  id: "classical", family: "scotch", chip: "🎓 Classical", badge: "🎓 SCOTCH · CLASSICAL 4...Bc5 · WHITE",
  morphs: [
    { ply: 7, when: "If he plays 4...Nf6 instead", to: "mieses" },
    { ply: 11, when: "Also reached via 4...Qf6 5.Be3 Bc5 6.c3 — a pure transposition", to: "hoover" },
  ],
  chunks: { A: "Chunk A · The Scotch break", B: "Chunk B · The pressing phase", C: "Chunk C · The wall and the plans" },
  chunkGoals: {
    A: "The break and the knight recapture — the mainline Scotch, board two of your repertoire.",
    B: "He presses d4 with everything active; you answer each try with development that defends. When this chunk ends his activity has run out of targets.",
    C: "Retreat without regret, castle, build the f3 wall. When this chunk ends you hold a plan-rich space edge that plays itself.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "d2d4", san: "3.d4", chunk: "A", note: "The break." },
    { m: "e5d4", san: "3...exd4", chunk: "A", note: "" },
    { m: "f3d4", san: "4.Nxd4", chunk: "A", note: "" },
    { m: "f8c5", san: "4...Bc5", chunk: "B", note: "The Classical — his most active square, hitting your centralized knight." },
    { m: "c1e3", san: "5.Be3", chunk: "B", anchor: true, note: "Development that defends.", why: { q: "Why meet the bishop with a bishop — doesn't 5...Qf6 double-attack d4 anyway?", a: "Count defenders AND in-betweens: after 5...Qf6 6.c3 holds everything, and every capture sequence on d4 ends with your recapture arriving with tempo on c5. Be3 doesn't just guard — it makes his most active try the move you've already answered. Best-play prep is mostly this: pre-answering." } },
    { m: "d8f6", san: "5...Qf6", chunk: "B", note: "The accurate press — the queen joins the d4 siege. All book." },
    { m: "c2c3", san: "6.c3", chunk: "B", note: "The quiet holder: d4 is now permanent." },
    { m: "g8e7", san: "6...Nge7", chunk: "B", note: "Best: rerouting toward g6 without blocking the f-pawn or the queen." },
    { m: "f1c4", san: "7.Bc4", chunk: "B", note: "Active development while his pieces are tangled." },
    { m: "c6e5", san: "7...Ne5", chunk: "B", note: "Hitting the bishop with tempo — his last active idea." },
    { m: "c4e2", san: "8.Be2", chunk: "C", anchor: true, note: "Retreat without regret: the bishop's job now is to hold the wall, not to shine." },
    { m: "f6g6", san: "8...Qg6", chunk: "C", note: "Eyeing e4 and g2 — it looks scary and isn't. (The e4 grab is the edge case.)" },
    { m: "e1g1,h1f1", san: "9.O-O!", chunk: "C", anchor: true, note: "Calm. The g2 'threat' was never real, and e4 is bait on a hook — see Edge cases." },
    { m: "d7d6", san: "9...d6", chunk: "C", note: "Book: he declines the bait and completes his setup." },
    { m: "f2f3", san: "10.f3", chunk: "C", anchor: true, note: "The payoff tabiya.", why: { q: "A backward little pawn move as the payoff — why?", a: "The wall makes e4 permanent, which fires every piece from guard duty at once: the e3 bishop, the d4 knight, the queen all become free agents. Then f4 kicks his only active piece at YOUR convenience. Pawns defend so pieces can attack — the humblest move on the board is the one that mobilizes your whole army." } },
  ],
  promise: {
    eyebrow: "The promise · the tabiya", headline: "No trap. A wall, then a plan.",
    plyCount: 19, last: ["f2", "f3"], marks: ["e4", "e5"],
    body: "Nothing hangs. Where does White's advantage live?",
    revealTitle: "10.f3",
    reveal: "Space and a plan menu: f4 kicks the e5 knight whenever you like, Nd2 reroutes, b4-b5 gains the queenside — while his position has no equivalent levers. This is the Scotch's honest promise against best play: not a combination, but thirty comfortable moves.",
    chip: "4...Bc5 and 4...Nf6 together cover ~80% of club answers to the Scotch.",
  },
  danger: {
    eyebrow: "The edge case · the pawn grab", headline: "9...Qxe4?! — the bait taken.",
    base: null, baseCount: 17,
    plies: [
      { m: "g6e4", san: "9...Qxe4?!", note: "He takes the hook." },
      { m: "b1d2", san: "10.Nd2!", note: "Tempo one: the sleeping knight hits the queen — and nothing of his can touch d2. (Not 10.Bd3? — count d3: his knight AND queen attack it, only your queen defends. Nxd3! would win a piece.)" },
      { m: "e4d5", san: "10...Qd5", note: "Clinging to the center —" },
      { m: "c3c4", san: "11.c4!", note: "Tempo two. Four queen moves have bought him one pawn; every White move since arrived with a threat. Nb5, Re1 and f4-f5 follow — engines already prefer White despite the material. His best play was never taking." },
    ],
    ledgerTitle: "After 9.O-O, how opponents continue",
    ledger: [
      { label: "9...d6 — book, declining", pct: 48, color: C.red },
      { label: "9...Qxe4?! — the grab", pct: 29, color: C.gold },
      { label: "Other (...O-O, ...Ng6)", pct: 23, color: C.muted },
    ],
    survivalTitle: "Against best play here",
    survival: "The book 9...d6 IS his best — and your 10.f3 tabiya is the answer. Memorize to move 10, then play the plan menu: f4, Nd2, b4. When theory ends, the plans don't.",
    bailoutTitle: "The simpler lane — move 5",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4","f8c5","d4b3"],
    bailoutLast: ["d4", "b3"],
    bailoutNote: "5.Nb3 — nudge the bishop and keep it simple: small, solid, one-tenth the theory. The Be3 mainline is the ambitious road.",
  },
  drills: [
    { id: "cl1", kind: "move", plyCount: 8, from: "c1", to: "e3",
      prompt: "4...Bc5 hits your knight. Answer with development.",
      hints: ["Defend AND pre-answer his queen sortie.", "The bishop that makes 5...Qf6 misfire."],
      reason: "5.Be3 — every capture sequence on d4 now ends with your tempo on c5." },
    { id: "cl2", kind: "move", plyCount: 10, from: "c2", to: "c3",
      prompt: "5...Qf6 doubles on d4. Hold the center quietly.",
      hints: ["One pawn move ends the siege.", "Give d4 a permanent neighbor."],
      reason: "6.c3 — d4 is now a fact, and his active pieces begin to look silly." },
    { id: "cl3", kind: "move", plyCount: 18, from: "f2", to: "f3",
      prompt: "He completed his setup with 9...d6. Build the tabiya.",
      hints: ["Fire every piece from guard duty at once.", "The humble wall."],
      reason: "10.f3 — e4 becomes permanent; f4, Nd2 and b4 are now your plan menu." },
    { id: "cl4", kind: "goal",
      prompt: "Where does the advantage live in this line against BEST play?",
      options: [
        "Space plus a plan menu (f4, Nd2, b4-b5) that outlasts memorized theory",
        "A forced win of the e5 knight",
        "A kingside mating attack",
      ], correct: 0,
      reason: "Against best moves there is no trap — the tabiya plus plans IS the payoff. Know what you're playing for and theory running out stops being scary." },
    { id: "cl5", kind: "move", danger: true, plyCount: 17, extra: ["g6e4"], from: "b1", to: "d2",
      prompt: "He grabbed 9...Qxe4. Start the meter — with a piece he can't touch.",
      hints: ["Every move from here must carry a threat.", "The sleeping knight attacks the queen; d3 is a trap (count its attackers)."],
      reason: "10.Nd2! — then Qd5 11.c4: the queen wanders while your army mobilizes with tempo. (10.Bd3? Nxd3! costs a piece — two attackers, one defender.)" },
  ],
};

const STEINITZ = {
  id: "steinitz", family: "scotch", chip: "👑 Steinitz", badge: "👑 SCOTCH · STEINITZ 4...Qh4 · WHITE",
  morphs: [{ ply: 7, when: "If he plays a normal 4th move instead", to: "mieses", note: "back to the mainline crossroads" }],
  chunks: { A: "Chunk A · The Scotch break", B: "Chunk B · The sortie and the bait", C: "Chunk C · The collection" },
  chunkGoals: {
    A: "The break, the recapture — and then her majesty appears on move four.",
    B: "Answer 'threats' with developing moves, then INVITE the pawn grab. The e4 pawn is bait on a file-opening hook.",
    C: "Knight to b5, recapture toward the center, castle. He keeps the pawn; you keep everything else.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "d2d4", san: "3.d4", chunk: "A", note: "" },
    { m: "e5d4", san: "3...exd4", chunk: "A", note: "" },
    { m: "f3d4", san: "4.Nxd4", chunk: "A", note: "" },
    { m: "d8h4", san: "4...Qh4!?", chunk: "B", note: "The Steinitz sortie: 'threatening' e4 and f2. It looks terrifying at a board. Start counting tempi." },
    { m: "b1c3", san: "5.Nc3!", chunk: "B", anchor: true, note: "Calm development.", why: { q: "The queen eyes e4 AND f2 — why does one developing move answer both?", a: "Count what's actually attacked: f2 is defended by your own king, so that 'threat' is theater. Only e4 is real, and Nc3 answers it while developing. Against early queen sorties the winning recipe never changes: meet threats with developing moves, and let her majesty become the target." } },
    { m: "f8b4", san: "5...Bb4", chunk: "B", note: "Pinning the defender — renewing Qxe4 for real this time." },
    { m: "f1e2", san: "6.Be2!", chunk: "B", anchor: true, note: "The invitation.", why: { q: "You could defend e4 a second time. Why invite the capture instead?", a: "Because the capture IS the trap: after Qxe4, Ndb5! hits c7 while your development lead converts into open files against a king that must move. A pawn that costs him three tempi and castling rights is the best sale you'll ever make. Gambits aren't always planned on move one — sometimes you improvise one when the enemy queen strays far from home." } },
    { m: "h4e4", san: "6...Qxe4", chunk: "B", note: "Taken — the consistent follow-up and the objectively critical test. Good for him that it's critical; better for you that it's this." },
    { m: "d4b5", san: "7.Ndb5!", chunk: "C", anchor: true, note: "The turn: Nxc7+ is threatened, forking king and rook, while his queen watches from the wrong wing." },
    { m: "b4c3", san: "7...Bxc3+", chunk: "C", note: "Removing one attacker with check —" },
    { m: "b2c3", san: "8.bxc3", chunk: "C", note: "— and opening your b-file. Recapture toward the center, always." },
    { m: "e8d8", san: "8...Kd8", chunk: "C", note: "The only real parry to Nxc7+: the king takes up bodyguard duty. Forever." },
    { m: "e1g1,h1f1", san: "9.O-O!", chunk: "C", note: "The payoff. He's up a clean pawn — and strategically lost: king on d8 for life, the b- and e-files opening onto him, Ba3 coming to seal the dark squares, and a queen that moved three times to buy one pawn. Engines call the compensation nearly decisive. Humans convert it faster." },
  ],
  promise: {
    eyebrow: "The promise · move 9", headline: "Her majesty pays at every toll.",
    plyCount: 17, last: ["e1", "g1"], marks: ["d8", "b5"],
    body: "Black is up a pawn. Why is he lost?",
    revealTitle: "9.O-O!",
    reveal: "Count what the pawn cost: three queen moves, castling rights, the b-file, and a knight camped on b5 he can't evict. Every White piece develops with a threat from here — Ba3, Rb1, Re1, Qd4. The Steinitz is the friendliest 'best play' branch you'll face: his most critical try IS your best position.",
    chip: "4...Qh4 appears in roughly one in twelve club Scotch games.",
  },
  danger: {
    eyebrow: "The edge case · the cautious sortie", headline: "6...Nf6 — she declines the bait.",
    base: null, baseCount: 11,
    plies: [
      { m: "g8f6", san: "6...Nf6", note: "Declining — developing while keeping the e4 question open." },
      { m: "e1g1,h1f1", san: "7.O-O", note: "Castle first; the bait stays on the hook." },
      { m: "b4c3", san: "7...Bxc3", note: "" },
      { m: "b2c3", san: "8.bxc3", note: "" },
      { m: "h4e4", san: "8...Qxe4", note: "The delayed grab —" },
      { m: "e2d3", san: "9.Bd3!", note: "— meets the same medicine: tempo on the queen, files for the rooks — and now your king is already castled while his never will be comfortable. A pawn for a permanent initiative, on even better terms than the mainline." },
    ],
    ledgerTitle: "After 6.Be2, how opponents continue",
    ledger: [
      { label: "6...Qxe4 — the point, and the pit", pct: 44, color: C.gold },
      { label: "Quieter (...Nf6, ...Bxc3 first)", pct: 30, color: C.red },
      { label: "Other (...Nge7, retreats)", pct: 26, color: C.muted },
    ],
    survivalTitle: "The whole family, one recipe",
    survival: "Every Steinitz branch answers to the same three-step: develop with tempo on the queen, open files toward his king, castle while he can't. Forget the exact move? Play the recipe — it's rarely wrong here.",
    bailoutTitle: "The caveman lane — move 5",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4","d8h4","d4b5"],
    bailoutLast: ["d4", "b5"],
    bailoutNote: "5.Nb5!? — the immediate Nxc7 hunt: Qxe4+ Be2 and chaos. Playable and fun, but sharper bookkeeping; 5.Nc3 is the professional road.",
  },
  drills: [
    { id: "st1", kind: "move", plyCount: 8, from: "b1", to: "c3",
      prompt: "4...Qh4 'attacks' two pawns. Answer both with one move.",
      hints: ["One of her threats is theater — which square defends itself?", "Develop toward the real one."],
      reason: "5.Nc3! — f2 was always defended by your king; e4 is covered with development." },
    { id: "st2", kind: "move", plyCount: 12, from: "d4", to: "b5",
      prompt: "She took the bait on e4. Begin collecting.",
      hints: ["c7 just lost its future to the pin trade.", "Fork threat, from the knight that looked attacked."],
      reason: "7.Ndb5! — Nxc7+ looms; the king must commit and your files open." },
    { id: "st3", kind: "goal",
      prompt: "What is the recipe against ANY early queen sortie?",
      options: [
        "Develop with tempo on the queen, open files toward the king, castle while he can't",
        "Trade queens as fast as possible",
        "Defend every attacked pawn immediately",
      ], correct: 0,
      reason: "This pack is a template: the Steinitz answer transfers to every ...Qh4/...Qf6 raid in the open games." },
    { id: "st4", kind: "move", danger: true, plyCount: 11, extra: ["g8f6"], from: "e1", to: "g1",
      prompt: "She declined with 6...Nf6. Your move.",
      hints: ["The bait keeps: improve what she can't.", "The move he can never comfortably copy."],
      reason: "7.O-O — castle first; whenever the grab comes, Bd3 hits with your king already safe." },
  ],
};

const HOOVER = {
  id: "hoover", family: "scotch", chip: "🧹 Sidelines", badge: "🧹 SCOTCH · 4...Nxd4 & FRIENDS · WHITE",
  morphs: [{ ply: 7, when: "If he plays 4...Qf6 instead", to: "classical", note: "5.Be3 Bc5 6.c3 Nge7 lands exactly in the Classical mainline — same position, different door" }],
  chunks: { A: "Chunk A · The Scotch break", B: "Chunk B · The free centralization", C: "Chunk C · The Hoover formation" },
  chunkGoals: {
    A: "The break and recapture — and then his 'simplifying' trade hands you the game's best square.",
    B: "Recapture with the queen and build around her: no knight remains to say 'move again.' Nc3, then the pin.",
    C: "Castle long — the rook lands ON the target file in one move. Queen and rook stack against d6; e5 and Nd5 follow.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "d2d4", san: "3.d4", chunk: "A", note: "" },
    { m: "e5d4", san: "3...exd4", chunk: "A", note: "" },
    { m: "f3d4", san: "4.Nxd4", chunk: "A", note: "" },
    { m: "c6d4", san: "4...Nxd4?!", chunk: "B", note: "The 'simplify' instinct — trading his best-placed knight to unclutter. Say thank you." },
    { m: "d1d4", san: "5.Qxd4!", chunk: "B", anchor: true, note: "The free centralization.", why: { q: "Early queen development is a sin — why is this centralization free?", a: "The sin was always about TEMPO — knights saying 'move again.' He just traded the only knight that could ever hit d4; a later ...c5 kick costs him squares (d5, b5), not you time. Rules about queens are really rules about tempo: when the tempo can't be collected, the rule is suspended." } },
    { m: "d7d6", san: "5...d6", chunk: "B", note: "Modest and standard: he shores up before developing." },
    { m: "b1c3", san: "6.Nc3", chunk: "B", note: "" },
    { m: "g8f6", san: "6...Nf6", chunk: "B", note: "" },
    { m: "c1g5", san: "7.Bg5!", chunk: "C", anchor: true, note: "The pin — f6 nailed to the queen. Every future e5/Nd5 idea gains a gear." },
    { m: "f8e7", san: "7...Be7", chunk: "C", note: "Breaking the pin the standard way." },
    { m: "e1c1,a1d1", san: "8.O-O-O!", chunk: "C", anchor: true, note: "The payoff — the Hoover formation.", why: { q: "Why castle LONG here?", a: "Because castling is artillery placement: the rook arrives on the d-file — the file with his backward d6 pawn — in a single move. Then the plan menu: the e5 break, Nd5, and the h4-h5 storm if he castles short. Choose your castle by where the rook is needed, not where the king feels cozy." } },
  ],
  promise: {
    eyebrow: "The promise · move 8", headline: "He simplified. You centralized.",
    plyCount: 15, last: ["e1", "c1"], marks: ["d6", "d4"],
    body: "One early trade, and White's whole army points one direction. What did 4...Nxd4 actually cost?",
    revealTitle: "8.O-O-O!",
    reveal: "The trade bought you a permanent queen on d4, the g5 pin, and a rook delivered to the d-file by castling itself. His d6 pawn is the game's patient; e5, Nd5 and the h-pawn storm are the treatments. 'Simplifying' trades that improve the opponent's pieces aren't simple — they're gifts.",
    chip: "4...Nxd4 and other minor 4th moves make up ~20% of club Scotch games.",
  },
  danger: {
    eyebrow: "The edge case · the transposition", headline: "4...Qf6 — a door into the Classical.",
    base: SC4M, baseCount: null,
    morphTo: "classical",
    plies: [
      { m: "d8f6", san: "4...Qf6", note: "The tricky-looking sortie — d4 attacked, with ...Bc5 batteries against f2 in the air." },
      { m: "c1e3", san: "5.Be3!", note: "The move that pre-answers everything. (5.Nb5?? walks into ...Bc5! with mate threats on f2 — the one landmine in the whole Scotch: never unguard the c5–f2 diagonal here.)" },
      { m: "f8c5", san: "5...Bc5", note: "" },
      { m: "c2c3", san: "6.c3", note: "" },
      { m: "g8e7", san: "6...Nge7", note: "Stop and look at the board: this is EXACTLY the Classical pack's mainline, reached through a different door. One tabiya, two move orders — this is how repertoires stop being exponential: branches merge." },
    ],
    ledgerTitle: "Minor 4th moves at club level",
    ledger: [
      { label: "4...Nxd4 — the simplify instinct", pct: 38, color: C.gold },
      { label: "4...Qf6 → transposes to Classical", pct: 27, color: C.red },
      { label: "4...Bb4+?!, 4...g6, rest", pct: 35, color: C.muted },
    ],
    survivalTitle: "The whole minor-move family",
    survival: "One recipe covers everything here: recapture toward the center, Be3 when the c5-diagonal needs guarding, and never move the d4 knight while a ...Bc5/...Qf6 battery exists. Minor moves need patterns, not lines.",
    bailoutTitle: "The zero-drama lane",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f3d4","d8f6","d4c6"],
    bailoutLast: ["d4", "c6"],
    bailoutNote: "vs the annoying 4...Qf6: 5.Nxc6 dxc6 trades the tension away entirely — tiny edge, zero landmines.",
  },
  lines: [
    { t: "5...Nf6 — he develops into the kick.", baseCount: 9, plies: [
      { m: "g8f6", san: "5...Nf6", note: "The natural developing move — into a queen that owns the center." },
      { m: "e4e5", san: "6.e5!", note: "The kick with no answer: 6...Nd5 and 6...Ne4 both hang to the centralized queen, so the knight he just developed must undevelop. +1.7 by move six, and it is pure geometry — the queen on d4 was never loose, it was a landlord." },
    ] },
    { t: "5...b6 — the slow fianchetto.", baseCount: 9, plies: [
      { m: "b7b6", san: "5...b6", note: "A plan for move twelve, played on move five." },
      { m: "b1c3", san: "6.Nc3", note: "" },
      { m: "c8b7", san: "6...Bb7", note: "" },
      { m: "d4e5", san: "7.Qe5+!", note: "The centralized queen cashes the tempo: check and g7 attacked in one move. Blocking with the queen trades into an endgame two developing moves down; anything else drops g7 and the rook behind it. Slow plans lose to centralized pieces — this is why 5.Qxd4 was never 'exposing the queen'." },
    ] },
  ],
  drills: [
    { id: "hv1", kind: "move", plyCount: 8, from: "d1", to: "d4",
      prompt: "He traded on d4. Recapture — and know why it's free.",
      hints: ["Which piece could ever have kicked her from d4? Where is it now?", "Toward the center."],
      reason: "5.Qxd4! — no knight remains to collect tempo; the 'rule' is suspended." },
    { id: "hv2", kind: "move", plyCount: 12, from: "c1", to: "g5",
      prompt: "His knight reached f6. Add the gear.",
      hints: ["Nail it to something it can't leave.", "Every future e5/Nd5 gains from this."],
      reason: "7.Bg5! — the pin that makes the whole formation click." },
    { id: "hv3", kind: "move", plyCount: 14, from: "e1", to: "c1",
      prompt: "Complete the formation.",
      hints: ["Castling as artillery placement.", "Which file has the patient?"],
      reason: "8.O-O-O! — rook to d1 in one move; queen and rook stack on d6." },
    { id: "hv4", kind: "goal",
      prompt: "Why was his 'simplifying' trade a gift?",
      options: [
        "It centralized your queen tempo-free and removed his only piece that could ever contest d4",
        "It won you a pawn",
        "It opened the h-file for your rook",
      ], correct: 0,
      reason: "Judge trades by what they do to the OTHER side's pieces. A trade that upgrades your queen to the board's best square was never equal." },
    { id: "hv5", kind: "move", danger: true, plyCount: 7, extra: ["d8f6"], from: "c1", to: "e3",
      prompt: "4...Qf6 — the sortie with a landmine behind it. The one safe developing move.",
      hints: ["Guard the diagonal his battery wants.", "The same bishop as the Classical."],
      reason: "5.Be3! — and note where you land three moves later: the Classical tabiya. Branches merge; memory compounds." },
  ],
};

const DECLINES = {
  id: "declines", family: "scotch", chip: "🚪 Declines", badge: "🚪 SCOTCH · MOVE-3 DECLINES · WHITE",
  morphs: [{ ply: 5, when: "If he takes 3...exd4 (the main road)", to: "mieses" }],
  chunks: { A: "Chunk A · The refused break", B: "Chunk B · The queen trade punish", C: "Chunk C · The grip without queens" },
  chunkGoals: {
    A: "He meets 3.d4 with the passive ...d6 instead of taking. The refusal has a price, collected immediately.",
    B: "Take twice and invite the queens off: his king recaptures on d8 and lives there. 'Drawish' is a rumor.",
    C: "Without queens his king can't hide and his pawns can't unfork themselves: trade the bishops, double his e-pawns, then castle long — check included.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "" },
    { m: "g1f3", san: "2.Nf3", chunk: "A", note: "" },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "" },
    { m: "d2d4", san: "3.d4", chunk: "A", note: "" },
    { m: "d7d6", san: "3...d6?!", chunk: "A", note: "The decline — Philidor-flavored, solid-looking, and immediately worse. (3...exd4 is the main road: see the Mieses.)" },
    { m: "d4e5", san: "4.dxe5", chunk: "B", note: "Collect the concession at once." },
    { m: "d6e5", san: "4...dxe5", chunk: "B", note: "The natural pawn recapture. (4...Nxe5 is the accurate one — see Edge cases.)" },
    { m: "d1d8", san: "5.Qxd8+!", chunk: "B", anchor: true, note: "The queens come off — as a weapon.", why: { q: "Trading queens on move five — isn't this drawish?", a: "Drawish for whom? He lost castling forever; you lost a piece that was blocking your rook's file. Positions called 'drawish' where one king is stuck in the crossfire are winning positions in slow motion. Evaluate every trade by what each side's REMAINING pieces want — yours want open files; his want their king anywhere else." } },
    { m: "e8d8", san: "5...Kxd8", chunk: "B", note: "The king takes up residence. Permanent address." },
    { m: "f1c4", san: "6.Bc4", chunk: "C", anchor: true, note: "The laser, queenless edition.", why: { q: "Why does this bishop matter MORE without queens?", a: "Because f7's only defender was always the king — and now the king has bodyguard duty on d8 with no queen to call for help. Piece values shift when defenders vanish: the fewer defenders a square has, the more every attacker of it is worth. f7 just became the most valuable square on the board." } },
    { m: "c8e6", san: "6...Be6", chunk: "C", note: "The standard parry: block the diagonal, offer the trade." },
    { m: "c4e6", san: "7.Bxe6", chunk: "C", note: "Accept — his recapture doubles his e-pawns permanently and gains him nothing." },
    { m: "f7e6", san: "7...fxe6", chunk: "C", note: "" },
    { m: "b1c3", san: "8.Nc3", chunk: "C", note: "The payoff position: his e-pawns are doubled for life, his king is stuck on d8 — and your next move, O-O-O+, develops a rook WITH CHECK. (Not 8.Nxe5?? — the c6 knight guards that pawn. Count defenders before collecting.)" },
  ],
  promise: {
    eyebrow: "The promise · move 8", headline: "No queens. One king playing.",
    plyCount: 15, last: ["b1", "c3"], marks: ["d8", "e6"],
    body: "Queens off on move five — and White is clearly better. Where did the game tilt?",
    revealTitle: "8.Nc3",
    reveal: "Look at his e-pawns: doubled, blockadable, permanent. Look at his king: on d8, in the path of O-O-O+ — a rook developed with check. The decline looked solid and conceded structure, castling rights, and the d-file. Endgames punish passive openings faster than middlegames do.",
    chip: "Among club players who decline the Scotch, the pawn recapture 4...dxe5 is the majority choice.",
  },
  danger: {
    eyebrow: "The edge case · the accurate recapture", headline: "4...Nxe5 — one trade deeper, same skeleton.",
    base: null, baseCount: 7,
    plies: [
      { m: "c6e5", san: "4...Nxe5", note: "The accurate recapture: keep the d-file contested one move longer." },
      { m: "f3e5", san: "5.Nxe5", note: "" },
      { m: "d6e5", san: "5...dxe5", note: "" },
      { m: "d1d8", san: "6.Qxd8+", note: "Same weapon —" },
      { m: "e8d8", san: "6...Kxd8", note: "— same address." },
      { m: "f1c4", san: "7.Bc4", note: "The identical skeleton, one trade deeper: king on d8, f7 tender, your development free. No pawn win this time — a permanent squeeze instead: Nc3, Be3, O-O-O, f4. Every trade he makes walks toward a worse endgame. This is the honest best-play version, and it's simply pleasant for White." },
    ],
    ledgerTitle: "How the decline is recaptured",
    ledger: [
      { label: "4...dxe5 — natural, loses a pawn", pct: 52, color: C.gold },
      { label: "4...Nxe5 — accurate", pct: 23, color: C.red },
      { label: "Other declines (3...Bg4?!, 3...Nge7)", pct: 25, color: C.muted },
    ],
    survivalTitle: "Against the accurate line",
    survival: "vs 4...Nxe5: trade to the same skeleton and squeeze — Nc3, Be3, O-O-O, f4-f5. Nothing to memorize past move 7; the position plays on rails. Other third-move oddities meet the same dxe5 medicine.",
    bailoutTitle: "The keep-the-tension lane",
    bailoutMoves: ["e2e4","e7e5","g1f3","b8c6","d2d4","d7d6","b1c3"],
    bailoutLast: ["b1", "c3"],
    bailoutNote: "4.Nc3 — decline the endgame and keep a normal center game. The queen trade is a choice, not a duty; this square is where you choose.",
  },
  lines: [
    { t: "3...d5 — the central counter-thrust.", baseCount: 5, plies: [
      { m: "d7d5", san: "3...d5?!", note: "He answers your break with his own — a tempo too late." },
      { m: "f3e5", san: "4.Nxe5!", note: "Take with the KNIGHT: it wins the exchange war on e5 because his d5 pawn stopped guarding c6-squares fights. Now every recapture walks downhill for him." },
      { m: "c6e5", san: "4...Nxe5", note: "" },
      { m: "d4e5", san: "5.dxe5", note: "" },
      { m: "d5e4", san: "5...dxe4", note: "The pawn grab that invites the familiar medicine —" },
      { m: "d1d8", san: "6.Qxd8+", note: "— the queen trade, as a weapon. Same law as the 3...d6 decline: his king recaptures and loses castling forever." },
      { m: "e8d8", san: "6...Kxd8", note: "" },
      { m: "f1c4", san: "7.Bc4", note: "The identical skeleton one more time: king on d8, f7 tender, e-pawns split, your development free — and Stockfish already calls it +1.2. Three different declines, one punish. That is what a repertoire is." },
    ] },
    { t: "3...Nf6 — he counterattacks e4.", baseCount: 5, plies: [
      { m: "g8f6", san: "3...Nf6", note: "Petroff instincts a move too late: the center is already open." },
      { m: "d4e5", san: "4.dxe5!", note: "Take forward — his knight must jump into the fire to justify itself." },
      { m: "f6e4", san: "4...Nxe4", note: "" },
      { m: "d1d5", san: "5.Qd5!", note: "The double attack: e4 hangs, f7 trembles. One centralizing move asks two questions; no single reply answers both." },
      { m: "e4c5", san: "5...Nc5", note: "The only try — saving the knight while blocking nothing." },
      { m: "c1g5", san: "6.Bg5!", note: "Development WITH threat: f6 is coming, ...f6 weakens everything, and you still take back on e5 whenever you please. A pawn up in effect, two tempi up in fact." },
    ] },
  ],
  drills: [
    { id: "dc1", kind: "move", plyCount: 8, from: "d1", to: "d8",
      prompt: "He recaptured with the pawn. Use the file.",
      hints: ["What did his recapture just clear?", "The trade that costs HIM the rest of the game."],
      reason: "5.Qxd8+! — his king recaptures into a lifetime on d8." },
    { id: "dc2", kind: "move", plyCount: 14, from: "b1", to: "c3",
      prompt: "Bishops traded on e6. Build the vice — and don't grab.",
      hints: ["The e5 pawn has a defender — count before you collect.", "Develop toward the check that's coming."],
      reason: "8.Nc3 — O-O-O+ next develops a rook with check. (8.Nxe5?? Nxe5 loses a piece: c6 guards e5.)" },
    { id: "dc3", kind: "goal",
      prompt: "Why does the queen trade WIN here rather than draw?",
      options: [
        "His king is stranded in the crossfire and f7 lost its defenders — one-king endgames are wins in slow motion",
        "White gets a passed pawn",
        "It prevents ...Qh4 tricks",
      ], correct: 0,
      reason: "Evaluate trades by what the remaining pieces want. This idea transfers to every early-queen-trade line in your repertoire." },
    { id: "dc4", kind: "move", danger: true, plyCount: 7, extra: ["c6e5"], from: "f3", to: "e5",
      prompt: "He recaptured accurately with the knight. Continue.",
      hints: ["Same plan, one trade deeper.", "Head for the identical skeleton."],
      reason: "5.Nxe5 — then dxe5, Qxd8+, Bc4: the same squeeze, minus the free pawn." },
  ],
};

const SCANDI = {
  id: "scandi", family: "shield", chip: "🗡 Scandinavian", badge: "🗡 SCANDINAVIAN · TAX THE EARLY QUEEN · WHITE",
  chunks: { A: "Chunk A · The queen comes out", B: "Chunk B · Development for free", C: "Chunk C · The quiet clamp" },
  chunkGoals: {
    A: "He offers the d-pawn trade and recaptures with the QUEEN — the club main road. Every move you make from here attacks her.",
    B: "Knight, pawn, knight, bishop: four developing moves, and two of them came with tempo on the wandering queen. He develops nothing meanwhile.",
    C: "One quiet bishop move loads the battery: Nd5 and b4 tricks hang in the air forever. You are simply better, everywhere, calmly.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "" },
    { m: "d7d5", san: "1...d5", chunk: "A", note: "The Scandinavian — 9% of your games. He challenges e4 before developing anything." },
    { m: "e4d5", san: "2.exd5", chunk: "A", note: "Take. Everything else concedes the center argument." },
    { m: "d8d5", san: "2...Qxd5", chunk: "A", note: "The club main road: the queen does the recapturing — and becomes a target for the rest of the opening." },
    { m: "b1c3", san: "3.Nc3!", chunk: "B", anchor: true, note: "A developing move that attacks the queen.", why: { q: "Why is this knight worth more here than in any other opening?", a: "Because it develops WITH tempo: the queen must move again, so your knight is effectively free. Every tempo the early queen donates becomes a developing move you didn't pay for — count development, not material, and you're already winning the opening." } },
    { m: "d5a5", san: "3...Qa5", chunk: "B", note: "The main square: pinning ambitions against your c3 knight." },
    { m: "d2d4", san: "4.d4", chunk: "B", note: "The full center, for free." },
    { m: "g8f6", san: "4...Nf6", chunk: "B", note: "" },
    { m: "g1f3", san: "5.Nf3", chunk: "B", note: "" },
    { m: "c7c6", san: "5...c6", chunk: "C", note: "His system move: an escape hatch for the queen, a wall for the b5 tricks." },
    { m: "f1c4", san: "6.Bc4", chunk: "C", note: "The laser again — f7, the eternal customer." },
    { m: "c8f5", san: "6...Bf5", chunk: "C", note: "His best piece develops — the only one that will." },
    { m: "c1d2", san: "7.Bd2", chunk: "C", anchor: true, note: "The quiet clamp.", why: { q: "The bishop blocks nothing and attacks nothing. What did this move just load?", a: "The battery: your c3 knight now has Nd5! ideas — hitting the a5 queen through the d2 bishop's protection — and b4 gains more queen-tempo whenever you want it. Quiet moves that create two threats for later beat loud moves that make one now. SF: +0.6 and every piece of yours is better placed than every piece of his." } },
  ],
  promise: {
    eyebrow: "The promise · move 7", headline: "Her third move. Your seventh piece.",
    plyCount: 13, last: ["c1", "d2"], marks: ["a5", "d5"],
    body: "Before you learn a single move: material is level, nothing is attacked — and White is simply better everywhere. Count the developed pieces and the queen moves. Where did his opening go?",
    revealTitle: "7.Bd2",
    reveal: "He spent moves 2, 3 and later 5 (…Qa5, and she'll move again) on ONE piece; you spent every move on a different one. The battery on the c3–a5 diagonal means Nd5 and b4 come with tempo forever. The Scandinavian is playable — the club version with the wandering queen just pays a permanent development tax.",
    chip: "At club level the overwhelming majority of Scandinavian players recapture with the queen on move two.",
  },
  danger: {
    eyebrow: "The edge case · the modest retreat", headline: "3...Qd8 — she goes home.",
    base: ["e2e4","d7d5","e4d5","d8d5","b1c3"], baseCount: null,
    plies: [
      { m: "d5d8", san: "3...Qd8", note: "The humble admission: two moves spent, nothing gained." },
      { m: "d2d4", san: "4.d4", note: "" },
      { m: "g8f6", san: "4...Nf6", note: "" },
      { m: "g1f3", san: "5.Nf3", note: "The full center, free development, and his position has no counterplay squares at all. Play Bc4, O-O, Re1, and push when ready — the honest best-play version is simply a better game with zero risk." },
    ],
    ledgerTitle: "How the queen answers 3.Nc3",
    ledger: [
      { label: "3...Qa5 — the main road", pct: 55, color: C.gold },
      { label: "3...Qd8 — the retreat", pct: 25, color: C.red },
      { label: "Other (…Qd6, …Qe5+?!)", pct: 20, color: C.muted },
    ],
    survivalTitle: "Against the sidelines",
    survival: "3...Qd6 meets the same recipe: d4, Nf3, Bc4 — develop with tempo where she stands tall. 3...Qe5+?! 4.Be2 and she's moved three times to reach a worse square. The recipe never changes: hit the queen with developing moves only.",
    bailoutTitle: "The keep-it-simple lane",
    bailoutMoves: ["e2e4","d7d5","e4d5"],
    bailoutLast: ["e4", "d5"],
    bailoutNote: "There is no bailout needed — 2.exd5 is the road AND the safety. If he recaptures with the knight (2...Nf6), just develop: 3.d4 Nxd5 4.Nf3 and you have the center for free.",
  },
  drills: [
    { id: "sc1", kind: "move", plyCount: 4, from: "b1", to: "c3",
      prompt: "His queen took on d5. Develop like it's a check.",
      hints: ["Which developing move attacks her?", "The knight's natural square IS the tempo."],
      reason: "3.Nc3! — development with tempo: she moves again, you develop for free." },
    { id: "sc2", kind: "move", plyCount: 12, from: "c1", to: "d2",
      prompt: "He developed the f5 bishop. Load the quiet battery.",
      hints: ["Think about what your c3 knight WANTS to do to the a5 queen.", "Protect the knight's dream square-jump first."],
      reason: "7.Bd2 — now Nd5! and b4 gain tempo forever; the queen's whole life is running." },
    { id: "sc3", kind: "goal",
      prompt: "What is the Scandinavian queen recapture actually costing him?",
      options: [
        "Tempi — every attack on the queen is a free developing move, and development is the opening's only currency",
        "Material — the queen will be trapped",
        "Nothing — it's fully sound at every level",
      ], correct: 0,
      reason: "Count tempi, not threats. This transfers to every early-queen opening you'll ever face." },
  ],
};

/* ============ BLACK REPERTOIRE ============ */
const KPAWN = {
  id: "kpawn", family: "black", side: "black", chip: "⚔ vs e4", badge: "⚔ AS BLACK · VS 1.E4",
  chunks: { A: "Chunk A · The early queen", B: "Chunk B · The refutation", C: "Chunk C · The punished bishop" },
  chunkGoals: {
    A: "He brings the queen out on move two, aiming at f7 like everyone at this level. You meet it with developing moves that hit her.",
    B: "One knight jump refutes the whole circus: it hits queen and c2 at once, and his 'attack' becomes your material.",
    C: "The desperado bishop check is the last trick — your king steps up ONE square and his queen and bishop fall to a pawn fork.",
  },
  dream: [
    { m: "e2e4", san: "1.e4", chunk: "A", note: "Two thirds of your Black games start here." },
    { m: "e7e5", san: "1...e5", chunk: "A", note: "Your move — claim the center back, symmetric and honest." },
    { m: "d1h5", san: "2.Qh5?!", chunk: "A", note: "The scholar's-mate try. You've faced this circus 17 times and scored 35% — after tonight it scores 0% against you." },
    { m: "b8c6", san: "2...Nc6", chunk: "A", note: "Defend e5 by developing. Never ...g6 first — mate on f7 must stay answered." },
    { m: "f1c4", san: "3.Bc4", chunk: "A", note: "Loading Qxf7#. Now — and only now —" },
    { m: "g7g6", san: "3...g6!", chunk: "A", note: "— hit the queen. f7 is covered by your king; the mate was always one defender short." },
    { m: "h5f3", san: "4.Qf3", chunk: "B", note: "Re-aiming at f7 the slow way." },
    { m: "g8f6", san: "4...Nf6!", chunk: "B", note: "Block the new mate threat by developing. Three of your pieces are out; one of his is — and it's the queen." },
    { m: "f3b3", san: "5.Qb3?!", chunk: "B", note: "Third queen move: now she eyes b7 and f7. It looks scary. It loses." },
    { m: "c6d4", san: "5...Nd4!", chunk: "B", anchor: true, note: "The refutation.", why: { q: "The knight abandons e5 and attacks a defended queen. Why is this winning?", a: "Count her safe squares: the knight hits the queen AND c2 (fork on the rook). If 6.Qc3 or 6.Qd3, then ...d5! and your lead is crushing; his only 'trick' is Bxf7+ — and you WANT him to play it. Refutations invite the desperado; they don't fear it. SF: −3.4 already." } },
    { m: "c4f7", san: "6.Bxf7+?", chunk: "C", note: "The desperado — cashing the bishop with check before the ship sinks." },
    { m: "e8e7", san: "6...Ke7!", chunk: "C", note: "One square up — NOT ...Kxf7?? when Qb3 recaptures the piece with check. The king is perfectly safe on e7; his two pieces are not." },
    { m: "b3c4", san: "7.Qc4", chunk: "C", note: "Defending the bishop, dreaming of survival —" },
    { m: "b7b5!", san: "7...b5!", chunk: "C", anchor: true, note: "The pawn fork ends it: queen and bishop share one diagonal and one fate. Whatever he saves, you take the other — a whole piece up, his queen having moved five times. SF: −4.3. The circus refuted, forever." },
  ],
  promise: {
    eyebrow: "The promise · move 7", headline: "The scholar's mate, refuted for life.",
    plyCount: 14, last: ["b7", "b5"], marks: ["c4", "f7"],
    body: "Before you learn a single move: he played the attack every 1100 plays — early queen, bishop to c4, mate threats on f7. Black is now winning a full piece. Can you see the two hanging pieces?",
    revealTitle: "7...b5!",
    reveal: "Queen on c4 and bishop on f7 share the a2–g8 diagonal — and one pawn move attacks both through it. The whole refutation was three ideas: defend f7 while developing, hit the queen with developing moves only, and welcome the desperado check with ...Ke7. You will never lose to the scholar's circus again.",
    chip: "You faced the early-queen circus 85 times and scored 49%. This line is worth more rating than any other 14 plies in this app.",
  },
  danger: {
    eyebrow: "The main road · the Italian", headline: "2.Nf3 and 3.Bc4 — the grown-up version.",
    base: ["e2e4","e7e5"], baseCount: null,
    plies: [
      { m: "g1f3", san: "2.Nf3", note: "The normal world: 58% of your games." },
      { m: "b8c6", san: "2...Nc6", note: "" },
      { m: "f1c4", san: "3.Bc4", note: "The Italian — his most common choice against you (106 games)." },
      { m: "f8c5", san: "3...Bc5!", note: "The classical answer: your bishop takes the same diagonal, and f2 is as tender as f7." },
      { m: "c2c3", san: "4.c3", note: "Preparing d4 — the main club plan." },
      { m: "g8f6", san: "4...Nf6!", note: "Counterattack e4 before the center rolls." },
      { m: "d2d4", san: "5.d4", note: "" },
      { m: "e5d4", san: "5...exd4", note: "" },
      { m: "c3d4", san: "6.cxd4", note: "" },
      { m: "c5b4+", san: "6...Bb4+!", note: "The check that buys time: he must deal with this before pushing you off the board." },
      { m: "c1d2", san: "7.Bd2", note: "The sane block. (7.Nc3?! is the Møller gambit — your own White repertoire plays it! As Black, take the pawn only if you know 9.d5 Bf6!; otherwise this line never arises.)" },
      { m: "b4d2+", san: "7...Bxd2+", note: "" },
      { m: "b1d2", san: "8.Nbxd2", note: "" },
      { m: "d7d5!", san: "8...d5!", note: "THE freeing break — memorize this one move above all: it splits his center before it becomes a monster." },
      { m: "e4d5", san: "9.exd5", note: "" },
      { m: "f6d5", san: "9...Nxd5", note: "Full equality, better structure, and every piece of yours has a job: ...O-O, ...Be6 or ...Nb6, rooks to e8/d8. From equal, at your level, the better-developed player wins — and that's you now." },
    ],
    ledgerTitle: "What White plays against your 1...e5",
    ledger: [
      { label: "2.Nf3 — the normal world", pct: 58, color: C.gold },
      { label: "2.Qh5 / 2.Bc4 / 2.Qf3 — the circus", pct: 18, color: C.red },
      { label: "Other (2.Nc3, 2.d4, 2.f4)", pct: 24, color: C.muted },
    ],
    survivalTitle: "Against the rest",
    survival: "2.Nc3: play 2...Nf6 and develop symmetrically. 2.d4 exd4 3.Qxd4?! Nc6! — the queen-tempo law again, now working for you. 2.f4?! exf4 and hold the pawn calmly with ...Nf6, ...d6.",
    bailoutTitle: "The one rule",
    bailoutMoves: ["e2e4","e7e5"],
    bailoutLast: ["e7", "e5"],
    bailoutNote: "Whatever White plays: develop toward f2, meet every early queen move with a developing attack on her, and never grab material while behind in development. Your +1 as Black is his impatience.",
  },
  lines: [
    { t: "3.Bb5 — the Spanish.", base: ["e2e4","e7e5"], plies: [
      { m: "g1f3", san: "2.Nf3", note: "" },
      { m: "b8c6", san: "2...Nc6", note: "" },
      { m: "f1b5", san: "3.Bb5", note: "The Spanish — 41 of your games, 41% score. It needs no refuting, only a system." },
      { m: "a7a6", san: "3...a6!", note: "The little question: take or retreat?" },
      { m: "b5a4", san: "4.Ba4", note: "" },
      { m: "g8f6", san: "4...Nf6", note: "Develop and hit e4 — his bishop drifted offside to keep itself alive." },
      { m: "e1g1,h1f1", san: "5.O-O", note: "" },
      { m: "f8e7", san: "5...Be7", note: "The closed Spanish setup: next ...b5, ...d6, ...O-O — same three moves every game. He got a name-brand opening; you got a plan that never changes. Equal, solid, and you know what to do while he wonders." },
    ] },
  ],
  drills: [],
};

const QPAWN = {
  id: "qpawn", family: "black", side: "black", chip: "🧱 vs d4", badge: "🧱 AS BLACK · VS 1.D4",
  chunks: { A: "Chunk A · The London wall", B: "Chunk B · The b2 tax", C: "Chunk C · The endgame you chose" },
  chunkGoals: {
    A: "He plays the London — your worst enemy: 44 games, 32%. Its whole system has exactly one unpaid bill: the b2 pawn behind the wandering dark bishop.",
    B: "Queen to b6, hitting what the bishop left home. Every London player faces this; almost none under 1400 knows the answer.",
    C: "Chase the queen trade on YOUR terms: the a-file opens for your rook and his 'system' is out of moves that help.",
  },
  dream: [
    { m: "d2d4", san: "1.d4", chunk: "A", note: "A fifth of your Black games." },
    { m: "d7d5", san: "1...d5", chunk: "A", note: "Your move — the classical claim." },
    { m: "c1f4", san: "2.Bf4", chunk: "A", note: "The London: his most common AND your worst-scoring line as Black. That ends tonight." },
    { m: "c7c5!", san: "2...c5!", chunk: "A", anchor: true, note: "Strike the base immediately.", why: { q: "Why hit d4 before developing a single piece?", a: "Because the London's bishop left b2 unguarded to sit on f4 — and ...c5 opens the exact diagonal (b6–b2) your queen will use to tax it. Systems have fixed weaknesses; this is the London's, and it must be attacked BEFORE he finishes the wall with c3 and Nd2-f3." } },
    { m: "e2e3", san: "3.e3", chunk: "B", note: "The system continues on autopilot —" },
    { m: "b8c6", san: "3...Nc6", chunk: "B", note: "— develop with pressure on d4." },
    { m: "c2c3", san: "4.c3", chunk: "B", note: "Guarding d4, entombing his own queenside knight." },
    { m: "d8b6!", san: "4...Qb6!", chunk: "B", anchor: true, note: "The tax collector arrives: b2 is attacked, and the f4 bishop cannot come home to pay." },
    { m: "d1b3", san: "5.Qb3", chunk: "C", note: "The standard defense: offering the trade to cover b2." },
    { m: "c5c4!", san: "5...c4!", chunk: "C", anchor: true, note: "The move that wins the queen trade argument: his queen must take on b6 (retreating drops b2 after all), and YOUR recapture improves YOUR position." },
    { m: "b3b6", san: "6.Qxb6", chunk: "C", note: "" },
    { m: "a7b6", san: "6...axb6", chunk: "C", note: "Look at what the 'ruined' pawns bought: the a-file belongs to your rook already, ...b5-b4 is a plan that plays itself, and SF calls this −0.36 — BLACK is better on move six against the system that scored 68% against you. The doubled pawns aren't damage; they're a lever." },
  ],
  promise: {
    eyebrow: "The promise · move 6", headline: "The London, taxed and closed.",
    plyCount: 12, last: ["a7", "b6"], marks: ["a8", "b2"],
    body: "Before you learn a single move: queens are off, it's move six, and Black — you — is already better against the London System. Where did his 68% score against you go?",
    revealTitle: "6...axb6",
    reveal: "It went into the b2 pawn his bishop abandoned. ...c5, ...Qb6 and ...c4 forced a queen trade that opened YOUR a-file and fixed YOUR plan (...b5-b4) while his 'system' has no move that helps. You'll play this exact sequence dozens of times — it works every time, because the London never changes.",
    chip: "The London is your single worst-scoring opening as Black: 44 games, 32%. This line flips it.",
  },
  danger: {
    eyebrow: "The main road · the Queen's Gambit", headline: "2.c4 — the real opening.",
    base: ["d2d4","d7d5"], baseCount: null,
    plies: [
      { m: "c2c4", san: "2.c4", note: "The Queen's Gambit — 43 of your games. Respectable, and calmly declined." },
      { m: "e7e6", san: "2...e6!", note: "The QGD: solid for 150 years of world championships. You will not out-theory anyone; you will out-structure them." },
      { m: "b1c3", san: "3.Nc3", note: "" },
      { m: "g8f6", san: "3...Nf6", note: "" },
      { m: "c1g5", san: "4.Bg5", note: "The classical pin." },
      { m: "f8e7", san: "4...Be7", note: "Break the pin before it exists." },
      { m: "e2e3", san: "5.e3", note: "" },
      { m: "e8g8,h8f8", san: "5...O-O", note: "King safe by move five — half of chess at this level." },
      { m: "g1f3", san: "6.Nf3", note: "" },
      { m: "b8d7", san: "6...Nbd7!", note: "The QGD tabiya. Your plans, in order: ...c6 (the wall), then EITHER ...dxc4 and ...b5 (grab and expand) OR ...Ne4 (trade into freedom). Same setup every game, against 1400s and 2400s alike. Solid is a weapon when the other side needs to prove something." },
    ],
    ledgerTitle: "What White plays after 1.d4 d5",
    ledger: [
      { label: "2.Bf4 — the London (your worst line)", pct: 28, color: C.red },
      { label: "2.c4 — the Queen's Gambit", pct: 27, color: C.gold },
      { label: "Other (2.e3, 2.Nf3, 2.Nc3)", pct: 45, color: C.muted },
    ],
    survivalTitle: "Against the rest",
    survival: "2.e3 or 2.Nf3 systems: the London recipe works anyway — ...c5, ...Nc6, ...Qb6 whenever the dark bishop leaves home or the b2 pawn is loose; otherwise develop as in the QGD. 2.Nc3: 2...Nf6 3.Bf4 c5! same tax.",
    bailoutTitle: "The one rule",
    bailoutMoves: ["d2d4","d7d5"],
    bailoutLast: ["d7", "d5"],
    bailoutNote: "Against d4-systems the plan beats the moves: strike with ...c5, ask the b2 question when the bishop wanders, castle by move six. You know the plan now; he only knows the moves.",
  },
  drills: [],
};

const FAMILIES = [
  { id: "scotch", rep: true, label: "♟ Scotch", blurb: "Your main White repertoire: one door — 3.d4 — every good Black answer met to a tabiya. Follow the ⇄ morphs; branches merge." },
  { id: "shield", rep: true, label: "🛡 Other defenses", blurb: "Deterministic answers to his other openings — Petroff, Sicilian, Caro-Kann. Zero overlap with the Scotch: one position, one move, always." },
  { id: "black", rep: true, label: "⬛ As Black", blurb: "Your Black repertoire — vs 1.e4 and 1.d4. Learn and drill these in the Learn tab and the gauntlet; the story rooms are White-side only for now." },
  { id: "italian", rep: false, label: "🏛 Italian", blurb: "⚔ Off-repertoire: these answer 2...Nc6 with 3.Bc4 where your repertoire plays 3.d4. Study pieces and surprise weapons — don't drill them the same week as the repertoire." },
  { id: "knights", rep: false, label: "🐴 Four Knights", blurb: "⚔ Off-repertoire: 3.Nc3 collides with your 3.d4 — and these two even collide with each other at move 4. Museum pieces with teeth." },
];

const PACKS = [MIESES, CLASSICAL, STEINITZ, HOOVER, DECLINES, SCOTCH, GRECO, MOLLER, SPEAR, LANGE, FRIED, LEGAL, MIRROR, HALLO, ALIEN, MORRA, PETROFF, PHILIDOR, SCANDI, KPAWN, QPAWN, BUSCH];



/* per-pack learning extras: chunk thinking-hints, ending rationale, verified future lines */
const EXTRAS = {
  alien: {
    hints: {
      A: "Ordinary developing moves — but place them knowing f7 is the future crime scene and e4 must stay fluid.",
      B: "You WANT ...h6. Ask which square that pawn abandons forever, and which of your knights plans to retire there.",
      C: "Fund the piece deficit with checks — every check is a free move. Sacrifice, check, reroute, and cash in on the hole he dug himself.",
    },
    finalWhy: "Count attackers, not pieces: every White piece points at a king that has lost f7 forever and can never castle. You're a pawn up with the far safer king — and both futures below end with more material or more attack.",
    futures: [
      { t: "He recaptures", moves: [
          { m: "e8e7", san: "11...Kxe7" },
          { m: "d1e2", san: "12.Qe2" } ],
        note: "A clean pawn up, his king stripped of shelter that can never be rebuilt — Bg5+, O-O-O and the central files all come with tempo against a king in the open." },
      { t: "He saves the rook", moves: [
          { m: "g8h8", san: "11...Rh8" },
          { m: "e7c8", san: "12.Nxc8" },
          { m: "d8c8", san: "12...Qxc8" } ],
        note: "The knight ate a second bishop on its way out. Two bishops for two knights, a pawn up, his king stuck in the center — the practical attack continues at zero risk." },
    ],
  },
  scotch: {
    hints: {
      A: "You're not getting the pawn back — decide that now. Develop toward f7 and count tempi, not pawns.",
      B: "The queen's road to d5 is blocked by exactly ONE thing. What bribe makes it step aside voluntarily?",
      C: "Two forks share one square. Find the check that collects a piece whichever way he answers.",
    },
    finalWhy: "Material is level; nothing else is. His king on f8 has lost castling forever, so the h8 rook is walled in for the entire game. Every line that opens — and the center is about to open — belongs to you, because only your rooks can reach it.",
    futures: [
      { t: "He develops normally", moves: [
          { m: "g8f6", san: "9...Nf6" },
          { m: "e4e5", san: "10.e5!" },
          { m: "d6e5", san: "10...dxe5" },
          { m: "f3e5", san: "11.Nxe5" } ],
        note: "The center rips open in front of a king that can never castle: Nxc6 and Bh6+ hang in the air, and your rooks arrive on files his can only dream about." },
      { t: "He tries to trade queens", moves: [
          { m: "d8f6", san: "9...Qf6" },
          { m: "c3f6", san: "10.Qxf6" },
          { m: "g8f6", san: "10...Nxf6" } ],
        note: "Even simplification doesn't fix f8: the king blocks his own rook all endgame while Bf4 and O-O-O come with tempo. A structural profit survives the queen trade." },
    ],
  },
  legal: {
    hints: {
      A: "Play the quiet Italian — but you're assembling ingredients. Note which squares your pieces EYE, not what they attack.",
      B: "Two preparation moves: one loads the mating square, one converts a gamble into a no-lose bet. Price the trap by its worst branch.",
      C: "The pin is a threat with a price tag he can't pay. Calculate the ignore-it branch to the very end — then jump.",
    },
    finalWhy: "Three pieces, three sealed doors: Bf7 covers e8, the e5 knight covers d7, and the d5 knight delivers a check no one can block — knight checks never can be. His extra queen watches from d8. Mate is geometry; material is only potential geometry.",
    futures: [],
    mateNote: "Checkmate — the only future is the handshake. Trace the net one more time: every escape square is covered by a different minor piece, and the queen he 'won' on move six never got to move.",
  },
  morra: {
    hints: {
      A: "You're buying files, not losing a pawn. Which two files open, and whose rooks live there?",
      B: "Develop with the combination already in mind: one bishop must silently own f7 for the rest of the game.",
      C: "The d-file detonates through his queen and king. Trade INTO the attack — structure survives simplification.",
    },
    finalWhy: "The f7 knight forks the h8 rook and cannot be taken — Bc4 has guarded f7 since move six. Whatever he saves, you emerge up the exchange or with restored material plus the initiative: the gambit pawn, repaid with interest.",
    futures: [
      { t: "He counterattacks", moves: [
          { m: "c6d4", san: "10...Nd4" },
          { m: "f7h8", san: "11.Nxh8" } ],
        note: "The fork cashes: pawn and exchange in the bank. Even cornered, the h8 knight costs him more tempi to trap than it's worth — and your rooks own the open files meanwhile." },
      { t: "He saves the rook", moves: [
          { m: "h8g8", san: "10...Rg8" },
          { m: "f7e5", san: "11.Nxe5!" },
          { m: "c6e5", san: "11...Nxe5" },
          { m: "c1f4", san: "12.Bf4" } ],
        note: "The e5 knight has no anchor: Bf4 harasses it while O-O-O and Rhe1 arrive. His pieces get pushed around; yours get posted. The gambit's promise, delivered as permanent pressure." },
    ],
  },
  fried: {
    hints: {
      A: "Standard Italian — but aim everything at f7 and keep the e-pawn ready to open lines.",
      B: "Force the block, then dangle the pawn. The trap square is the most NATURAL square on the board — trust him to find it.",
      C: "King-hunt arithmetic: check plus second attacker beats material. Herd the king forward, and let him grab the corner.",
    },
    finalWhy: "His king is a permanent combatant on e6 — every developing move you make comes with tempo against it. The 'extra' rook he won sits captured-in-place on a1, and its jailer will be sold at full price. Attacking pieces count double; imprisoned ones count zero.",
    futures: [
      { t: "He challenges the knight", moves: [
          { m: "c7c6", san: "11...c6" },
          { m: "d2d4", san: "12.d4!" } ],
        note: "Pry open the last lines: Bf4 hits e5 next, O-O-O follows, and every capture on d5 loses to Qxd5+ marching the king further up the board. Engines call this decisive." },
      { t: "He runs", moves: [
          { m: "e6d6", san: "11...Kd6" },
          { m: "c1f4", san: "12.Bf4!" },
          { m: "e5f4", san: "12...exf4" },
          { m: "f3f4", san: "13.Qxf4+" } ],
        note: "The hunt follows him: checks with development, development with checks. And glance at a1 — the knight needs four free tempi to escape and will never receive one." },
    ],
  },
  greco: {
    hints: {
      A: "c3 looks passive. Think one tempo ahead: what pawn duo is it preparing?",
      B: "Open the center and offer e4. Count development obsessively — it's the collateral behind every sacrifice coming.",
      C: "Two targets, one queen move. LET him eat the rook; keep asking which of your pieces joins the attack next.",
    },
    finalWhy: "He has rook for bishop and it means nothing: none of his pieces can reach the king's defense in time, while Ne5, Qf3 and Bg6 all arrive with threats. Every road ends on the light squares his bishop abandoned when it went shopping on a1.",
    futures: [
      { t: "He blocks with the knight", moves: [
          { m: "c6e7", san: "12...Ne7" },
          { m: "f3e5", san: "13.Ne5!" } ],
        note: "The net closes: Bg6 next, then Qf3–f7 or Nd7+ depending on his shuffle. The a1 bishop — his whole profit — needs five moves to come home and gets none." },
      { t: "The desperate queen", moves: [
          { m: "d8e8", san: "12...Qe8" },
          { m: "f7e8", san: "13.Bxe8" },
          { m: "f8e8", san: "13...Kxe8" } ],
        note: "Any queen move runs into the f7 bishop's teeth or abandons the back rank. Queen for bishop: the game is over, trophy bishop and all." },
    ],
  },
  mirror: {
    hints: {
      A: "Copying is fine for him — for now. You move first: treat symmetry as a countdown that YOU control.",
      B: "Find the move symmetry cannot answer — a threat that, if copied, simply loses. The pinned knight is the lever.",
      C: "Break the mirror yourself, with check, before he does. The forced recapture wrecks the roof; take what it exposes.",
    },
    finalWhy: "A clean pawn up, but the real profit is structural: his king's pawn roof is gone, the f6 bishop owns the dark squares around it, and the half-open g-file is a highway only your rooks can use. Even his most active defense walks into a mating battery.",
    futures: [
      { t: "The queen steps aside", moves: [
          { m: "d8d7", san: "12...Qd7" },
          { m: "d1d2", san: "13.Qd2!" } ],
        note: "The battery: Qh6 next, and Qg7# is SUPPORTED by the f6 bishop — the pawn he recaptured with dug his own king's moat. Every defense sheds material: ...Ne6 drops e5, ...Nxf3+ opens your g-file." },
      { t: "The counter-flurry", moves: [
          { m: "d4f3", san: "12...Nxf3+" },
          { m: "g2f3", san: "13.gxf3" },
          { m: "g4h3", san: "13...Bh3" },
          { m: "f1e1", san: "14.Re1" } ],
        note: "His 'attack' opened YOUR file: Kh1 and Rg1 come next with mate threats down the g-file he unsealed. Every active try accelerates White." },
    ],
  },
  hallo: {
    hints: {
      A: "Lull. The most symmetric opening in chess is about to have a bomb under it — play it straight.",
      B: "You bought TIME, not material. Every pawn push must ask a knight a question; never pause to consolidate.",
      C: "Convert the space: pawns abreast, bishop onto the f7 diagonal, queen behind it. Speed is the entire thesis.",
    },
    finalWhy: "Objectively Black is 'winning' — practically he must find only-moves for ten straight turns with every piece at home. Your threats play themselves: f7 under double fire, the e5/d4 steamroller, castling either side. At club level this converts at an obscene rate.",
    futures: [
      { t: "He guards f7 laterally", moves: [
          { m: "d8d7", san: "8...Qd7" },
          { m: "e5d6", san: "9.exd6" },
          { m: "f8d6", san: "9...Bxd6" },
          { m: "c3e4", san: "10.Ne4" } ],
        note: "The wedge traded itself for his best defender's best years: Nxd6+ wrecks his structure whenever you like, while O-O and Re1 keep arriving. He never finishes developing." },
      { t: "He returns the piece", moves: [
          { m: "g6e5", san: "8...Ngxe5" },
          { m: "d4e5", san: "9.dxe5" } ],
        note: "Material even again — but look at the wreckage: your e5 wedge stands, Bc4+Qf3 stay aimed at f7, and his other knight is back on g8. The refund came at the worst exchange rate. Castle long and attack." },
    ],
  },
  mieses: {
    hints: {
      A: "Open the center and recapture with the knight — you're steering toward a structure war, not a brawl.",
      B: "Trade knights to FIX his pawns, then hit f6 before the dust settles. The bargain is structural; the timing is tactical.",
      C: "Clamp with c4 and meet the ...Ba6 x-ray calmly. You're already playing move 40: majority, space, patience.",
    },
    finalWhy: "Nothing hangs, and White is better for the next forty moves: the e5/c4 clamp cramps every Black piece, and the skeleton is a promise — his doubled c-pawns can never make a passed pawn; your healthy 4-v-3 can. This edge never needs a tactic.",
    futures: [
      { t: "The plan unfolds", moves: [
          { m: "g7g6", san: "9...g6" },
          { m: "c1b2", san: "10.Bb2" },
          { m: "f8g7", san: "10...Bg7" },
          { m: "b1d2", san: "11.Nd2" } ],
        note: "Moves 9 through 40 in one breath: the clamp holds, every trade drifts toward the endgame only White can win, and his 'bishop pair' stares at its own pawns. Nursing an edge looks exactly like this." },
      { t: "He lashes out", moves: [
          { m: "d5b4", san: "9...Nb4?!" },
          { m: "a2a3", san: "10.a3!" } ],
        note: "Ask the jump to prove itself: the ...Nc2+ fork never existed, and a3 sends the knight to its only square — d5. Do NOT cash it with cxd5 (the a6 bishop x-rays e2 the moment c4 steps away); play g3 and Bg2 instead, and the knight becomes a target on a highway you own. (Not 10.Qe4? — the natural centralization loses the game to 10...d5!: the queen retreats, the center rolls, and ...Nc2 tricks follow for real.)" },
    ],
  },
  scandi: {
    hints: {
      A: "Trade in the center, then treat every queen sighting as a gift: your developing moves double as attacks.",
      B: "Knight, pawn, knight — natural squares only. The tempo count is the scoreboard: check it every move.",
      C: "The quiet Bd2 loads Nd5 and b4 forever. You never need to hurry; every trade and every tempo favors you.",
    },
    finalWhy: "Count the ledger: his queen has moved twice (soon three times), your minor pieces all stand developed on natural squares, and the Nd5/b4 battery generates threats for free, forever. No tactic needed — the Scandinavian queen recapture pays a development tax that never gets refunded.",
    futures: [],
  },
  petroff: {
    hints: {
      A: "He copies. Take first, and remember: the refutation is about ORDER, not about the capture itself.",
      B: "Look down the e-file, through both knights, to his king. Create the alignment before any threat exists.",
      C: "Your own knight leaving is the trigger. Step aside with check — and land where it hurts most.",
    },
    finalWhy: "A queen for a knight — strategically the game is over. The futures show why no trick remains: recapturing walks into effortless consolidation, and ignoring the knight lets it eat its way home.",
    futures: [
      { t: "The bill, collected", moves: [
          { m: "e8d8", san: "6...Kxd8" },
          { m: "d2d4", san: "7.d4" } ],
        note: "Queen for knight, and his consolation is denied too: his king has lost castling and squats on the d-file while you develop with threats. Convert at leisure." },
      { t: "If he ignores the knight", moves: [
          { m: "b7b6", san: "6...b6" },
          { m: "e2d1", san: "7.Qd1!" } ],
        note: "The knight needs no rescue — it already banked the queen. Go home, consolidate, and let him spend a tempo on ...Bxd8; you develop into a position the engine calls +5. (Not 7.Nc6? dxc6 — feeding the knight back for free. A piece that has cashed its profit owes you nothing.)" },
    ],
  },
  philidor: {
    hints: {
      A: "One break, played instantly. The wall's defender (d6) answers to your d-pawn — open the center before his pieces wake.",
      B: "A pin is a claim, not a fact. Take on e5 and make him prove it — then recapture with the piece that keeps attacking.",
      C: "Two weak points, two files apart, one move to hit both. Find the geometry before you look for tactics.",
    },
    finalWhy: "b7 is attacked and undefended; f7 is attacked twice and defended once. No single move saves both — the double attack is arithmetic, not magic. This is the Opera Game position of 1858, and club players still walk into it every day.",
    futures: [
      { t: "He saves f7", moves: [
          { m: "d8e7", san: "7...Qe7" },
          { m: "b3b7", san: "8.Qxb7" },
          { m: "e7b4", san: "8...Qb4+" },
          { m: "b7b4", san: "9.Qxb4" },
          { m: "f8b4", san: "9...Bxb4+" },
          { m: "c2c3", san: "10.c3" } ],
        note: "His best defense — and the bill still gets paid: a clean pawn up, the bishop pair, and an endgame where his e5 pawn needs babysitting forever. Morphy preferred 8.Nc3 and a mating attack; the pawn-up endgame is the club-proof cash-out." },
      { t: "He guards b7 with the queen", moves: [
          { m: "d8d7", san: "7...Qd7?" },
          { m: "b3b7", san: "8.Qxb7!" },
          { m: "d7c6", san: "8...Qc6" },
          { m: "c4b5", san: "9.Bb5!" } ],
        note: "The defense defends nothing: Qxb7 takes anyway, and when his queen offers the trade to save the a8 rook, Bb5! pins her to the king. Whatever he plays, queen or rook comes off the board. Geometry compounds: the same diagonal that hit f7 now delivers the pin." },
    ],
  },
  lange: {
    hints: {
      A: "The Scotch break inside the Italian: open the center while his king is still home.",
      B: "Castle for the ROOK, not the king. The e-file is the product; his greedy knight is the customer.",
      C: "Remove the prop, fork the queen, and let the pin do the collecting. Keep asking: what is pinned to what?",
    },
    finalWhy: "Material is dead even and White is close to winning: a rook already on the open e-file, three pieces developed against zero, his king stuck in the crossfire, and d4 falling next. Positional payoffs are counted in files and tempi, not pawns.",
    futures: [
      { t: "The d4 pawn falls", moves: [
          { m: "c8e6", san: "9...Be6" },
          { m: "f3d4", san: "10.Nxd4" },
          { m: "c6d4", san: "10...Nxd4" },
          { m: "d1d4", san: "11.Qxd4" } ],
        note: "Simplifying INTO a pawn-up position: his king is still central, your rook still owns the file, and the endgame is already better. Even material became +1 the moment his pieces had to trade." },
      { t: "He tries to castle out", moves: [
          { m: "f8e7", san: "9...Be7" },
          { m: "c1g5", san: "10.Bg5!" } ],
        note: "Every attempt to finish developing feeds your initiative: Bxe7 drags his king up the open file into Re1's stare. He cannot complete his development without completing yours." },
    ],
  },
  spear: {
    hints: {
      A: "The same quiet c3–d4 build as the Greco: one position, two weapons.",
      B: "Push PAST instead of recapturing. One pawn move must do three jobs: kick, open d5, poison the escape square.",
      C: "The desperado is noise. Take everything, sidestep the checks calmly, and count the wreckage at the end.",
    },
    finalWhy: "A full piece for two pawns, and his pawns bought nothing: both bishops rake toward his king, your 'exposed' king is untouchable, and the flurry of checks is spent. Every open line on the board points the wrong way for him.",
    futures: [
      { t: "He challenges the spear", moves: [
          { m: "d7d6", san: "10...d6" },
          { m: "e5d6", san: "11.exd6" },
          { m: "d8d6", san: "11...Qxd6" },
          { m: "d1e2", san: "12.Qe2+!" } ],
        note: "Removing the spear opens the e-file onto his own king: the check forces a block that entombs his pieces, Re1 arrives next, and both bishops keep raking. A piece up, with the initiative as garnish." },
      { t: "The queen raid", moves: [
          { m: "d8h4", san: "10...Qh4" },
          { m: "g2g3", san: "11.g3" },
          { m: "h4h3", san: "11...Qh3+" },
          { m: "f1g1", san: "12.Kg1" } ],
        note: "Three checks deep and out of bullets: the king tucks behind the pawns his raid couldn't touch, the queen stands alone in your camp, and Nd2–f1 rounds her up. His attack was a mood; yours is a fact." },
    ],
  },
  moller: {
    hints: {
      A: "The same quiet c3 build — one position, three weapons (Greco, Spear, Møller). Play it straight.",
      B: "Gambit e4 and castle for ammunition. When he takes the KNIGHT with the bishop, note which piece Qb3 tricks needed — it's gone. Adapt, don't recapture.",
      C: "Every move either forces his reply or collects. The g7 capture isn't greed — it's disarming f6's future bodyguard, three moves early.",
    },
    finalWhy: "Count carefully: he's 'up a piece' — for exactly one more move. The f6 knight is absolutely pinned and undefendable, because Qxg7 removed its only guard in advance. Material comes out dead even by force, and nothing else is: his king on d8, your rook owning the file, the c3–d5 duo cramping his sleep. Often it's simply mate.",
    futures: [
      { t: "If he doesn't run", moves: [
          { m: "h8g8", san: "15...Rg8" },
          { m: "g5f6", san: "16.Bxf6#" } ],
        note: "Mate — while still 'up a piece.' The pinned knight was load-bearing, and the pawns he kept (c7, d7) became his king's prison bars. Every escape square is covered by exactly one White piece." },
      { t: "He runs — the pin pays interest", moves: [
          { m: "c7c6", san: "15...c6" },
          { m: "g5f6", san: "16.Bxf6+" },
          { m: "d8c7", san: "16...Kc7" },
          { m: "f6h8", san: "17.Bxh8" } ],
        note: "Piece regained PLUS the exchange — the h8 rook stood on the same diagonal all along. From 'a piece down' to the exchange up in three forced moves: the whole Møller in one line." },
    ],
  },
  busch: {
    hints: {
      A: "Offer the pawn with a straight face — the bishop move IS the gambit. You're selling a pawn for his king's address.",
      B: "When he grabs, hit the knight before recapturing anything. Development with threats is the refund mechanism — and recapture TOWARD the center.",
      C: "The star fork: bishop buys f2, queen collects on d4 — king, bishop, e-pawn on one star. Then park on the e-file and never leave.",
    },
    finalWhy: "Dead even material — count it — and permanently unequal everything else: his king can never castle, the f-file is half-open and the e-file fully yours, and your plan writes itself: ...Nf6, ...O-O, ...Re8. He spent the opening proving he could take a pawn; you spent it deciding where the game happens.",
    futures: [
      { t: "The e-file bind", moves: [
          { m: "b1c3", san: "9.Nc3" },
          { m: "g8f6", san: "9...Nf6" },
          { m: "d1e2", san: "10.Qe2" },
          { m: "e8g8,h8f8", san: "10...O-O" } ],
        note: "Castled versus never-castling: ...Re8 comes next, every rook trade favors you, and the e4 pawn is a lifelong patient. Equal material has rarely been this unequal — this is the position you bought on move two." },
      { t: "The queen sortie", moves: [
          { m: "d1h5", san: "9.Qh5?!" },
          { m: "g7g6", san: "9...g6" },
          { m: "h5f3", san: "10.Qf3" },
          { m: "g8f6", san: "10...Nf6" } ],
        note: "Sorties change nothing: ...g6 gains a tempo, ...Nf6 piles onto e4, and ...O-O follows. His only developed piece is the queen — and she's the one being chased around your growing army." },
    ],
  },
  classical: {
    hints: {
      A: "The Scotch break, recaptured with the knight — you hold d4; he must decide how to press it.",
      B: "Meet activity with development that defends: Be3 and c3 make his most active tries pre-answered. Count defenders AND in-betweens.",
      C: "Retreat the bishop without regret, castle, then build the wall: f3 frees every piece from guard duty. Space is the payoff; f4 is the plan.",
    },
    finalWhy: "No tactics, all bind: the f3 wall makes e4 permanent and frees every piece for the f4 push; his e5 knight gets kicked at your convenience, and b4-b5 gains the queenside while he shuffles. This tabiya is the Scotch's honest promise against best play — a plan-rich space edge that plays itself for thirty moves.",
    futures: [
      { t: "The book grind", moves: [ { m: "e8g8,h8f8", san: "10...O-O" }, { m: "b1d2", san: "11.Nd2" } ],
        note: "The tabiya proper: your space, his cramp. The plan menu in order — f4 kicks the e5 knight at your convenience, Nd2 reroutes toward c4 and f1, and b4-b5 clamps the queenside. He defends for forty moves; you choose which plan he defends worst." },
      { t: "He stops your b4", moves: [ { m: "a7a6", san: "10...a6" }, { m: "a2a4", san: "11.a4" } ],
        note: "He guards b5; you take it anyway — a4-a5 and the bind tightens. Space advantages convert themselves: every waiting move he makes, you gain a square." },
    ],
  },
  steinitz: {
    hints: {
      A: "The queen comes out on move four. Don't panic — start counting tempi.",
      B: "Answer 'threats' with developing moves: one of her targets was never real. Then INVITE the capture — the pawn is bait on a file-opening hook.",
      C: "Collect the interest: knight to b5 with fork threats, recapture toward the center, castle. Her majesty pays a toll at every booth.",
    },
    finalWhy: "He's up a pawn and strategically lost: king on d8 for life, the b- and e-files opening onto him, Ba3 sealing the dark squares, and a queen that has moved three times still looking for a home. Engines call White's compensation close to decisive; over the board it converts even faster.",
    futures: [
      { t: "He hits the b5 knight", moves: [ { m: "a7a6", san: "9...a6" }, { m: "e2d3", san: "10.Bd3!" } ],
        note: "The knight stays poison one move longer: his queen is attacked first — 10...axb5?? 11.Bxe4 collects her. She retreats, Rb1 and Be3 keep arriving with threats, and his extra pawn still hasn't voted." },
      { t: "He develops instead", moves: [ { m: "g8f6", san: "9...Nf6" }, { m: "e2f3", san: "10.Bf3" } ],
        note: "The queen is harassed once more — while Ba3, Rb1 and Re1 all arrive with threats behind her. You are playing chess three tempi in the future." },
    ],
  },
  hoover: {
    hints: {
      A: "He trades his best knight to 'simplify' — the recapture centralizes your queen for free.",
      B: "No knight can ever say 'move again' to your queen. Build around her: Nc3, then the g5 pin.",
      C: "Castle long: the rook lands ON the target file in one move. Then e5, Nd5, and the kingside pawns march.",
    },
    finalWhy: "The Hoover formation: queen and rook stacked on the d-file against a backward d6 pawn, the g5 pin humming, and a pawn storm ready if he castles into it. His 'simplifying' trade on move four bought you all of it. Plans in order: the e5 break, Nd5, h4-h5.",
    futures: [
      { t: "He castles short", moves: [ { m: "e8g8,h8f8", san: "8...O-O" }, { m: "f2f4", san: "9.f4" } ],
        note: "The steamroller: f4-e5 breaks open the file where your heavies wait, and the kingside pawns storm his address while your king hides on the far wing. Opposite castling where only one side is attacking." },
      { t: "He kicks the queen", moves: [ { m: "c7c5", san: "8...c5" }, { m: "d4d2", san: "9.Qd2" } ],
        note: "The kick creates a d5 hole and leaves d6 backward on an open file — Nd5 and doubled rooks follow. Every pawn move he makes near your queen leaves behind a square she likes better." },
    ],
  },
  declines: {
    hints: {
      A: "He refuses the trade with ...d6. Take twice and invite his queen off the board.",
      B: "The queenless middlegame is the punishment: his king walks to d8 and stays. Trade toward it, never away.",
      C: "No queens doesn't mean no attack: trade to double his pawns, then castle long — development with check. And count defenders before collecting 'free' pawns: e5 is guarded.",
    },
    finalWhy: "A queenless position where only one king is playing: his lives on d8, his e-pawns are doubled for the rest of the game, and O-O-O+ arrives next move — a rook developed with check. 'Drawish' positions with one stranded king and a broken structure are winning positions in slow motion.",
    futures: [
      { t: "The rook arrives with check", moves: [ { m: "g8f6", san: "8...Nf6" }, { m: "c1e3", san: "9.Be3" }, { m: "f8b4", san: "9...Bb4" }, { m: "e1c1,a1d1", san: "10.O-O-O+!" } ],
        note: "There it is — a rook developed with check on move ten of a 'drawish' endgame. His king shuffles again, yours is safe behind its wall, and the doubled e-pawns are targets for the next forty moves." },
      { t: "He tries the pin", moves: [ { m: "f8b4", san: "8...Bb4" }, { m: "c1d2", san: "9.Bd2" } ],
        note: "A pin with no queen behind it achieves nothing: ...Bxc3 Bxc3 hands you the bishop pair against doubled pawns — every trade drifts toward a won ending. And O-O-O+ still comes." },
    ],
  },
};
/* ============ THE REPERTOIRE TREE — every Scotch line merged, keyed by position ============ */
const posKey = (b, turn) => b.map((x) => x || ".").join("") + turn;
const buildRep = (packIds, side = "white") => {
  const userPly = side === "black" ? 1 : 0;
  const lines = [];
  for (const p of PACKS.filter((x) => packIds.includes(x.id))) {
    lines.push({ packId: p.id, kind: "dream", plies: p.dream.map((d) => ({ m: d.m, san: d.san })) });
    for (const f of ((EXTRAS[p.id] && EXTRAS[p.id].futures) || [])) {
      lines.push({ packId: p.id, kind: "future", t: f.t, note: f.note,
        plies: [...p.dream.map((d) => ({ m: d.m, san: d.san })), ...f.moves.map((d) => ({ m: d.m, san: d.san }))] });
    }
    const g = p.danger;
    const base = (g.base || p.dream.slice(0, g.baseCount).map((d) => d.m)).map((m, i) => ({ m, san: g.base ? "" : p.dream[i].san }));
    lines.push({ packId: p.id, kind: "edge", plies: [...base, ...g.plies.map((d) => ({ m: d.m, san: d.san }))] });
    // extra scripted edge lines beyond the featured danger (coverage branches)
    for (const x of (p.lines || [])) {
      const xb = (x.base || p.dream.slice(0, x.baseCount).map((d) => d.m)).map((m, i) => ({ m, san: x.base ? "" : p.dream[i].san }));
      lines.push({ packId: p.id, kind: "edge", t: x.t, plies: [...xb, ...x.plies.map((d) => ({ m: d.m, san: d.san }))] });
    }
  }
  const user = {}, opp = {}, term = {}, zones = {};
  const zoneAdd = (key, id) => { zones[key] = zones[key] || []; if (!zones[key].includes(id)) zones[key].push(id); };
  for (const L of lines) {
    let b = START.slice();
    for (let k = 0; k < L.plies.length; k++) {
      const key = posKey(b, k % 2);
      zoneAdd(key, L.packId);
      const { m, san } = L.plies[k];
      if (k % 2 === userPly) {
        const prev = user[key];
        user[key] = { m, san: san || (prev && prev.san) || "", packId: L.packId };
      } else {
        opp[key] = opp[key] || [];
        const ex = opp[key].find((x) => x.m === m);
        if (!ex) opp[key].push({ m, san });
        else if (!ex.san && san) ex.san = san;
      }
      for (const g2 of m.split(",")) { const f = sq(g2.slice(0, 2)), t = sq(g2.slice(2, 4)); b[t] = b[f]; b[f] = null; }
      if (k === L.plies.length - 1) { term[posKey(b, (k + 1) % 2)] = { packId: L.packId, kind: L.kind, t: L.t, note: L.note }; zoneAdd(posKey(b, (k + 1) % 2), L.packId); }
    }
  }
  return { user, opp, term, zones, totalUser: Object.keys(user).length, lineCount: lines.length };
};

/* enumerate every distinct run through the tree; weight branches by runs beneath them */
const buildRepx = (rep, userPly = 0) => {
  const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
  const weight = {}; const memo = {};
  const count = (b, k) => {
    const kk = posKey(b, k % 2);
    if (memo[kk] != null) return memo[kk];
    let total = 1;
    if (k % 2 === userPly) {
      const u = rep.user[kk];
      total = u ? count(applyTok(b, u.m), k + 1) : 1;
    } else {
      const entry = rep.opp[kk] || [];
      if (entry.length) {
        weight[kk] = weight[kk] || {};
        total = 0;
        for (const e of entry) { const c = count(applyTok(b, e.m), k + 1); weight[kk][e.m] = c; total += c; }
      }
    }
    memo[kk] = total; return total;
  };
  count(START.slice(), 0);
  const paths = [];
  const dfs = (b, k, sans, ukeys, toks) => {
    const kk = posKey(b, k % 2);
    if (k % 2 === userPly) {
      const u = rep.user[kk];
      if (!u) { const t = rep.term[kk] || {}; paths.push({ sans, userKeys: ukeys, toks, packId: t.packId, kind: t.kind, t: t.t, note: t.note }); return; }
      dfs(applyTok(b, u.m), k + 1, [...sans, u.san], [...ukeys, kk], [...toks, u.m]);
    } else {
      const entry = rep.opp[kk] || [];
      if (!entry.length) { const t = rep.term[kk] || {}; paths.push({ sans, userKeys: ukeys, toks, packId: t.packId, kind: t.kind, t: t.t, note: t.note }); return; }
      for (const e of entry) dfs(applyTok(b, e.m), k + 1, [...sans, e.san], ukeys, [...toks, e.m]);
    }
  };
  dfs(START.slice(), 0, [], [], []);
  return { weight, paths };
};

/* ============ THE RUNS — every path gets a code, a name, a record ============ */
const buildRuns = (packIds, repx) => {
  // (side is uniform within a tree; runs carry it for the UI/gauntlet)
  const fam = PACKS.filter((p) => packIds.includes(p.id)).map((p) => p.id);
  const kindRank = { dream: 0, future: 1, edge: 2 };
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };
  const list = repx.paths.map((pt, i) => ({ ...pt, _i: i }));
  list.sort((a, b) => {
    const fa = fam.indexOf(a.packId), fb = fam.indexOf(b.packId);
    if (fa !== fb) return fa - fb;
    const ka = kindRank[a.kind] != null ? kindRank[a.kind] : 3;
    const kb = kindRank[b.kind] != null ? kindRank[b.kind] : 3;
    if (ka !== kb) return ka - kb;
    return a._i - b._i;
  });
  const seen = {};
  return list.map((pt) => {
    const pk = PACKS.find((q) => q.id === pt.packId) || {};
    const code = (pk.chip || pt.packId || "RUN").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
    const kchar = pt.kind === "future" ? "F" : pt.kind === "edge" ? "E" : "";
    const bucket = code + kchar;
    seen[bucket] = (seen[bucket] || 0) + 1;
    const id = code + "·" + kchar + seen[bucket];
    const label = pt.kind === "dream"
      ? "the dream line"
      : pt.t || (pt.kind === "edge" ? ((pk.danger || {}).headline || "edge case") : "deep water");
    const glyph = pt.kind === "edge" ? "⚠" : pt.kind === "future" ? "✦✦" : "✦";
    const sig = hash((pt.packId || "?") + "|" + (pt.kind || "?") + "|" + pt.sans.filter(Boolean).join(" "));
    return { ...pt, id, label, glyph, sig, uCount: pt.userKeys.length, chip: pk.chip || "", side: (pk.side || "white") };
  }).map((r, _, all) => {
    // transpositions can land two paths on the same leaf label — tag each twin with its divergence move
    const twins = all.filter((o) => o.label === r.label && o.packId === r.packId && o.kind === r.kind);
    if (twins.length < 2) return r;
    const other = twins.find((o) => o.sig !== r.sig);
    let z = 0;
    while (z < r.sans.length && other && r.sans[z] === other.sans[z]) z++;
    const mv = r.sans[z] || "";
    return mv ? { ...r, label: r.label + " · via " + mv } : r;
  });
};

/* the gauntlet tree is built from the core repertoire plus any learned packs */
const buildTree = (packIds, side = "white") => {
  const userPly = side === "black" ? 1 : 0;
  const rep = buildRep(packIds, side);
  const repx = buildRepx(rep, userPly);
  return { REP: rep, REPX: repx, RUNS: buildRuns(packIds, repx), packIds, side, userPly };
};
const CORE_PACK_IDS = PACKS.filter((p) => p.family === "scotch").map((p) => p.id);
const LEARNABLE_PACK_IDS = ["petroff", "philidor", "scandi", "alien"]; // shield packs learnable into the gauntlet
const BLACK_PACK_IDS = ["kpawn", "qpawn"]; // the Black repertoire (side: "black")
const DEFAULT_TREE = buildTree(CORE_PACK_IDS);
const REP = DEFAULT_TREE.REP, REPX = DEFAULT_TREE.REPX, RUNS = DEFAULT_TREE.RUNS;
/* v6.4: ONE fixed tree everywhere (ids/sigs stable); what varies per user is the
   LEARNED set — only learned lines enter the daily gauntlet session. */
const FULL_TREE = buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]);
const FULL_TREE_B = buildTree(BLACK_PACK_IDS, "black");
const ALL_RUNS = [...FULL_TREE.RUNS, ...FULL_TREE_B.RUNS];
const treeOf = (run) => (run && run.side === "black" ? FULL_TREE_B : FULL_TREE);

const dayStr = (d) => {
  const x = d || new Date();
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
};
const daySeedOrder = (dateS, n) => {
  let h = 2166136261;
  for (let i = 0; i < dateS.length; i++) { h = ((h ^ dateS.charCodeAt(i)) * 16777619) >>> 0; }
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { h = ((h * 1103515245) + 12345) >>> 0; const j = h % (i + 1); const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
  return idx;
};
/* RUNS-END */

/* ============ REAL EVALUATION — Stockfish, one-time per position, cached locally ============ */
const toFEN = (pieces, hist, k) => {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "", emp = 0;
    for (let f = 0; f < 8; f++) {
      const pc = pieces[r * 8 + f];
      if (!pc) emp++;
      else { if (emp) { row += emp; emp = 0; } row += pc; }
    }
    if (emp) row += emp;
    rows.push(row);
  }
  const sqs = [];
  for (const m of hist) for (const g of m.split(",")) { sqs.push(g.slice(0, 2), g.slice(2, 4)); }
  const gone = (x) => sqs.includes(x);
  let c = "";
  if (!gone("e1")) { if (!gone("h1")) c += "K"; if (!gone("a1")) c += "Q"; }
  if (!gone("e8")) { if (!gone("h8")) c += "k"; if (!gone("a8")) c += "q"; }
  return rows.join("/") + " " + (k % 2 === 0 ? "w" : "b") + " " + (c || "-") + " " + epField(pieces, hist) + " 0 " + (Math.floor(k / 2) + 1);
};
// en-passant target — only when the capture is actually available (lichess/FEN-db
// convention), so audit FENs stay byte-identical wherever no e.p. capture exists.
const epField = (pieces, hist) => {
  const last = hist[hist.length - 1];
  if (!last) return "-";
  const g = last.split(",")[0], f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4));
  const pc = pieces[t];
  if (!pc || pc.toLowerCase() !== "p") return "-";
  if (Math.abs(t - f) !== 16) return "-";
  const foe = pc === "P" ? "p" : "P";
  const canTake = (t % 8 > 0 && pieces[t - 1] === foe) || (t % 8 < 7 && pieces[t + 1] === foe);
  return canTake ? sqName((f + t) / 2) : "-";
};

/* storage shim: Claude artifact storage inside the app, localStorage outside it */
const STORE = (() => {
  try { if (typeof window !== "undefined" && window.storage) return window.storage; } catch (e) {}
  try {
    const ls = window.localStorage; ls.getItem("__probe");
    return {
      get: async (k) => { const v = ls.getItem(k); return v == null ? null : { value: v }; },
      set: async (k, v) => { ls.setItem(k, String(v)); },
      delete: async (k) => { ls.removeItem(k); },
    };
  } catch (e) {}
  return null;
})();

/* ============ LOCAL ENGINE — a real alpha-beta search, perft-verified, no network ============ */
function engineCore() {
  // piece codes: +white / -black; 0 empty
  var P=1,N=2,B=3,R=4,Q=5,K=6;
  var CODE={p:P,n:N,b:B,r:R,q:Q,k:K};
  var VAL=[0,100,320,330,500,900,20000];
  // simplified-eval PSTs, white POV, index 0 = a1
  var PST=[];
  PST[P]=[0,0,0,0,0,0,0,0,5,10,10,-20,-20,10,10,5,5,-5,-10,0,0,-10,-5,5,0,0,0,20,20,0,0,0,5,5,10,25,25,10,5,5,10,10,20,30,30,20,10,10,50,50,50,50,50,50,50,50,0,0,0,0,0,0,0,0];
  PST[N]=[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,5,5,0,-20,-40,-30,5,10,15,15,10,5,-30,-30,0,15,20,20,15,0,-30,-30,5,15,20,20,15,5,-30,-30,0,10,15,15,10,0,-30,-40,-20,0,0,0,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50];
  PST[B]=[-20,-10,-10,-10,-10,-10,-10,-20,-10,5,0,0,0,0,5,-10,-10,10,10,10,10,10,10,-10,-10,0,10,10,10,10,0,-10,-10,5,5,10,10,5,5,-10,-10,0,5,10,10,5,0,-10,-10,0,0,0,0,0,0,-10,-20,-10,-10,-10,-10,-10,-10,-20];
  PST[R]=[0,0,0,5,5,0,0,0,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,5,10,10,10,10,10,10,5,0,0,0,0,0,0,0,0];
  PST[Q]=[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,5,0,0,0,0,-10,-10,5,5,5,5,5,0,-10,0,0,5,5,5,5,0,-5,-5,0,5,5,5,5,0,-5,-10,0,5,5,5,5,0,-10,-10,0,0,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20];
  PST[K]=[20,30,10,0,0,10,30,20,20,20,0,0,0,0,20,20,-10,-20,-20,-20,-20,-20,-20,-10,-20,-30,-30,-40,-40,-30,-30,-20,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30];
  var KN=[17,15,10,6,-17,-15,-10,-6], KG=[8,-8,1,-1,9,7,-9,-7];
  var DIAG=[9,7,-9,-7], ORTH=[8,-8,1,-1];
  var bd=new Int8Array(64), stm=1, cr=0, ep=-1; // cr bits: 1 K,2 Q,4 k,8 q
  var nodes=0, stopAt=0, stopped=false;
  function parseFen(f){
    bd.fill(0); var parts=f.split(/\s+/), rows=parts[0].split("/");
    for(var r=0;r<8;r++){ var row=rows[7-r], file=0;
      for(var i=0;i<row.length;i++){ var c=row[i];
        if(c>="1"&&c<="8") file+=+c;
        else { var lo=c.toLowerCase(), v=CODE[lo]; bd[r*8+file]=(c===lo?-v:v); file++; } } }
    stm=parts[1]==="w"?1:-1;
    cr=0; var cs=parts[2]||"-";
    if(cs.indexOf("K")>-1)cr|=1; if(cs.indexOf("Q")>-1)cr|=2;
    if(cs.indexOf("k")>-1)cr|=4; if(cs.indexOf("q")>-1)cr|=8;
    ep = parts[3] && parts[3]!=="-" ? (parts[3].charCodeAt(0)-97)+((+parts[3][1]-1)*8) : -1;
  }
  function attacked(sq, by){ // is sq attacked by side 'by'
    var i,t,d;
    // pawns
    if(by===1){ if(sq>=8){ if(sq%8>0&&bd[sq-9]===P)return true; if(sq%8<7&&bd[sq-7]===P)return true; } }
    else { if(sq<56){ if(sq%8>0&&bd[sq+7]===-P)return true; if(sq%8<7&&bd[sq+9]===-P)return true; } }
    for(i=0;i<8;i++){ t=sq+KN[i];
      if(t>=0&&t<64&&Math.abs(t%8-sq%8)<=2&&bd[t]===N*by) return true; }
    for(i=0;i<8;i++){ t=sq+KG[i];
      if(t>=0&&t<64&&Math.abs(t%8-sq%8)<=1&&bd[t]===K*by) return true; }
    for(i=0;i<4;i++){ d=DIAG[i]; t=sq;
      for(;;){ var pf=t%8; t+=d; if(t<0||t>63||Math.abs(t%8-pf)!==1)break;
        var pc=bd[t]; if(pc){ if(pc===B*by||pc===Q*by)return true; break; } } }
    for(i=0;i<4;i++){ d=ORTH[i]; t=sq;
      for(;;){ var pf2=t%8; t+=d; if(t<0||t>63)break;
        if(Math.abs(d)===1&&Math.abs(t%8-pf2)!==1)break;
        var pc2=bd[t]; if(pc2){ if(pc2===R*by||pc2===Q*by)return true; break; } } }
    return false;
  }
  function kingSq(side){ for(var i=0;i<64;i++) if(bd[i]===K*side) return i; return -1; }
  // move encode: from | to<<6 | promo<<12 | flag<<15  (flag: 1 ep, 2 castle, 3 dbl)
  function genMoves(caps){
    var mv=[], i, t, pc, side=stm;
    for(i=0;i<64;i++){ pc=bd[i]; if(!pc||pc*side<0) continue;
      var ap=Math.abs(pc);
      if(ap===P){
        var fwd=side===1?8:-8, startR=side===1?1:6, promoR=side===1?6:1, r=(i>>3);
        t=i+fwd;
        if(t>=0&&t<64&&!bd[t]){
          if(!caps||r===promoR){ if(r===promoR){mv.push(i|t<<6|Q<<12);mv.push(i|t<<6|N<<12);mv.push(i|t<<6|R<<12);mv.push(i|t<<6|B<<12);} else if(!caps) mv.push(i|t<<6); }
          if(r===startR&&!bd[i+2*fwd]&&!caps) mv.push(i|(i+2*fwd)<<6|3<<15);
        }
        var dd=[fwd-1,fwd+1];
        for(var j=0;j<2;j++){ t=i+dd[j];
          if(t<0||t>63||Math.abs(t%8-i%8)!==1) continue;
          if(bd[t]*side<0){ if(r===promoR){mv.push(i|t<<6|Q<<12);mv.push(i|t<<6|N<<12);mv.push(i|t<<6|R<<12);mv.push(i|t<<6|B<<12);} else mv.push(i|t<<6); }
          else if(t===ep&&!bd[t]) mv.push(i|t<<6|1<<15);
        }
      } else if(ap===N||ap===K){
        var offs=ap===N?KN:KG, lim=ap===N?2:1;
        for(var j2=0;j2<8;j2++){ t=i+offs[j2];
          if(t<0||t>63||Math.abs(t%8-i%8)>lim) continue;
          if(bd[t]*side<=0){ if(!caps||bd[t]) mv.push(i|t<<6); } }
        if(ap===K&&!caps){
          if(side===1&&i===4){
            if((cr&1)&&!bd[5]&&!bd[6]&&!attacked(4,-1)&&!attacked(5,-1)&&!attacked(6,-1)) mv.push(4|6<<6|2<<15);
            if((cr&2)&&!bd[3]&&!bd[2]&&!bd[1]&&!attacked(4,-1)&&!attacked(3,-1)&&!attacked(2,-1)) mv.push(4|2<<6|2<<15);
          } else if(side===-1&&i===60){
            if((cr&4)&&!bd[61]&&!bd[62]&&!attacked(60,1)&&!attacked(61,1)&&!attacked(62,1)) mv.push(60|62<<6|2<<15);
            if((cr&8)&&!bd[59]&&!bd[58]&&!bd[57]&&!attacked(60,1)&&!attacked(59,1)&&!attacked(58,1)) mv.push(60|58<<6|2<<15);
          }
        }
      } else {
        var dirs=ap===B?DIAG:ap===R?ORTH:DIAG.concat(ORTH);
        for(var j3=0;j3<dirs.length;j3++){ var d=dirs[j3]; t=i;
          for(;;){ var pf=t%8; t+=d;
            if(t<0||t>63)break;
            var fd=Math.abs(t%8-pf);
            if((Math.abs(d)===1&&fd!==1)||(Math.abs(d)!==1&&Math.abs(d)!==8&&fd!==1)||(Math.abs(d)===8&&fd!==0))break;
            if(bd[t]*side>0)break;
            if(bd[t]){ mv.push(i|t<<6); break; }
            if(!caps) mv.push(i|t<<6);
          } }
      }
    }
    return mv;
  }
  var hist=[];
  function make(m){
    var f=m&63, t=(m>>6)&63, promo=(m>>12)&7, flag=(m>>15)&3;
    var pc=bd[f], cap=bd[t], side=stm;
    hist.push({f:f,t:t,pc:pc,cap:cap,cr:cr,ep:ep,flag:flag});
    bd[t]=promo?promo*side:pc; bd[f]=0;
    if(flag===1){ var capSq=t+(side===1?-8:8); hist[hist.length-1].epCap=bd[capSq]; bd[capSq]=0; }
    if(flag===2){ if(t===6){bd[5]=bd[7];bd[7]=0;} else if(t===2){bd[3]=bd[0];bd[0]=0;}
      else if(t===62){bd[61]=bd[63];bd[63]=0;} else if(t===58){bd[59]=bd[56];bd[56]=0;} }
    ep = flag===3 ? (f+t)/2 : -1;
    if(pc===K*1) cr&=~3; if(pc===K*-1) cr&=~12;
    if(f===0||t===0)cr&=~2; if(f===7||t===7)cr&=~1;
    if(f===56||t===56)cr&=~8; if(f===63||t===63)cr&=~4;
    stm=-stm;
    if(attacked(kingSq(side), -side)){ unmake(); return false; }
    return true;
  }
  function unmake(){
    var h=hist.pop(); stm=-stm;
    bd[h.f]=h.pc; bd[h.t]=h.cap; cr=h.cr; ep=h.ep;
    if(h.flag===1){ var capSq=h.t+(stm===1?-8:8); bd[capSq]=h.epCap; bd[h.t]=0; }
    if(h.flag===2){ if(h.t===6){bd[7]=bd[5];bd[5]=0;} else if(h.t===2){bd[0]=bd[3];bd[3]=0;}
      else if(h.t===62){bd[63]=bd[61];bd[61]=0;} else if(h.t===58){bd[56]=bd[59];bd[59]=0;} }
  }
  function perft(d){
    if(d===0) return 1;
    var mv=genMoves(false), n=0;
    for(var i=0;i<mv.length;i++){ if(make(mv[i])){ n+=perft(d-1); unmake(); } }
    return n;
  }
  function evalPos(){ // white POV
    var s=0, i, pc, ap, bw=0, bb=0;
    for(i=0;i<64;i++){ pc=bd[i]; if(!pc)continue; ap=pc>0?pc:-pc;
      if(pc>0){ s+=VAL[ap]+PST[ap][i]; if(ap===B)bw++; }
      else { s-=VAL[ap]+PST[ap][i^56]; if(ap===B)bb++; } }
    if(bw>=2)s+=30; if(bb>=2)s-=30;
    return s;
  }
  function mvv(m){ var cap=bd[(m>>6)&63]; return (cap? (cap>0?cap:-cap)*100 : 0) - (bd[m&63]>0?bd[m&63]:-bd[m&63]); }
  function qsearch(alpha,beta){
    nodes++;
    if(!(nodes&1023)&&Date.now()>stopAt){stopped=true;return alpha;}
    var stand=evalPos()*stm;
    if(stand>=beta)return beta;
    if(stand>alpha)alpha=stand;
    var mv=genMoves(true);
    mv.sort(function(a,b){return mvv(b)-mvv(a);});
    for(var i=0;i<mv.length;i++){
      if(!make(mv[i]))continue;
      var sc=-qsearch(-beta,-alpha);
      unmake();
      if(stopped)return alpha;
      if(sc>=beta)return beta;
      if(sc>alpha)alpha=sc;
    }
    return alpha;
  }
  function search(depth,alpha,beta,ply){
    if(depth===0)return qsearch(alpha,beta);
    nodes++;
    if(!(nodes&1023)&&Date.now()>stopAt){stopped=true;return alpha;}
    var mv=genMoves(false), any=false;
    mv.sort(function(a,b){return mvv(b)-mvv(a);});
    for(var i=0;i<mv.length;i++){
      if(!make(mv[i]))continue;
      any=true;
      var sc=-search(depth-1,-beta,-alpha,ply+1);
      unmake();
      if(stopped)return alpha;
      if(sc>=beta)return beta;
      if(sc>alpha)alpha=sc;
    }
    if(!any){
      var inCheck=attacked(kingSq(stm),-stm);
      return inCheck? -32000+ply : 0;
    }
    return alpha;
  }
  function go(fen, ms){
    parseFen(fen);
    nodes=0; stopped=false; stopAt=Date.now()+ms;
    var best=0, d, lastD=0;
    for(d=1;d<=9;d++){
      var sc=search(d,-40000,40000,0);
      if(stopped)break;
      best=sc; lastD=d;
      if(best>31000||best<-31000)break;
    }
    var whitePOV=best*stm;
    if(whitePOV>31000) return {mate: Math.ceil((32000-whitePOV)/2), d:lastD};
    if(whitePOV<-31000) return {mate: -Math.ceil((32000+whitePOV)/2), d:lastD};
    return {cp: whitePOV, d: lastD};
  }
  // legal destination squares for the piece standing on `from` (0..63) in `fen`.
  // Drives the board's move hints — same perft-verified generator the search uses.
  function legalTargets(fen, from){
    parseFen(fen);
    var mv=genMoves(false), out=[], i, t;
    for(i=0;i<mv.length;i++){
      if((mv[i]&63)!==from) continue;
      if(make(mv[i])){ unmake(); t=(mv[i]>>6)&63; if(out.indexOf(t)<0) out.push(t); }
    }
    return out;
  }
  // targets of currently-legal capture moves (test/audit hook — not used in play)
  function legalCaptureTargets(){
    var mv=genMoves(true), out=[];
    for(var i=0;i<mv.length;i++){ if(make(mv[i])){ unmake(); out.push((mv[i]>>6)&63); } }
    return out;
  }
  return { parseFen: parseFen, perft: perft, go: go, evalPos: evalPos, legalTargets: legalTargets, legalCaptureTargets: legalCaptureTargets };
}

/* Move hints for the board: legal destinations of the selected piece, straight
   from the perft-verified generator (one engine instance, reused). */
const MOVE_HINTS = (() => {
  let core = null;
  return (fen, name) => {
    if (!fen || !name) return [];
    try {
      if (!core) core = engineCore();
      return core.legalTargets(fen, sq(name)).map(sqName);
    } catch (e) { return []; }
  };
})();

const LOCAL_WORKER_MAIN = 'var FEN="";self.onmessage=function(e){var m=e.data;if(m==="uci"){self.postMessage("uciok");}else if(m.indexOf("position fen ")===0){FEN=m.slice(13);}else if(m.indexOf("go")===0){var ms=1150;var mm=m.match(/movetime (\\d+)/);if(mm)ms=parseInt(mm[1],10);var r=core.go(FEN,ms);var side=FEN.split(/\\s+/)[1];var v;var kind;if(r.mate!=null){kind="mate";v=side==="w"?r.mate:-r.mate;}else{kind="cp";v=side==="w"?r.cp:-r.cp;}self.postMessage("info depth "+r.d+" score "+kind+" "+v);self.postMessage("bestmove 0000");}};';

const EVAL = (() => {
  let engine = null, status = "idle", stage = "idle"; // idle | loading | ready | offline
  let queue = [], busy = false, current = null;
  let cache = {}, cacheLoaded = false, saveT = null;
  const subs = new Set();
  const notify = () => subs.forEach((f) => { try { f(); } catch (e) {} });
  const loadCache = async () => {
    if (cacheLoaded) return; cacheLoaded = true;
    try { const r = STORE && (await STORE.get("lines-eval-cache-v1")); if (r && r.value) { cache = JSON.parse(r.value); notify(); } } catch (e) {}
  };
  const saveCache = () => {
    clearTimeout(saveT);
    saveT = setTimeout(async () => { try { if (STORE) await STORE.set("lines-eval-cache-v1", JSON.stringify(cache)); } catch (e) {} }, 2600);
  };
  const URL_SF = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
  const wrap = (w) => ({
    post: (m) => { try { w.postMessage(m); } catch (e) {} },
    on: (f) => { w.onmessage = (ev) => f(typeof ev.data === "string" ? ev.data : ""); },
    onerror: (f) => { w.onerror = () => f(); },
    kill: () => { try { w.terminate(); } catch (e) {} },
  });
  // each strategy must pass a real UCI handshake before it is believed —
  // a worker built from a bad payload fails *asynchronously*, and trusting it
  // is exactly how a bar gets stuck on "thinking…" forever
  const handshake = (api, ms) => new Promise((res) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; res(v); } };
    const to = setTimeout(() => done(false), ms || 9000);
    if (api.onerror) api.onerror(() => { clearTimeout(to); done(false); });
    api.on((line) => { if (typeof line === "string" && line.indexOf("uciok") !== -1) { clearTimeout(to); done(true); } });
    api.post("uci");
  });
  const strategies = [
    ["worker", () => wrap(new Worker(URL.createObjectURL(new Blob(["importScripts('" + URL_SF + "');"], { type: "application/javascript" }))))],
    ["worker-fetch", async () => {
      const txt = await (await fetch(URL_SF)).text();
      if (!txt || txt.length < 50000) throw new Error("bad body");
      return wrap(new Worker(URL.createObjectURL(new Blob([txt], { type: "application/javascript" }))));
    }],
    ["worker-direct", () => wrap(new Worker(URL_SF))],
    ["main-thread", async () => {
      await new Promise((res, rej) => {
        const sc = document.createElement("script");
        sc.src = URL_SF; sc.onload = res; sc.onerror = rej;
        document.head.appendChild(sc);
      });
      const fac = window.STOCKFISH || window.Stockfish || window.stockfish;
      if (typeof fac !== "function") throw new Error("no engine global");
      const sf = fac();
      return {
        post: (m) => { try { sf.postMessage(m); } catch (e) {} },
        on: (f) => { sf.onmessage = (l) => f(typeof l === "string" ? l : (l && l.data) || ""); },
        onerror: null,
        kill: () => {},
      };
    }],
    ["local-worker", () => wrap(new Worker(URL.createObjectURL(new Blob(
      ["var core=(" + engineCore.toString() + ")();" + LOCAL_WORKER_MAIN],
      { type: "application/javascript" }))))],
    ["local", async () => {
      const core = engineCore();
      let FEN = "", handler = null;
      return {
        post: (m) => {
          if (m === "uci") { setTimeout(() => handler && handler("uciok"), 0); }
          else if (m.indexOf("position fen ") === 0) { FEN = m.slice(13); }
          else if (m.indexOf("go") === 0) {
            setTimeout(() => {
              let ms = 1150; const mm = m.match(/movetime (\d+)/); if (mm) ms = parseInt(mm[1], 10);
              const r = core.go(FEN, ms);
              const side = FEN.split(/\s+/)[1];
              const v = r.mate != null ? (side === "w" ? r.mate : -r.mate) : (side === "w" ? r.cp : -r.cp);
              if (handler) { handler("info depth " + r.d + " score " + (r.mate != null ? "mate " : "cp ") + v); handler("bestmove 0000"); }
            }, 30);
          }
        },
        on: (f) => { handler = f; },
        onerror: null,
        kill: () => {},
      };
    }],
  ];
  const boot = async () => {
    if (status !== "idle") return;
    status = "loading"; notify();
    let hint = null;
    try { const h = STORE && (await STORE.get("lines-eval-strategy")); if (h && h.value) hint = h.value; } catch (e) {}
    const ordered = hint
      ? [...strategies.filter((x) => x[0] === hint), ...strategies.filter((x) => x[0] !== hint)]
      : strategies;
    for (const pair of ordered) {
      stage = "loading · " + pair[0]; notify();
      let api = null;
      try { api = await pair[1](); } catch (e) { continue; }
      const ok = await handshake(api, pair[0].indexOf("local") === 0 ? 2500 : 9000);
      if (ok) {
        engine = api; status = "ready"; stage = pair[0]; notify(); pump();
        try { if (STORE) await STORE.set("lines-eval-strategy", pair[0]); } catch (e) {}
        return;
      }
      if (api && api.kill) api.kill();
    }
    status = "offline"; stage = "blocked by sandbox"; notify();
  };
  const pump = () => {
    if (busy || !engine || status !== "ready" || !queue.length) return;
    busy = true;
    const job = queue.shift(); current = job;
    let last = null;
    const wd = setTimeout(() => {
      status = "offline"; stage = "engine stopped responding";
      busy = false; current = null; notify();
    }, 15000);
    engine.on((line) => {
      if (typeof line !== "string") return;
      if (line.indexOf("info") === 0 && line.indexOf(" score ") > -1) {
        const mm = line.match(/score (cp|mate) (-?\d+)/);
        const dm = line.match(/ depth (\d+)/);
        if (mm) last = { kind: mm[1], v: parseInt(mm[2], 10), d: dm ? parseInt(dm[1], 10) : 0 };
      }
      if (line.indexOf("bestmove") === 0) {
        clearTimeout(wd);
        const sign = job.turn === "w" ? 1 : -1;
        const src = stage.indexOf("local") === 0 ? "loc" : "sf";
        cache[job.key] = last
          ? (last.kind === "cp" ? { cp: sign * last.v, d: last.d, s: src } : { mate: sign * last.v, d: last.d, s: src })
          : { cp: 0, d: 0, s: src };
        saveCache(); busy = false; current = null; notify(); pump();
      }
    });
    engine.post("position fen " + job.fen);
    engine.post("go movetime 1100");
  };
  return {
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    getStatus: () => status,
    getStage: () => stage,
    get: (key) => cache[key],
    request: async (key, fen, turn) => {
      await loadCache();
      if (cache[key]) { notify(); return; }
      if (!queue.some((j) => j.key === key) && !(current && current.key === key)) queue.push({ key, fen, turn });
      if (status === "idle") boot(); else pump();
    },
  };
})();

function EvalBar({ pieces, hist, k }) {
  const [, force] = useState(0);
  useEffect(() => EVAL.subscribe(() => force((x) => x + 1)), []);
  const key = posKey(pieces, k % 2);
  useEffect(() => { EVAL.request(key, toFEN(pieces, hist, k), k % 2 === 0 ? "w" : "b"); }, [key]);
  const st = EVAL.getStatus();
  const ev = EVAL.get(key);
  let pct = 50, label = "…";
  if (ev) {
    if (ev.mate != null) { pct = ev.mate > 0 ? 98 : 2; label = "#" + (ev.mate > 0 ? "+" : "−") + Math.abs(ev.mate); }
    else { const pw = ev.cp / 100; pct = 50 + 50 * Math.tanh(pw / 4); label = (pw >= 0 ? "+" : "") + pw.toFixed(1); }
  } else if (st === "offline") { label = "offline · " + EVAL.getStage(); }
  else if (st === "loading") { label = EVAL.getStage(); }
  else { label = "thinking…"; }
  return (
    <div className="flex items-center gap-2">
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: C.muted, opacity: 0.75 }}>{ev && ev.s === "loc" ? "eng" : "SF"}</span>
      <div className="flex-1 rounded" style={{ height: 9, background: "#221A13", overflow: "hidden", border: `1px solid ${C.line}` }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#EDE6D6", transition: "width .5s" }} />
      </div>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: ev ? C.gold : C.muted, minWidth: 84, textAlign: "right" }}>
        {label}{ev ? ` · d${ev.d}${ev.s === "loc" ? " local" : ""}` : ""}
      </span>
    </div>
  );
}


/* ---------- board ---------- */
function Board({ pieces, last, marks = [], sel, fen, frame, onTap, flip = false, size = "min(88vw, 380px)" }) {
  const lastIdx = last ? last.map(sq) : [];
  // chess.com-style hints: a dot on every legal quiet destination of the
  // selected piece, a ring on every square it can capture on.
  const hints = useMemo(() => (onTap && sel && fen ? MOVE_HINTS(fen, sel) : []), [onTap ? 1 : 0, sel, fen]);
  const glow =
    frame === "gold" ? `0 0 0 3px ${C.gold}, 0 0 28px rgba(217,164,65,0.35)` :
    frame === "goldsoft" ? `0 0 0 2px rgba(217,164,65,0.45)` :
    frame === "red" ? `0 0 0 3px ${C.red}, 0 0 28px rgba(206,74,54,0.35)` :
    `0 0 0 1px ${C.line}`;
  return (
    <div style={{ width: size, boxShadow: glow, borderRadius: 6, overflow: "hidden", margin: "0 auto" }}>
      <div className="grid grid-cols-8" style={{ aspectRatio: "1 / 1", width: "100%", gridTemplateRows: "repeat(8, 1fr)" }}>
        {Array.from({ length: 64 }, (_, i) => {
          const rank = flip ? Math.floor(i / 8) : 7 - Math.floor(i / 8);
          const file = flip ? 7 - (i % 8) : i % 8;
          const idx = rank * 8 + file;
          const name = "abcdefgh"[file] + (rank + 1);
          const dark = (rank + file) % 2 === 0;
          const p = pieces[idx];
          const isLast = lastIdx.includes(idx);
          const isMark = marks.includes(name);
          const isSel = sel === name;
          const isHint = hints.includes(name);
          return (
            <div key={i} onClick={onTap ? () => onTap(name) : undefined}
              className="flex items-center justify-center select-none"
              style={{
                aspectRatio: "1 / 1", position: "relative",
                background: isSel ? (dark ? "#BBCB2B" : "#F5F682") : isMark ? (dark ? "#D36C50" : "#EB7D6A") : isLast ? (dark ? "#B9CA43" : "#F5F682") : dark ? C.boardDark : C.boardLight,
                cursor: onTap ? "pointer" : "default",
              }}>
              {i % 8 === 0 && (
                <span style={{ position: "absolute", top: 1, left: 3, fontSize: 9, lineHeight: 1, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, color: dark ? "#EBECD0" : "#779556", pointerEvents: "none" }}>
                  {rank + 1}
                </span>
              )}
              {Math.floor(i / 8) === 7 && (
                <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: 9, lineHeight: 1, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, color: dark ? "#EBECD0" : "#779556", pointerEvents: "none" }}>
                  {"abcdefgh"[file]}
                </span>
              )}
              {isHint && (
                <span data-hint={p ? "capture" : "move"}
                  style={{
                    position: "absolute", inset: 0, pointerEvents: "none",
                    background: p
                      ? "radial-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0) 79%, rgba(20,85,30,0.32) 80%)"
                      : "radial-gradient(rgba(20,85,30,0.32) 19%, rgba(0,0,0,0) 20%)",
                  }} />
              )}
              {p && (
                <img src={`/pieces/${p.toLowerCase()}${p === p.toUpperCase() ? "l" : "d"}.svg`} alt={p}
                  draggable={false}
                  style={{ width: "94%", height: "94%", pointerEvents: "none", userSelect: "none" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- shared bits ---------- */
const Eyebrow = ({ color = C.muted, children }) => (
  <div style={{ color, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase" }}>{children}</div>
);
const Btn = ({ children, onClick, tone = "gold", full }) => (
  <button onClick={onClick}
    className={"py-3 px-5 rounded-md font-semibold " + (full ? "w-full" : "")}
    style={{
      background: tone === "gold" ? C.gold : tone === "red" ? C.red : C.card,
      color: tone === "ghost" ? C.cream : "#1C150E",
      border: tone === "ghost" ? `1px solid ${C.line}` : "none",
      fontSize: 15,
    }}>{children}</button>
);

/* ---------- screens ---------- */
/* ============ PHASE 1 · THE END (default) ============ */

function FuturesPanel({ pack }) {
  const ex = EXTRAS[pack.id];
  const [fi, setFi] = useState(0);
  const [k, setK] = useState(0);
  const baseMoves = pack.dream.map((p) => p.m);
  const finalLast = fromTo(baseMoves[baseMoves.length - 1]);
  if (!ex.futures.length) {
    return (
      <div className="flex flex-col gap-3">
        <Board flip={pack.side === "black"} pieces={applyMoves(baseMoves)} frame="gold" last={finalLast} marks={pack.promise.marks} />
        <div className="rounded-md p-4" style={{ background: C.goldSoft, border: `1px solid ${C.gold}55` }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontSize: 12, letterSpacing: "0.08em", marginBottom: 6 }}>
            ✦ NO FUTURES NEEDED
          </div>
          <p style={{ fontSize: 14.5, lineHeight: 1.6 }}>{ex.mateNote}</p>
        </div>
      </div>
    );
  }
  const fut = ex.futures[fi];
  const pieces = applyMoves([...baseMoves, ...fut.moves.slice(0, k).map((x) => x.m)]);
  const last = k > 0 ? fromTo(fut.moves[k - 1].m) : finalLast;
  const doneF = k === fut.moves.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {ex.futures.map((f, j) => (
          <button key={j} onClick={() => { setFi(j); setK(0); }}
            className="px-3 py-1.5 rounded-full whitespace-nowrap"
            style={{ fontSize: 12.5, background: j === fi ? C.gold : C.card, color: j === fi ? "#1C150E" : C.muted, border: `1px solid ${j === fi ? C.gold : C.line}` }}>
            ▸ {f.t}
          </button>
        ))}
      </div>
      <Board flip={pack.side === "black"} pieces={pieces} last={last} frame={doneF || k === 0 ? "gold" : null}
        marks={k === 0 ? pack.promise.marks : []} />
      <div className="flex gap-3">
        <Btn tone="ghost" onClick={() => setK(Math.max(0, k - 1))}>← Back</Btn>
        <div className="flex-1">
          {doneF
            ? <Btn full tone="ghost" onClick={() => setK(0)}>↻ Replay this future</Btn>
            : <Btn full onClick={() => setK(k + 1)}>Next move →</Btn>}
        </div>
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: C.cream, minHeight: 18 }}>
        {fut.moves.slice(0, k).map((x) => x.san).join("  ") || "the ending — tap next to watch it evolve"}
      </div>
      {doneF && (
        <div className="rounded-md p-4" style={{ background: C.goldSoft, border: `1px solid ${C.gold}55` }}>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{fut.note}</p>
        </div>
      )}
    </div>
  );
}

function EndScreen({ pack, go, switchPack }) {
  const P = pack.promise;
  const ex = EXTRAS[pack.id];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Eyebrow color={C.gold}>Start at the end · this is where the line goes{pack.side === "black" ? " · you are Black" : ""}</Eyebrow>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 30, lineHeight: 1.15, marginTop: 6 }}>{P.headline}</h1>
      </div>
      <FuturesPanel pack={pack} />
      <div className="rounded-md p-4" style={{ background: C.goldSoft, border: `1px solid ${C.gold}55` }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontSize: 12, letterSpacing: "0.08em", marginBottom: 6 }}>
          WHY THIS POSITION WINS
        </div>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: C.cream }}>{ex.finalWhy}</p>
      </div>
      <div className="rounded-md p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>
          <b style={{ color: C.gold }}>{P.revealTitle}</b> {P.reveal}
        </p>
      </div>
      <div className="rounded-md px-4 py-3" style={{ background: C.card, fontSize: 13, color: C.muted }}>
        {P.chip} <span style={{ opacity: 0.6 }}>(mock number)</span>
      </div>
      {pack.conflicts && pack.conflicts.length > 0 && (
        <div className="rounded-md p-4 flex flex-col gap-2.5" style={{ background: C.card, border: `1px dashed ${C.red}88` }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.red, fontSize: 12, letterSpacing: "0.08em" }}>
            ⚔ OFF-REPERTOIRE · same position, different move
          </div>
          {pack.conflicts.map((cf, i) => (
            <div key={i} style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              <span style={{ color: C.muted }}>{cf.at}: this pack plays </span>
              <b style={{ color: C.cream }}>{cf.mine}</b>
              <span style={{ color: C.muted }}> — {cf.vs === "repertoire" ? "your repertoire plays" : ((PACKS.find((q) => q.id === cf.vs) || {}).chip || cf.vs) + " plays"} </span>
              <b style={{ color: C.red }}>{cf.theirs}</b>
            </div>
          ))}
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, fontStyle: "italic" }}>
            One position, one move. Two answers bound to the same position slow each other down at the board. Keep this as a study piece or a surprise weapon — never drill it in the same week as your repertoire line.
          </p>
        </div>
      )}
      {((pack.morphs && pack.morphs.length > 0) || pack.danger.morphTo) && (
        <div className="rounded-md p-4 flex flex-col gap-2.5" style={{ background: C.card, border: `1px dashed ${C.gold}55` }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontSize: 12, letterSpacing: "0.08em" }}>
            ⇄ CONNECTED LINES
          </div>
          {(pack.morphs || []).map((mo, i) => (
            <button key={i} onClick={() => switchPack(mo.to)} className="text-left" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              <span style={{ color: C.muted }}>{mo.when} → </span>
              <span style={{ color: C.gold, fontWeight: 600 }}>{(PACKS.find((q) => q.id === mo.to) || {}).chip}</span>
            </button>
          ))}
          {pack.danger.morphTo && (
            <button onClick={() => switchPack(pack.danger.morphTo)} className="text-left" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              <span style={{ color: C.muted }}>Its edge case lives in → </span>
              <span style={{ color: C.gold, fontWeight: 600 }}>{(PACKS.find((q) => q.id === pack.danger.morphTo) || {}).chip}</span>
            </button>
          )}
        </div>
      )}
      <Btn full onClick={() => go("learn")}>Learn the line — start to end →</Btn>
    </div>
  );
}

/* ============ PHASE 2 · LEARN (explain, then drill start→end) ============ */

function ExplainWalk({ pack, onDrill, switchPack }) {
  const D = pack.dream;
  const [si, setSi] = useState(0);
  const [whyOpen, setWhyOpen] = useState(false);
  const goTo = (v) => { setSi(v); setWhyOpen(false); };
  const ply = D[si];
  const pieces = applyMoves(D.slice(0, si + 1).map((p) => p.m));
  const atLast = si === D.length - 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Eyebrow>{pack.chunks[ply.chunk]}</Eyebrow>
        {ply.anchor && (
          <span className="px-2 py-1 rounded" style={{ background: C.goldSoft, color: C.gold, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.1em" }}>
            ★ ANCHOR
          </span>
        )}
      </div>
      <EvalBar pieces={pieces} hist={D.slice(0, si + 1).map((x) => x.m)} k={si + 1} />
      <Board flip={pack.side === "black"} pieces={pieces} last={fromTo(ply.m)} frame={atLast ? "gold" : null} />
      <div className="flex gap-3">
        <Btn tone="ghost" onClick={() => goTo(Math.max(0, si - 1))}>← Back</Btn>
        <div className="flex-1">
          {atLast
            ? <Btn full onClick={onDrill}>Now drill it — your moves →</Btn>
            : <Btn full onClick={() => goTo(si + 1)}>Next move →</Btn>}
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto py-1" style={{ scrollbarWidth: "none" }}>
        {D.map((d, jx) => (
          <button key={jx} onClick={() => goTo(jx)}
            className="px-2 py-1 rounded whitespace-nowrap"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
              background: jx === si ? C.cream : "transparent",
              color: jx === si ? "#1C150E" : d.anchor ? C.gold : C.muted,
              border: `1px solid ${jx === si ? C.cream : "transparent"}` }}>{d.san}</button>
        ))}
      </div>
      <div className="rounded-md p-4" style={{ background: ply.anchor ? C.goldSoft : C.card, border: ply.anchor ? `1px solid ${C.gold}55` : `1px solid ${C.line}` }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: ply.anchor ? C.gold : C.cream, fontSize: 15, marginBottom: 4 }}>{ply.san}</div>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: C.cream }}>{ply.note}</p>
      </div>
      {(pack.morphs || []).filter((mo) => mo.ply === si).map((mo, i) => (
        <button key={"mo" + i} onClick={() => switchPack(mo.to)} className="text-left rounded-md p-3 flex flex-col gap-1"
          style={{ background: C.card, border: `1px dashed ${C.gold}88` }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontSize: 12, letterSpacing: "0.08em" }}>
            ⇄ MORPH · tap to jump
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: C.cream }}>
            {mo.when} → <b style={{ color: C.gold }}>{(PACKS.find((q) => q.id === mo.to) || {}).chip}</b>
          </div>
          {mo.note && <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{mo.note}</div>}
        </button>
      ))}
      {ply.why && !whyOpen && (
        <button onClick={() => setWhyOpen(true)} className="text-left rounded-md p-3"
          style={{ background: C.card, border: `1px dashed ${C.gold}66`, color: C.gold, fontSize: 13.5 }}>
          ◇ Why does this work? — think first, then tap
        </button>
      )}
      {ply.why && whyOpen && (
        <div className="rounded-md p-4 flex flex-col gap-2" style={{ background: C.card, border: `1px solid ${C.gold}66` }}>
          <p style={{ fontSize: 13.5, color: C.muted, fontStyle: "italic", lineHeight: 1.5 }}>{ply.why.q}</p>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: C.cream }}>{ply.why.a}</p>
        </div>
      )}
    </div>
  );
}

function FullDrill({ pack, go, onExplain }) {
  const D = pack.dream;
  const ex = EXTRAS[pack.id];
  const userWhite = pack.side !== "black";
  const isUser = (k) => (k % 2 === 0) === userWhite;
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState(null);
  const [miss, setMiss] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [flash, setFlash] = useState(null);
  const [hintFor, setHintFor] = useState(null);

  const done = idx >= D.length;
  const pieces = applyMoves(D.slice(0, idx).map((p) => p.m));

  useEffect(() => {
    if (!done && !isUser(idx)) {
      const tm = setTimeout(() => {
        setFlash("He plays " + D[idx].san + (D[idx].note ? " — " + D[idx].note.split(".")[0] + "." : ""));
        setIdx(idx + 1);
      }, 650);
      return () => clearTimeout(tm);
    }
  }, [idx, done]);

  if (done) {
    const clean = mistakes === 0;
    return (
      <div className="flex flex-col gap-4">
        <Eyebrow color={clean ? C.gold : C.red}>Start-to-end drill complete</Eyebrow>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 28 }}>
          {clean ? "Clean. The dream line is yours." : `${mistakes} stumble${mistakes > 1 ? "s" : ""} — they mark your weak seams.`}
        </h1>
        <Board flip={pack.side === "black"} pieces={applyMoves(D.map((p) => p.m))} frame="gold" last={fromTo(D[D.length - 1].m)} />
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>
          {clean
            ? "The real app would now space this line out and let your games do the testing. One thing remains: he won't always cooperate."
            : "Drill it again until clean — then meet the moves that dodge your dream."}
        </p>
        <Btn full tone="ghost" onClick={() => { setIdx(0); setSel(null); setMiss(0); setMistakes(0); setFlash(null); }}>Drill again</Btn>
        <Btn full tone="red" onClick={() => go("edge")}>Now the edge cases ↯</Btn>
      </div>
    );
  }

  const expected = D[idx];
  const waiting = !isUser(idx);
  const advance = () => { setIdx(idx + 1); setSel(null); setMiss(0); };
  const tap = (name) => {
    if (waiting) return;
    const pc = pieces[sq(name)];
    const mine = pc && ((pc === pc.toUpperCase()) === userWhite);
    if (mine) { setSel(sel === name ? null : name); return; }
    if (!sel) return;
    const [from, to] = fromTo(expected.m);
    if (sel === from && name === to) { advance(); }
    else if (miss === 0) { setMiss(1); setMistakes(mistakes + 1); }
    else { setMiss(2); setTimeout(advance, 900); }
    setSel(null);
  };
  const lastM = idx > 0 ? D[idx - 1].m : null;
  const fen = toFEN(pieces, D.slice(0, idx).map((p) => p.m), idx);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Eyebrow color={C.gold}>Your moves · {expected.san.split(".")[0]} of {Math.ceil(D.length / 2)}</Eyebrow>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.muted }}>{mistakes === 0 ? "clean" : `${mistakes} stumble${mistakes > 1 ? "s" : ""}`}</span>
      </div>
      <div style={{ height: 4, background: C.card, borderRadius: 2 }}>
        <div style={{ width: (idx / D.length) * 100 + "%", height: 4, background: C.gold, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
      <Board
        flip={pack.side === "black"}
        pieces={miss === 2 ? applyMoves(D.slice(0, idx + 1).map((p) => p.m)) : pieces}
        last={miss === 2 ? fromTo(expected.m) : lastM ? fromTo(lastM) : null}
        sel={sel}
        fen={fen}
        marks={miss === 1 ? [fromTo(expected.m)[0]] : []}
        onTap={miss === 2 || waiting ? undefined : tap}
      />
      {flash && miss === 0 && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: C.muted }}>{flash}</div>
      )}
      {waiting && <div style={{ fontSize: 13, color: C.muted }}>…</div>}
      {miss === 1 && (
        <div className="rounded-md p-3" style={{ background: C.goldSoft, fontSize: 14 }}>
          Not that — the highlighted piece moves. One more try.
        </div>
      )}
      {miss === 2 && (
        <div className="rounded-md p-3" style={{ background: C.redSoft, fontSize: 14 }}>
          {expected.san} — watch it, then keep going.
        </div>
      )}
      {hintFor === expected.chunk ? (
        <div className="rounded-md p-3" style={{ background: C.card, border: `1px solid ${C.gold}66`, fontSize: 13.5, lineHeight: 1.55 }}>
          ◈ {ex.hints[expected.chunk]}
        </div>
      ) : (
        <button onClick={() => setHintFor(expected.chunk)} className="text-left rounded-md p-3"
          style={{ background: C.card, border: `1px dashed ${C.line}`, color: C.muted, fontSize: 13 }}>
          ◈ Stuck? — thinking hint for this chunk
        </button>
      )}
      <Btn full tone="ghost" onClick={onExplain}>← Back to the explanation</Btn>
    </div>
  );
}

function LearnFlow({ pack, go, switchPack }) {
  const [phase, setPhase] = useState("explain");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {[["explain", "1 · Explained walk"], ["drill", "2 · Drill it, start → end"]].map(([id, label]) => (
          <button key={id} onClick={() => setPhase(id)}
            className="px-3 py-1.5 rounded-full whitespace-nowrap"
            style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace",
              background: phase === id ? C.cream : C.card, color: phase === id ? "#1C150E" : C.muted,
              border: `1px solid ${phase === id ? C.cream : C.line}` }}>{label}</button>
        ))}
      </div>
      {phase === "explain"
        ? <ExplainWalk key={pack.id} pack={pack} onDrill={() => setPhase("drill")} switchPack={switchPack} />
        : <FullDrill key={pack.id} pack={pack} go={go} onExplain={() => setPhase("explain")} />}
    </div>
  );
}

/* ============ PHASE 3 · EDGE CASES ============ */

function EdgeCases({ pack, go, switchPack }) {
  const G = pack.danger;
  const D = pack.dream;
  const baseMoves = G.base || D.slice(0, G.baseCount).map((p) => p.m);
  const divergeIdx = baseMoves.length;
  const [mode, setMode] = useState("intro"); // intro | play | done
  const [t, setT] = useState(0);
  const [sel, setSel] = useState(null);
  const [miss, setMiss] = useState(0);
  const [stumbles, setStumbles] = useState(0);
  const [flash, setFlash] = useState(null);

  const userWhite = pack.side !== "black";
  const isUser = (k) => (k % 2 === 0) === userWhite;
  useEffect(() => {
    if (mode === "play" && t < G.plies.length && !isUser(divergeIdx + t)) {
      const tm = setTimeout(() => { setFlash((t === 0 ? "⚠ He deviates: " : "He plays ") + G.plies[t].san); setT(t + 1); }, t === 0 ? 500 : 650);
      return () => clearTimeout(tm);
    }
    if (mode === "play" && t >= G.plies.length) setMode("done");
  }, [mode, t]);

  const ledger = (
    <div className="rounded-md p-4 flex flex-col gap-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <Eyebrow>{G.ledgerTitle}</Eyebrow>
      {G.ledger.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between" style={{ fontSize: 13, marginBottom: 3 }}>
            <span>{r.label}</span><span style={{ fontFamily: "'IBM Plex Mono', monospace", color: r.color }}>{r.pct}%</span>
          </div>
          <div style={{ height: 6, background: C.ink, borderRadius: 3 }}>
            <div style={{ width: r.pct + "%", height: 6, background: r.color, borderRadius: 3 }} />
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: C.muted }}>Mock numbers — the real app prices this from games at your elo.</div>
    </div>
  );

  if (mode === "intro") {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <Eyebrow color={C.red}>{G.eyebrow}</Eyebrow>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 28, lineHeight: 1.15, marginTop: 6 }}>{G.headline}</h1>
        </div>
        <Board flip={pack.side === "black"} pieces={applyMoves(baseMoves)} frame="red" />
        <p style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.6 }}>
          Everything went to plan — until here. This time he plays the move that dodges your dream. You handle it live, on the board.
        </p>
        {ledger}
        <Btn full tone="red" onClick={() => { setMode("play"); setT(0); setSel(null); setMiss(0); setFlash(null); }}>
          Face the deviation — you play {pack.side === "black" ? "Black" : "White"} ↯
        </Btn>
      </div>
    );
  }

  if (mode === "done") {
    const lastPly = G.plies[G.plies.length - 1];
    return (
      <div className="flex flex-col gap-5">
        <Eyebrow color={C.red}>Edge case handled{stumbles > 0 ? ` — ${stumbles} stumble${stumbles > 1 ? "s" : ""}` : " — clean"}</Eyebrow>
        <Board flip={pack.side === "black"} pieces={applyMoves([...baseMoves, ...G.plies.map((x) => x.m)])} frame="gold" last={fromTo(lastPly.m)} />
        <div className="rounded-md p-4" style={{ background: C.redSoft, border: `1px solid ${C.red}55` }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.6 }}>{lastPly.note}</p>
        </div>
        <div className="rounded-md p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <Eyebrow color={C.red}>{G.survivalTitle}</Eyebrow>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, marginTop: 6 }}>{G.survival}</p>
        </div>
        <div className="rounded-md p-4 flex flex-col gap-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <Eyebrow>{G.bailoutTitle}</Eyebrow>
          <Board flip={pack.side === "black"} pieces={applyMoves(G.bailoutMoves)} last={G.bailoutLast} size="min(60vw, 240px)" />
          <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.55 }}>{G.bailoutNote}</p>
        </div>
        {G.morphTo && (
          <Btn full onClick={() => switchPack(G.morphTo)}>⇄ This deviation is its own pack: {(PACKS.find((q) => q.id === G.morphTo) || {}).chip} →</Btn>
        )}
        <Btn full tone="ghost" onClick={() => { setMode("intro"); setT(0); setStumbles(0); }}>Face it again</Btn>
        <Btn full onClick={() => go("learn")}>Back to the dream line →</Btn>
      </div>
    );
  }

  // play
  const applied = [...baseMoves, ...G.plies.slice(0, t).map((x) => x.m)];
  const expected = G.plies[t];
  const waiting = !isUser(divergeIdx + t);
  const pieces = applyMoves(applied);
  const lastM = applied[applied.length - 1];
  const fen = toFEN(pieces, applied, divergeIdx + t);
  const advance = () => { setT(t + 1); setSel(null); setMiss(0); };
  const tap = (name) => {
    if (waiting || !expected) return;
    const pc = pieces[sq(name)];
    if (pc && ((pc === pc.toUpperCase()) === userWhite)) { setSel(sel === name ? null : name); return; }
    if (!sel) return;
    const [from, to] = fromTo(expected.m);
    if (sel === from && name === to) { advance(); }
    else if (miss === 0) { setMiss(1); setStumbles(stumbles + 1); }
    else { setMiss(2); setTimeout(advance, 900); }
    setSel(null);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Eyebrow color={C.red}>The edge case — you play {pack.side === "black" ? "Black" : "White"}</Eyebrow>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.muted }}>{stumbles === 0 ? "clean" : `${stumbles} stumble${stumbles > 1 ? "s" : ""}`}</span>
      </div>
      <div style={{ height: 4, background: C.card, borderRadius: 2 }}>
        <div style={{ width: (t / G.plies.length) * 100 + "%", height: 4, background: C.red, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
      <Board
        pieces={miss === 2 && expected ? applyMoves([...applied, expected.m]) : pieces}
        last={miss === 2 && expected ? fromTo(expected.m) : lastM ? fromTo(lastM) : null}
        sel={sel}
        fen={fen}
        marks={miss === 1 && expected ? [fromTo(expected.m)[0]] : []}
        onTap={miss === 2 || waiting ? undefined : tap}
      />
      {flash && miss === 0 && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: C.red }}>{flash}</div>
      )}
      {waiting && <div style={{ fontSize: 13, color: C.muted }}>…</div>}
      {miss === 1 && (
        <div className="rounded-md p-3" style={{ background: C.goldSoft, fontSize: 14 }}>
          Not that — the highlighted piece moves. One more try.
        </div>
      )}
      {miss === 2 && expected && (
        <div className="rounded-md p-3" style={{ background: C.redSoft, fontSize: 14 }}>
          {expected.san} — watch it, then continue.
        </div>
      )}
      {t > 0 && G.plies[t - 1] && G.plies[t - 1].note && miss === 0 && (
        <div className="rounded-md p-3" style={{ background: C.card, border: `1px solid ${C.line}`, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
          {G.plies[t - 1].note}
        </div>
      )}
    </div>
  );
}

/* ---------- shell ---------- */

/* ============ THE DAILY GAUNTLET — the whole Scotch, shuffled ============ */
const GKEY = "lines-gauntlet-v1";
const GKEY2 = "lines-gauntlet-v2";
const GKEY3 = "lines-gauntlet-v3"; // v6.3 memory model (H/last/relearn records)
const TREEKEY = "lines-tree-v1";   // deprecated in v6.4 (learned LINES gate the gauntlet now); key left for old installs
const CCUSER = "lines-cc-user";    // chess.com username
const CCCACHE = "lines-cc-cache-v1"; // per-month cache of trimmed game records
const APP_VER = "v6.5·git";
const SAVER = (() => {
  let t = null, last = null, status = "idle", lastAt = 0; // idle | saving | ok | fail
  const subs = new Set();
  const notify = () => subs.forEach((f) => { try { f(); } catch (e) {} });
  const write = async () => {
    if (!last) return;
    const pl = last;
    status = "saving"; notify();
    try {
      if (!STORE) throw new Error("no storage");
      await STORE.set(GKEY3, JSON.stringify(pl));
      status = "ok"; lastAt = Date.now();
    } catch (e) { status = "fail"; }
    notify();
  };
  return {
    push: (pl, delay) => { last = pl; clearTimeout(t); if (!delay) write(); else t = setTimeout(write, delay); },
    flush: () => { clearTimeout(t); write(); },
    state: () => ({ status, lastAt }),
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  };
})();
/* learned-lines state: which runs have passed the Learn gate (walk + one clean
   try). Learned admits a line to the gauntlet; it is NOT memory evidence. */
const LEARNKEY = "lines-learn-v1";
const LEARN = (() => {
  let st = { learned: {}, walked: {} };
  let loaded = false;
  const subs = new Set();
  const notify = () => subs.forEach((f) => { try { f(); } catch (e) {} });
  const save = () => { try { if (STORE) STORE.set(LEARNKEY, JSON.stringify(st)); } catch (e) {} };
  return {
    state: () => st,
    load: async () => {
      if (loaded) return; loaded = true;
      try { const r = STORE && (await STORE.get(LEARNKEY)); if (r && r.value) st = { learned: {}, walked: {}, ...JSON.parse(r.value) }; } catch (e) {}
      notify();
    },
    markWalked: (sig) => { if (!st.walked[sig]) { st = { ...st, walked: { ...st.walked, [sig]: Date.now() } }; save(); notify(); } },
    markLearned: (sig) => { if (!st.learned[sig]) { st = { learned: { ...st.learned, [sig]: Date.now() }, walked: { ...st.walked, [sig]: st.walked[sig] || Date.now() } }; save(); notify(); } },
    replace: (learned) => { st = { ...st, learned: learned || {} }; save(); notify(); },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  };
})();

/* shared games analysis: one computation over the cached chess.com games, used
   by Learn (what next), Practice (what's urgent) and the My Games view. */
const GAMESTATS = (() => {
  let res = null, games = null, status = "idle";
  const subs = new Set();
  const notify = () => subs.forEach((f) => { try { f(); } catch (e) {} });
  const compute = () => {
    if (!games || !games.length) return;
    const H = { sq, posKey, START };
    const w = analyzeGames(FULL_TREE, H, games);
    const b = analyzeGames(FULL_TREE_B, H, games, { side: "black" });
    const cut = Date.now() - 30 * 86400000;
    const rw = games.filter((g) => g.white && (g.t || 0) * 1000 >= cut);
    const rb = games.filter((g) => !g.white && (g.t || 0) * 1000 >= cut);
    res = { w, b, runProb: { ...w.runProb, ...b.runProb },
      recentWhiteScore: scorePct(rw), recentWhiteN: rw.length,
      recentBlackScore: scorePct(rb), recentBlackN: rb.length };
  };
  return {
    res: () => res,
    status: () => status,
    load: async () => {
      if (status !== "idle") return;
      status = "loading";
      try {
        const c = STORE && (await STORE.get(CCCACHE));
        if (c && c.value) {
          const d = JSON.parse(c.value);
          games = Object.values(d.months || {}).flat().map((g) => ({ white: !!g.w, s: g.s, r: g.r, t: g.t, url: g.url }));
          compute();
        }
      } catch (e) {}
      status = "ready"; notify();
    },
    setGames: (recs) => { games = recs.map((g) => ({ white: !!g.w, s: g.s, r: g.r, t: g.t, url: g.url })); compute(); status = "ready"; notify(); },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  };
})();

/* mastery model v2 — spacing owns the crown, volume earns respect.
   First clean hand-play of a day: c += GAIN_DAY*(1-c) (may cross the proven line).
   Same-day clean repeats: c += GAIN_REP*(1-c), CAPPED at REP_CEIL — volume differentiates
   within a day but only a fresh day crosses 0.8. Miss while learning: c *= CRASH_LEARN.
   Miss on proven ground: c = CRACK_FLOOR — the serious flag, ~3 fresh days to re-earn.
   Any miss blocks that position's gains for the rest of the day. */
const CONF = { PROVEN: 0.8, GAIN_DAY: 0.45, GAIN_REP: 0.12, REP_CEIL: 0.7, CRASH_LEARN: 0.5, CRACK_FLOOR: 0.3 };
const recalConf = (cf) => { // one-time upgrade: credit clean same-day volume already on record
  const out = {};
  Object.keys(cf).forEach((k2) => {
    const r = cf[k2] || {};
    out[k2] = (r.miss || 0) === 0
      ? { ...r, c: Math.max(r.c || 0, Math.min(CONF.REP_CEIL, 0.4 + 0.05 * (r.seen || 0))) }
      : r;
  });
  return out;
};
const confOf = (conf, k) => (conf[k] && typeof conf[k].c === "number" ? conf[k].c : 0);

const dayInfo = (days, ds) => {
  const pl = ((days[ds] || {}).plays) || {};
  const ks = Object.keys(pl);
  if (!ks.length) return null;
  let u = 0, m = 0, fx = 0;
  for (const sg of ks) { u += pl[sg].u || 0; m += pl[sg].m || 0; if (pl[sg].fx) fx++; }
  return { runs: ks.length, u, m, fx, acc: u ? Math.round((100 * Math.max(0, u - m)) / u) : 0 };
};
function CalCard({ days, runsN }) {
  const [off, setOff] = useState(0);
  const [selDay, setSelDay] = useState(dayStr());
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + off, 1);
  const y = base.getFullYear(), m = base.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const nDays = new Date(y, m + 1, 0).getDate();
  const todayS = dayStr(now);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const played = (ds) => Object.keys(((days[ds] || {}).plays) || {}).length;
  const perfectDay = (ds) => {
    const pl = ((days[ds] || {}).plays) || {};
    const ks = Object.keys(pl);
    return ks.length >= runsN && ks.every((sg) => pl[sg].m === 0);
  };
  const streak = (() => {
    let n = 0; const d = new Date();
    if (!played(dayStr(d))) d.setDate(d.getDate() - 1);
    while (played(dayStr(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  })();
  const best = (() => {
    const ks = Object.keys(days).filter((ds) => played(ds)).sort();
    let b = 0, cu = 0, prev = null;
    for (const ds of ks) {
      const dt = new Date(ds + "T12:00:00");
      cu = prev && Math.round((dt - prev) / 86400000) === 1 ? cu + 1 : 1;
      b = Math.max(b, cu); prev = dt;
    }
    return b;
  })();
  const cells = [];
  for (let z = 0; z < firstDow; z++) cells.push(null);
  for (let dd = 1; dd <= nDays; dd++) cells.push(dd);
  return (
    <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: C.card }}>
      <div className="flex items-center justify-between">
        <button onClick={() => setOff(off - 1)} style={{ background: "none", border: "none", color: C.muted, fontSize: 18, cursor: "pointer", padding: "0 8px" }}>{"‹"}</button>
        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 15, color: C.cream }}>{MONTHS[m]} {y}</span>
        <button onClick={() => setOff(Math.min(0, off + 1))} style={{ background: "none", border: "none", color: off < 0 ? C.muted : C.line, fontSize: 18, cursor: "pointer", padding: "0 8px" }}>{"›"}</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((w, wi) => (
          <div key={"w" + wi} style={{ textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: C.muted, opacity: 0.7 }}>{w}</div>
        ))}
        {cells.map((dd, ci) => {
          if (!dd) return <div key={ci} />;
          const ds = dayStr(new Date(y, m, dd));
          const pN = played(ds);
          const full = pN >= runsN;
          const perf = full && perfectDay(ds);
          const isToday = ds === todayS;
          const isSel = ds === selDay;
          return (
            <div key={ci} onClick={() => setSelDay(ds)} className="rounded flex items-center justify-center" style={{
              height: 30, cursor: "pointer",
              background: isSel ? C.goldSoft : full ? C.goldSoft : "transparent",
              border: `1px solid ${isSel ? C.cream + "88" : isToday ? C.gold : "transparent"}`,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5,
              color: full ? C.gold : pN ? C.cream : C.muted,
              opacity: pN || isToday ? 1 : 0.55,
              position: "relative",
            }}>
              {perf ? "✦" : dd}
              {pN > 0 && !full && (
                <span style={{ position: "absolute", bottom: 2, width: 4, height: 4, borderRadius: 2, background: C.gold }} />
              )}
            </div>
          );
        })}
      </div>
      {(() => {
        const inf = dayInfo(days, selDay);
        const lbl = new Date(selDay + "T12:00:00").toLocaleDateString("en", { month: "short", day: "numeric" });
        return (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: inf ? C.cream : C.muted, minHeight: 15 }}>
            <span style={{ color: C.gold }}>{lbl}</span>
            {inf
              ? ` · ${inf.runs}/${runsN} runs · ${inf.acc}% first-try · ${inf.m} miss${inf.m === 1 ? "" : "es"}${inf.fx ? ` · ${inf.fx} fixed` : ""}`
              : " · no runs"}
          </div>
        );
      })()}
      <div className="flex items-center justify-between" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>
        <span style={{ color: C.gold }}>STREAK {streak}{best > streak ? ` · BEST ${best}` : ""}</span>
        <span style={{ color: C.muted, opacity: 0.8 }}>tap a day · ▩ all · ✦ perfect</span>
      </div>
    </div>
  );
}

function Gauntlet({ onExit, onLearn }) {
  const [mode, setMode] = useState("home"); // home | run | done
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState({});
  const [hit, setHit] = useState({});
  const [missedPos, setMissedPos] = useState({});
  const [lifeRuns, setLifeRuns] = useState(0);
  const [lifeClean, setLifeClean] = useState(0);
  const [curSig, setCurSig] = useState(null);
  const [hist, setHist] = useState([]);
  const [sel, setSel] = useState(null);
  const [miss, setMiss] = useState(0);
  const [msg, setMsg] = useState(null);
  const [sans, setSans] = useState([]);
  const [runMisses, setRunMisses] = useState(0);
  const [conf, setConf] = useState({});
  const [ffPlan, setFfPlan] = useState([]);
  const [runCracks, setRunCracks] = useState(0);
  const [loadInfo, setLoadInfo] = useState("loading");
  const [expNote, setExpNote] = useState(null);
  const [expRaw, setExpRaw] = useState(null);
  const [impOpen, setImpOpen] = useState(false);
  const [impTxt, setImpTxt] = useState("");
  const [, bumpSave] = useState(0);
  useEffect(() => SAVER.subscribe(() => bumpSave((x) => x + 1)), []);
  const T = FULL_TREE;
  const [, bumpLearn] = useState(0);
  useEffect(() => LEARN.subscribe(() => bumpLearn((x) => x + 1)), []);
  const [, bumpGS] = useState(0);
  useEffect(() => { GAMESTATS.load(); return GAMESTATS.subscribe(() => bumpGS((x) => x + 1)); }, []);
  const learnedRuns = useMemo(() => ALL_RUNS.filter((r) => LEARN.state().learned[r.sig]), [LEARN.state()]);
  const learnedPos = useMemo(() => { const set = new Set(); for (const r of learnedRuns) r.userKeys.forEach((k2) => set.add(k2)); return set; }, [learnedRuns]);
  const shownRef = useRef(Date.now());

  // persistence (v2 schema; migrates v1 lifetime stats on first load)
  useEffect(() => {
    (async () => {
      let got = false;
      try {
        const r3 = STORE && (await STORE.get(GKEY3));
        if (r3 && r3.value) {
          const d = JSON.parse(r3.value);
          const dd = d.days || {};
          const t0 = dayStr();
          Object.keys(dd).forEach((ds) => { if (ds !== t0 && dd[ds]) { delete dd[ds].hand; delete dd[ds].missed; } });
          setDays(dd); setHit(d.hit || {}); setMissedPos(d.missedPos || {});
          setLifeRuns(d.lifeRuns || 0); setLifeClean(d.lifeClean || 0);
          setConf(d.mem || {});
          got = true;
        }
      } catch (e) {}
      // v6.3 is a deliberate fresh start: v1/v2 saved state is not auto-loaded.
      // Old exports still restore (best-effort seed) through the Restore box.
      await LEARN.load();
      setLoadInfo(got ? "restored" : "fresh start (v6.3)");
      setLoaded(true);
    })();
  }, []);
  // grandfather: practice history proves a line — recorded day-plays or full
  // memory evidence mark it learned without re-walking the Learn flow.
  useEffect(() => {
    if (!loaded) return;
    const st = LEARN.state();
    for (const r of ALL_RUNS) if (!st.learned[r.sig] && grandfathered(r, days, conf)) LEARN.markLearned(r.sig);
  }, [loaded]);
  // checkpoint saves: instant off-run, slow-debounced during a run (storage is rate-limited;
  // a save per board move floods it and later writes fail silently — the original zeroing bug)
  useEffect(() => {
    if (!loaded) return;
    SAVER.push({ days, hit, missedPos, lifeRuns, lifeClean, mem: conf, memV: 3 }, mode === "run" ? 6000 : 0);
  }, [loaded, days, hit, missedPos, lifeRuns, lifeClean, conf, mode]);

  const today = dayStr();
  const todays = days[today] || { plays: {} };
  const order = useMemo(() => daySeedOrder(today, learnedRuns.length), [today, learnedRuns.length]);
  const session = useMemo(() => order.map((ix) => learnedRuns[ix]).filter(Boolean), [order, learnedRuns]);
  const playedN = Object.keys(todays.plays).length;
  const cleanN = session.filter((r) => todays.plays[r.sig] && todays.plays[r.sig].m === 0).length;
  const stumbles = session.filter((r) => { const pl = todays.plays[r.sig]; return pl && pl.m > 0 && !pl.fx; });
  const nextUp = session.find((r) => !todays.plays[r.sig]) || stumbles[0] || null;
  const redoPhase = playedN >= session.length && session.length > 0 && stumbles.length > 0;

  const cur = curSig ? ALL_RUNS.find((r) => r.sig === curSig) : null;
  const up = cur && cur.side === "black" ? 1 : 0; // the user's ply parity in the current run
  const pieces = useMemo(() => applyMoves(hist), [hist]);
  const k = hist.length;
  const key = posKey(pieces, k % 2);
  const lastTok = hist.length ? hist[hist.length - 1] : null;

  const startRun = (sg) => {
    const run = ALL_RUNS.find((r) => r.sig === sg);
    const lastJ = run.userKeys.length - 1;
    const now = Date.now();
    // v6.3: performance-gated — fast-forward whatever the model predicts you still
    // own (R >= 0.8 and not in relearn). No calendar gate; the payoff move is always yours.
    const plan = run.userKeys.map((k2, j2) =>
      j2 !== lastJ && owned(conf[k2], now) ? "ff" : "hand");
    setFfPlan(plan);
    setCurSig(sg); setHist([]); setSel(null); setMiss(0); setMsg(null);
    setSans([]); setRunMisses(0); setRunCracks(0); setMode("run");
  };
  // gain: whether this encounter may move confidence (first clean hand-play of the day).
  // door: the opponent move that delivered us here — logged on every hand encounter, so
  // door-conditional weakness ("misses this only via 4...Qf6") is detectable from data
  // without ever scoring paths.
  // v6.3 fold: stability gain indexed on the model's own prediction at test time.
  // door: the opponent move that delivered us here — logged on every hand encounter.
  const bumpConf = (k2, clean, door, latMs) => {
    setConf((C0) => ({ ...C0, [k2]: foldResult(C0[k2], clean, Date.now(), door, latMs).rec }));
  };
  const markHand = (k2) => setDays((D) => {
    const day = { ...(D[today] || { plays: {} }) };
    day.hand = { ...(day.hand || {}), [k2]: 1 };
    return { ...D, [today]: day };
  });
  const markMiss = (k2) => setDays((D) => {
    const day = { ...(D[today] || { plays: {} }) };
    day.missed = { ...(day.missed || {}), [k2]: 1 };
    return { ...D, [today]: day };
  });
  const markCrack = (k2) => setDays((D) => {
    const day = { ...(D[today] || { plays: {} }) };
    day.cracks = [...(day.cracks || []), k2];
    return { ...D, [today]: day };
  });

  const endRun = () => {
    setDays((D) => {
      const day = { ...(D[today] || { plays: {} }) };
      const plays = { ...day.plays };
      const handN = ffPlan.filter((x) => x !== "ff").length;
      const ffN = ffPlan.length - handN;
      if (!plays[curSig]) plays[curSig] = { m: runMisses, u: handN, ff: ffN };
      else if (runMisses === 0 && plays[curSig].m > 0 && !plays[curSig].fx) plays[curSig] = { ...plays[curSig], fx: true };
      day.plays = plays;
      return { ...D, [today]: day };
    });
    setLifeRuns((r) => r + 1);
    if (runMisses === 0) setLifeClean((c) => c + 1);
    setMode("done");
  };

  // scripted run: opponent plays this run's book move; end when the path runs out
  useEffect(() => {
    if (mode !== "run" || !cur) return;
    if (k >= cur.toks.length) {
      const t = setTimeout(endRun, 550);
      return () => clearTimeout(t);
    }
    if (k % 2 === up && ffPlan[(k - up) / 2] === "ff") {
      const t = setTimeout(() => {
        setHist((h) => [...h, cur.toks[k]]);
        setSans((x) => [...x, cur.sans[k] || ""]);
      }, 260);
      return () => clearTimeout(t);
    }
    if (k % 2 !== up) {
      const fast = k > 0 && ffPlan[(k - 1 - up) / 2] === "ff";
      const t = setTimeout(() => {
        setHist((h) => [...h, cur.toks[k]]);
        setSans((x) => [...x, cur.sans[k] || ""]);
        setMsg(null);
      }, fast ? 260 : 480);
      return () => clearTimeout(t);
    }
  }, [mode, k]);

  useEffect(() => { shownRef.current = Date.now(); }, [key]);
  const expected = cur && mode === "run" && k % 2 === up && k < cur.toks.length && ffPlan[(k - up) / 2] !== "ff"
    ? { m: cur.toks[k], san: cur.sans[k] || "" } : null;
  const expFT = expected ? fromTo(expected.m) : null;

  const onTap = (name) => {
    if (!expected) return;
    const pc = pieces[sq(name)];
    const own = (p2) => p2 && (up === 1 ? p2 === p2.toLowerCase() : p2 === p2.toUpperCase());
    if (!sel) { if (own(pc)) setSel(name); return; }
    if (sel === name) { setSel(null); return; }
    // switching to another of your own pieces is a re-selection, never a move
    if (own(pc)) { setSel(name); return; }
    if (sel + name === expFT[0] + expFT[1]) {
      const door = k === 0 ? "start" : (sans[k - 1] || "?");
      if (miss === 0) { setHit((h) => ({ ...h, [key]: true })); bumpConf(key, true, door, Date.now() - shownRef.current); }
      markHand(key);
      setHist((h) => [...h, expected.m]); setSans((x) => [...x, expected.san]);
      setSel(null); setMiss(0); setMsg(null);
    } else {
      const nm = miss + 1;
      setSel(null);
      if (nm === 1) {
        const wasOwned = owned(conf[key], Date.now());
        setMiss(1); setRunMisses((r) => r + 1);
        setMissedPos((mp) => ({ ...mp, [key]: (mp[key] || 0) + 1 }));
        bumpConf(key, false, k === 0 ? "start" : (sans[k - 1] || "?")); markMiss(key);
        if (wasOwned) { setRunCracks((c2) => c2 + 1); markCrack(key); }
        setMsg(wasOwned
          ? "⛑ OWNED ground cracked — that is the serious flag. The mover is marked; fix it by hand, and the position must be re-proven from memory."
          : "Not that one — logged as a miss. The mover is marked; now fix it yourself.");
      } else {
        setMiss(0); markHand(key);
        setMsg(`It was ${expected.san}. Autoplayed — it waits for you at the end of the session.`);
        setHist((h) => [...h, expected.m]); setSans((x) => [...x, expected.san]);
      }
    }
  };

  const covered = Object.keys(hit).length;
  const Stat = ({ label, val }) => (
    <div className="flex flex-col items-center px-3 py-2 rounded-md" style={{ background: C.card, minWidth: 72 }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: C.gold }}>{val}</div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: "0.1em", color: C.muted }}>{label}</div>
    </div>
  );
  // THE LOG — everything remapped from opaque keys to readable ids, self-documenting,
  // built for hypothesis-hunting rather than debugging.
  const buildExport = () => {
    const positions = {};
    for (const r of ALL_RUNS) r.userKeys.forEach((k2, j2) => {
      if (!positions[k2]) positions[k2] = { at: r.id + "@" + (j2 + 1), move: (treeOf(r).REP.user[k2] || {}).san || "?", runs: [] };
      if (positions[k2].runs.indexOf(r.id) < 0) positions[k2].runs.push(r.id);
    });
    const runsDict = {};
    ALL_RUNS.forEach((r) => { runsDict[r.sig] = { id: r.id, label: r.label, pack: r.packId, kind: r.kind, side: r.side, moves: r.sans.filter(Boolean).join(" ") }; });
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
      _schema: "v6.3 memory model. mastery[pos]: H=stability half-life (days); last=last hand-test; R=predicted retrievability at export, R=2^(-days/H) (owned>=0.8 fast-forwards; a miss opens relearn until one clean hand-play). On success H*=1+2.2*(1-R) — gain indexed on the model's own prediction. ev=[minuteEpoch,clean,door,latencyMs] event log (newest last, capped). via[door]=[handEncounters,misses] keyed by the opponent move that led in. days[date].plays[run]={m:misses,u:handMoves,ff:fastForwarded,fx:fixedOnRedo}. Positions labeled runId@userPlyIndex.",
      meta: { app: APP_VER, exported: new Date().toISOString(), runs: ALL_RUNS.length, positions: FULL_TREE.REP.totalUser + FULL_TREE_B.REP.totalUser, lifetime: { runs: lifeRuns, clean: lifeClean } },
      runs: runsDict,
      mastery,
      days: daysX,
      learn: { learned: LEARN.state().learned },
    };
  };
  const doImport = (txt) => {
    try {
      const d = JSON.parse(txt);
      const at2key = {}, id2sig = {};
      for (const r of ALL_RUNS) {
        id2sig[r.id] = r.sig;
        r.userKeys.forEach((k2, j2) => { const at = r.id + "@" + (j2 + 1); if (!at2key[at]) at2key[at] = k2; });
      }
      if (d.mastery) { // training-log format round-trips as a backup
        const nc = {};
        Object.keys(d.mastery).forEach((at) => {
          const k2 = at2key[at]; if (!k2) return;
          const m = d.mastery[at];
          nc[k2] = m.H != null
            ? { H: m.H || 0, last: m.last ? Date.parse(m.last) : 0, relearn: !!m.relearn, seen: m.seen || 0, miss: m.miss || 0, cracks: m.cracks || 0, via: m.via || {}, ev: m.ev || [] }
            : seedFromConf(m.c || 0, m.seen, m.miss, m.cracks, m.via, Date.now()); // v6.2 export: best-effort seed
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
        setConf(nc); setDays(nd); setHit(nh); setMissedPos(nm);
        const lt = (d.meta || {}).lifetime || {};
        setLifeRuns(lt.runs || 0); setLifeClean(lt.clean || 0);
        if (d.learn && d.learn.learned) LEARN.replace(d.learn.learned);
        return `restored ${Object.keys(nc).length} positions across ${Object.keys(nd).length} day(s) — saving now.`;
      }
      return "unrecognized format — paste a full training-log export.";
    } catch (e) { return "could not parse — paste the complete export text."; }
  };
  const doExport = async () => {
    const payload = JSON.stringify(buildExport());
    let ok = false;
    try { await navigator.clipboard.writeText(payload); ok = true; } catch (e) {}
    if (ok) { setExpRaw(null); setExpNote(`copied — ${(payload.length / 1024).toFixed(1)} KB. Paste it to Claude and ask for hypotheses.`); }
    else { setExpRaw(payload); setExpNote("clipboard blocked — long-press the box below to copy."); }
  };
  const scoreOf = (r) => {
    const pl = todays.plays[r.sig];
    if (!pl) return { txt: "—", col: C.muted };
    const den = pl.u != null ? pl.u : r.uCount;
    const ffb = pl.ff ? ` ⏩${pl.ff}` : "";
    if (pl.m === 0) return { txt: `✓ ${den}/${den}${ffb}`, col: C.gold };
    const sc = `${Math.max(0, den - pl.m)}/${den}${ffb}`;
    return pl.fx ? { txt: `${sc} ✓fx`, col: C.gold } : { txt: sc, col: C.red };
  };

  if (mode === "home") return (
    <div className="flex flex-col gap-4 px-5 pb-8">
      <Eyebrow>{"⚡"} The daily gauntlet</Eyebrow>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, lineHeight: 1.2, margin: 0 }}>
        Same tree. Fresh order. Every day.
      </h2>
      <p style={{ fontSize: 14.5, lineHeight: 1.6, color: C.cream, margin: 0 }}>
        {session.length ? `All ${session.length} learned runs in today’s order. ` : ""}Whatever the model predicts you still remember fast-forwards — knowledge is acknowledged at the speed it’s demonstrated, and only time decays it. A payoff move is always yours. Misses wait at the end; a crack in owned ground is the flag that matters. New lines join here the moment you learn them.
      </p>
      <CalCard days={days} runsN={session.length} />
      {(() => {
        const ti = dayInfo(days, today);
        return (
          <div className="flex gap-2 flex-wrap">
            <Stat label="TODAY" val={`${playedN}/${session.length}`} />
            <Stat label="FIRST-TRY" val={ti ? `${ti.acc}%` : "—"} />
            <Stat label="MISSES" val={ti ? ti.m : "—"} />
            <Stat label="OWNED" val={`${Object.keys(conf).filter((k2) => learnedPos.has(k2) && owned(conf[k2], Date.now())).length}/${learnedPos.size}`} />
          </div>
        );
      })()}
      {nextUp ? (
        <Btn full onClick={() => startRun(nextUp.sig)}>
          {redoPhase ? `↺ Redo ${nextUp.id} — hunt the miss →` : `Play ${nextUp.id} →`}
        </Btn>
      ) : session.length === 0 ? (
        <div className="rounded-md p-4 flex flex-col gap-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <p style={{ fontSize: 13.5, color: C.cream, margin: 0, lineHeight: 1.6 }}>
            Nothing in the gauntlet yet — lines join it by being learned. Walk a line, pass one clean try, and it appears here the same day.
          </p>
          {onLearn && <Btn full onClick={onLearn}>📖 Go learn your first line →</Btn>}
        </div>
      ) : playedN >= session.length ? (
        <div className="rounded-md p-4 text-center" style={{ background: C.goldSoft, border: `1px solid ${C.gold}66`, fontFamily: "'Fraunces', serif", fontSize: 18, color: C.gold }}>
          {"✦"} Day complete {cleanN >= session.length ? "— immaculate." : "— every stumble avenged."}
        </div>
      ) : null}
      {(todays.cracks || []).length > 0 && (
        <div className="rounded-md p-3" style={{ background: "#2A1215", border: `1px solid ${C.red}88` }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: C.red }}>
            ⛑ {(todays.cracks || []).length} owned position{(todays.cracks || []).length > 1 ? "s" : ""} cracked today — flagged runs below deserve a redo.
          </span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {session.map((r, qi) => {
          const sc = scoreOf(r);
          const isNext = nextUp && nextUp.sig === r.sig;
          const pl = todays.plays[r.sig];
          return (
            <button key={r.sig} onClick={() => startRun(r.sig)}
              className="rounded-md px-3 py-2.5 flex items-center gap-2 text-left w-full"
              style={{
                background: C.card, cursor: "pointer",
                border: `1px solid ${isNext ? C.gold : pl ? (pl.m === 0 || pl.fx ? C.gold + "44" : C.red + "55") : C.line}`,
              }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.muted, width: 18, textAlign: "right", opacity: 0.7 }}>{qi + 1}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.gold, whiteSpace: "nowrap" }}>
                {(todays.cracks || []).some((ck) => r.userKeys.indexOf(ck) > -1) ? <span style={{ color: C.red }}>{"⛑ "}</span> : null}
                {r.glyph} {r.id}
              </span>
              <span className="flex-1" style={{ fontSize: 12, color: C.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.85 }}>{r.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: sc.col, whiteSpace: "nowrap" }}>{sc.txt}</span>
            </button>
          );
        })}
      </div>
      {(() => {
        const GS = GAMESTATS.res();
        if (!GS) return null;
        const pn = practiceNext(ALL_RUNS, LEARN.state(), conf, retrievability, GS.runProb, Date.now()).slice(0, 3);
        const recentMisses = [...GS.w.misses, ...GS.b.misses].filter((m) => m.recent > 0).slice(0, 2);
        return (
          <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.1em", color: C.muted }}>FROM YOUR GAMES · practice intel</div>
            {GS.recentWhiteScore != null && (
              <div style={{ fontSize: 12.5, color: C.cream }}>
                Last 30 days — White: <b style={{ color: GS.recentWhiteScore >= 80 ? C.gold : C.cream }}>{GS.recentWhiteScore}%</b>
                <span style={{ color: C.muted }}> ({GS.recentWhiteN}) · goal 80%</span>
                {GS.recentBlackScore != null && (<span> · Black: <b>{GS.recentBlackScore}%</b><span style={{ color: C.muted }}> ({GS.recentBlackN})</span></span>)}
              </div>
            )}
            {pn.map((r) => (
              <div key={r.sig} style={{ fontSize: 12, color: C.cream, opacity: 0.9 }}>
                <span style={{ color: C.gold, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{r.id}</span>
                {" "}— ≈{(100 * (GS.runProb[r.sig] || 0)).toFixed(1)}% of your games{(() => { const rm = r.userKeys.length ? Math.min(...r.userKeys.map((k2) => retrievability(conf[k2], Date.now()))) : 0; return rm < MEM.OWN ? " · fading" : ""; })()}
              </div>
            ))}
            {recentMisses.map((m, i) => (
              <div key={i} style={{ fontSize: 11.5, color: C.red }}>
                real-game slip: expected <b>{m.expected}</b> — {m.recent}× in the last 30 days
              </div>
            ))}
          </div>
        );
      })()}
      {(() => {
        const nowB = Date.now();
        const ks = Object.keys(conf).filter((k2) => learnedPos.has(k2));
        const pv = ks.filter((k2) => owned(conf[k2], nowB)).length;
        const lr = ks.length - pv;
        return (
          <div className="flex flex-col gap-1">
            <div className="rounded-md flex" style={{ background: C.card, height: 8, overflow: "hidden" }}>
              <div style={{ width: `${learnedPos.size ? (100 * pv) / learnedPos.size : 0}%`, background: C.gold, transition: "width .4s" }} />
              <div style={{ width: `${learnedPos.size ? (100 * lr) / learnedPos.size : 0}%`, background: C.gold, opacity: 0.35, transition: "width .4s" }} />
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, color: C.muted, opacity: 0.8 }}>
              memory · ✦ owned {pv} · ◐ fading or learning {lr} · ○ untested {Math.max(0, learnedPos.size - ks.length)} — owned positions fast-forward until decay reclaims them
            </div>
          </div>
        );
      })()}
      {(() => {
        const sv = SAVER.state();
        const fail = sv.status === "fail";
        const txt = fail
          ? "⚠ SAVE FAILED — storage rejected the write; progress may not survive this session"
          : sv.status === "ok"
            ? `↻ saved ${new Date(sv.lastAt).toTimeString().slice(0, 5)} · ${loadInfo}`
            : `↻ autosave armed · ${loadInfo}`;
        return (
          <p style={{ fontSize: 11, color: fail ? C.red : C.muted, fontFamily: "'IBM Plex Mono', monospace", margin: 0, opacity: fail ? 1 : 0.8 }}>
            {txt} · lifetime {lifeClean}/{lifeRuns} clean
          </p>
        );
      })()}
      <div className="flex gap-2">
        <div className="flex-1"><Btn full tone="ghost" onClick={doExport}>{"⇪"} Export log</Btn></div>
        <div className="flex-1"><Btn full tone="ghost" onClick={() => { setExpRaw(null); setExpNote(null); setImpOpen(!impOpen); }}>{"⇩"} Restore</Btn></div>
      </div>
      {impOpen && (
        <div className="flex flex-col gap-2">
          <textarea value={impTxt} onChange={(e) => setImpTxt(e.target.value)} placeholder="paste a training-log export here"
            style={{ width: "100%", height: 80, background: C.card, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, padding: 8 }} />
          <Btn full onClick={() => { const r = doImport(impTxt); setExpNote(r); setImpOpen(false); setImpTxt(""); }}>Apply restore</Btn>
        </div>
      )}
      {expNote && (
        <p style={{ fontSize: 11, color: C.gold, fontFamily: "'IBM Plex Mono', monospace", margin: 0 }}>{expNote}</p>
      )}
      {expRaw && (
        <textarea readOnly value={expRaw} onFocus={(e) => e.target.select()}
          style={{ width: "100%", height: 90, background: C.card, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, padding: 8 }} />
      )}
      <Btn full tone="ghost" onClick={async () => {
        setDays({}); setMissedPos({}); setHit({}); setLifeRuns(0); setLifeClean(0); setConf({});
        try { if (STORE) { await STORE.delete(GKEY3); await STORE.delete(GKEY2); await STORE.delete(GKEY); } } catch (e) {}
      }}>Reset saved progress</Btn>
      <Btn full tone="ghost" onClick={() => { SAVER.flush(); onExit(); }}>{"←"} Back to the packs</Btn>
    </div>
  );

  if (mode === "done") {
    const pk = cur ? PACKS.find((q) => q.id === cur.packId) : null;
    const pl = todays.plays[curSig];
    return (
      <div className="flex flex-col gap-4 px-5 pb-8">
        <div className="flex items-center justify-between">
          <Eyebrow>{cur ? `${cur.glyph} ${cur.id}` : ""} · finished</Eyebrow>
          {pl && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: pl.m === 0 || pl.fx ? C.gold : C.red }}>
              {(() => { const den = pl.u != null ? pl.u : cur.uCount; const ffb = pl.ff ? ` · ⏩${pl.ff}` : ""; return pl.m === 0 ? `clean ${den}/${den}${ffb}` : `first try ${Math.max(0, den - pl.m)}/${den}${ffb}${pl.fx ? " · fixed" : ""}`; })()}
            </span>
          )}
        </div>
        <EvalBar pieces={pieces} hist={hist} k={k} />
        <Board pieces={pieces} last={lastTok ? fromTo(lastTok) : null} frame="gold" />
        <div className="flex gap-3">
          <Btn tone="ghost" onClick={() => setMode("home")}>{"☰"} Session</Btn>
          <div className="flex-1">
            {nextUp
              ? <Btn full onClick={() => startRun(nextUp.sig)}>{todays.plays[nextUp.sig] ? `↺ Redo ${nextUp.id} →` : `Next: ${nextUp.id} →`}</Btn>
              : <Btn full onClick={() => setMode("home")}>{"✦"} Day complete →</Btn>}
          </div>
        </div>
        {runCracks > 0 && (
          <div className="rounded-md p-4" style={{ background: "#2A1215", border: `1px solid ${C.red}88` }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.red, fontSize: 12, letterSpacing: "0.08em" }}>⛑ PROVEN GROUND CRACKED</div>
            <p style={{ fontSize: 13.5, color: C.cream, lineHeight: 1.55, margin: "6px 0 0" }}>
              {runCracks === 1 ? "A position you had proven slipped." : `${runCracks} proven positions slipped.`} That is the flag that matters most — each drops back to relearning and must earn its fast-forward again across fresh days.
            </p>
          </div>
        )}
        {cur && pk && cur.packId && (
          <div className="rounded-md p-4 flex flex-col gap-2" style={{ background: C.goldSoft, border: `1px solid ${C.gold}66` }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontSize: 12, letterSpacing: "0.08em" }}>
              {cur.kind === "dream" ? "✦ LINE COMPLETE" : cur.kind === "future" ? "✦✦ DEEP END" : "⚠ EDGE CASE SURVIVED"} · {pk.chip}
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, lineHeight: 1.25 }}>
              {cur.kind === "dream" ? pk.promise.headline : cur.kind === "future" ? cur.t : pk.danger.headline}
            </div>
            {cur.kind === "future" && cur.note && (
              <p style={{ fontSize: 13, color: C.cream, lineHeight: 1.55, margin: 0 }}>{cur.note}</p>
            )}
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, margin: 0 }}>
              {runMisses === 0 ? "Clean — from memory, start to end." : `${runMisses} stumble${runMisses > 1 ? "s" : ""} — this run waits for you at the end of the queue.`}
            </p>
          </div>
        )}
        {cur && !cur.packId && (
          <div className="rounded-md p-4" style={{ background: C.card }}>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>End of the mapped tree — a fine place to stop.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-5 pb-8">
      <div className="flex items-center justify-between">
        <Eyebrow>{cur ? `${cur.glyph} ${cur.id}` : ""} · you are {up === 1 ? "Black" : "White"}</Eyebrow>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: runMisses ? C.red : C.muted }}>
          {runMisses ? `${runMisses} miss${runMisses > 1 ? "es" : ""}` : "clean"}
        </span>
      </div>
      {(() => {
        const ids = (cur ? treeOf(cur) : T).REP.zones[key] || [];
        const chips = ids.map((id) => ((PACKS.find((q) => q.id === id) || {}).chip)).filter(Boolean);
        return (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.05em", color: C.muted, minHeight: 16, lineHeight: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: C.gold, opacity: 0.8 }}>LINES ALIVE · </span>
            {chips.length ? chips.join("  ") : "—"}
          </div>
        );
      })()}
      {cur && (
        <div className="flex items-center justify-between" style={{ minHeight: 14 }}>
          <div className="flex gap-1 items-center">
            {cur.userKeys.map((k2, j2) => {
              const r2 = retrievability(conf[k2], Date.now());
              const here = k % 2 === 0 && j2 === k / 2;
              return (
                <span key={j2} style={{
                  width: 7, height: 7, borderRadius: 4,
                  background: owned(conf[k2], Date.now()) ? C.gold : r2 > 0 ? C.gold + "66" : "#3A2E24",
                  boxShadow: here ? `0 0 0 1.5px ${C.cream}` : "none",
                  opacity: ffPlan[j2] === "ff" ? 0.45 : 1,
                }} />
              );
            })}
          </div>
          {k % 2 === 0 && k < cur.toks.length && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.muted }}>
              {(() => { const r2 = retrievability(conf[key], Date.now()); return `R ${owned(conf[key], Date.now()) ? "✦" : r2 > 0 ? "◐" : "○"} ${r2.toFixed(2)}`; })()}
            </span>
          )}
        </div>
      )}
      <EvalBar pieces={pieces} hist={hist} k={k} />
      <Board flip={up === 1} pieces={pieces} last={lastTok ? fromTo(lastTok) : null} sel={sel} fen={toFEN(pieces, hist, k)}
        marks={miss === 1 && expFT ? [expFT[0]] : []}
        onTap={onTap} frame={null} />
      <div className="flex gap-3">
        <Btn tone="ghost" onClick={() => setMode("home")}>{"☰"} Session</Btn>
        <div className="flex-1">
          <div className="rounded-md px-3 py-2.5 text-center" style={{ background: C.card, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: k % 2 === 0 ? C.gold : C.muted }}>
            {k % 2 === 0 ? (ffPlan[k / 2] === "ff" ? "⏩ owned — replaying" : "your move — from memory") : "he is thinking…"}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: C.cream, minHeight: 18, lineHeight: 1.6 }}>
        {sans.join("  ")}
      </div>
      {msg && (
        <div className="rounded-md p-3" style={{ background: C.card, border: `1px solid ${C.line}`, fontSize: 13.5, lineHeight: 1.5, color: C.cream }}>
          {msg}
        </div>
      )}
    </div>
  );
}

/* ============ LEARN — walk a line with its story, then prove it from memory ============ */
function LineStudy({ run, onExit }) {
  const pack = PACKS.find((q) => q.id === run.packId) || {};
  const doc = useMemo(() => buildLineDoc(pack, EXTRAS[run.packId] || {}, run, { sq, posKey, START }), [run.sig]);
  const toks = run.toks;
  const up = run.side === "black" ? 1 : 0;
  const flip = run.side === "black";
  const [mode, setMode] = useState("walk"); // walk | try | passed | failed
  const [wi, setWi] = useState(0);
  const [hist, setHist] = useState([]);
  const [sel, setSel] = useState(null);
  const [miss, setMiss] = useState(0);
  const [slips, setSlips] = useState(0);
  const [msg, setMsg] = useState(null);

  const wPieces = useMemo(() => applyMoves(toks.slice(0, wi)), [wi]);
  const lastW = wi > 0 ? fromTo(toks[wi - 1].split(",")[0]) : null;
  const cur = wi > 0 ? doc.plies[wi - 1] : null;
  const atEnd = wi >= toks.length;

  const k = hist.length;
  const tPieces = useMemo(() => applyMoves(hist), [hist]);
  const expected = mode === "try" && k % 2 === up && k < toks.length ? { m: toks[k], san: doc.plies[k].san } : null;
  const expFT = expected ? fromTo(expected.m) : null;

  useEffect(() => {
    if (mode !== "try") return;
    if (k >= toks.length) {
      const t = setTimeout(() => { if (slips === 0) { LEARN.markLearned(run.sig); setMode("passed"); } else setMode("failed"); }, 600);
      return () => clearTimeout(t);
    }
    if (k % 2 !== up) { const t = setTimeout(() => { setHist((h) => [...h, toks[k]]); setMsg(null); }, 480); return () => clearTimeout(t); }
  }, [mode, k]);

  const onTap = (name) => {
    if (!expected) return;
    const pc = tPieces[sq(name)];
    const own = (p2) => p2 && (up === 1 ? p2 === p2.toLowerCase() : p2 === p2.toUpperCase());
    if (!sel) { if (own(pc)) setSel(name); return; }
    if (sel === name) { setSel(null); return; }
    if (own(pc)) { setSel(name); return; }
    if (sel + name === expFT[0] + expFT[1]) {
      setHist((h) => [...h, expected.m]); setSel(null); setMiss(0); setMsg(null);
    } else {
      setSel(null);
      if (miss === 0) { setMiss(1); setSlips((x) => x + 1); setMsg("Not that one — the mover is marked. Find its square yourself."); }
      else { setMiss(0); setMsg(`It was ${expected.san} — shown. Finish the line, then walk it again or retry.`); setHist((h) => [...h, expected.m]); }
    }
  };
  const startTry = () => { LEARN.markWalked(run.sig); setHist([]); setSel(null); setMiss(0); setSlips(0); setMsg(null); setMode("try"); };
  const restartWalk = () => { setWi(0); setMode("walk"); };

  const Note = ({ pl }) => (
    <div className="rounded-md p-3 flex flex-col gap-1.5" style={{ background: C.card, border: `1px solid ${C.line}`, minHeight: 64 }}>
      <div className="flex items-baseline justify-between">
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, color: pl && (wi - 1) % 2 === up ? C.gold : C.cream }}>{pl ? pl.san : "—"}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.muted }}>{wi}/{toks.length}</span>
      </div>
      {pl && pl.note ? <p style={{ fontSize: 12.5, color: C.cream, opacity: 0.9, lineHeight: 1.55, margin: 0 }}>{pl.note}</p> : null}
      {pl && pl.why ? (
        <div className="rounded p-2" style={{ background: C.goldSoft }}>
          <p style={{ fontSize: 11.5, color: C.gold, fontStyle: "italic", margin: 0 }}>{pl.why.q}</p>
          <p style={{ fontSize: 11.5, color: C.cream, opacity: 0.9, margin: "4px 0 0 0", lineHeight: 1.5 }}>{pl.why.a}</p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 px-5 pb-8">
      <div className="flex items-center justify-between">
        <Eyebrow>{run.glyph} {run.id} · {mode === "walk" ? "walk the line" : mode === "try" ? "from memory" : "the verdict"}</Eyebrow>
        <button onClick={onExit} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 13, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ fontSize: 12.5, color: C.muted }}>{run.label}</div>

      {mode === "walk" && (<>
        <Board pieces={wPieces} last={lastW} frame="goldsoft" flip={flip} />
        {!atEnd ? (<>
          <Note pl={cur} />
          <div className="flex gap-2">
            <Btn tone="ghost" onClick={() => setWi(Math.max(0, wi - 1))}>‹</Btn>
            <div className="flex-1"><Btn full onClick={() => setWi(wi + 1)}>{wi === 0 ? "Begin —" : ""} next move ›</Btn></div>
          </div>
        </>) : (<>
          <EvalBar pieces={wPieces} hist={toks} k={wi} />
          <div className="rounded-md p-4 flex flex-col gap-2" style={{ background: C.goldSoft, border: `1px solid ${C.gold}66` }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: C.gold }}>{doc.payoff.title}</div>
            <p style={{ fontSize: 13, color: C.cream, lineHeight: 1.6, margin: 0 }}>{doc.payoff.text}</p>
          </div>
          <Btn full onClick={startTry}>▶ Try it from memory</Btn>
          <Btn full tone="ghost" onClick={restartWalk}>↺ Walk it again</Btn>
        </>)}
      </>)}

      {mode === "try" && (<>
        <div className="flex items-center justify-between">
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: slips ? C.red : C.muted }}>{slips ? `${slips} slip${slips > 1 ? "s" : ""}` : "clean so far"}</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.muted }}>{Math.min(k, toks.length)}/{toks.length}</span>
        </div>
        <Board pieces={tPieces} last={hist.length ? fromTo(hist[hist.length - 1].split(",")[0]) : null} sel={sel}
          fen={toFEN(tPieces, hist, k)} flip={flip}
          marks={miss === 1 && expFT ? [expFT[0]] : []} onTap={onTap} frame={null} />
        <div className="rounded-md px-3 py-2.5 text-center" style={{ background: C.card, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: k % 2 === 0 ? C.gold : C.muted }}>
          {k >= toks.length ? "line complete…" : k % 2 === up ? "your move — from memory" : "he replies…"}
        </div>
        {msg && <p style={{ fontSize: 12, color: C.red, fontFamily: "'IBM Plex Mono', monospace", margin: 0 }}>{msg}</p>}
      </>)}

      {mode === "passed" && (<>
        <Board pieces={tPieces} last={null} frame="gold" flip={flip} />
        <div className="rounded-md p-4 flex flex-col gap-2" style={{ background: C.goldSoft, border: `1px solid ${C.gold}` }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: C.gold }}>✓ Learned.</div>
          <p style={{ fontSize: 13, color: C.cream, lineHeight: 1.6, margin: 0 }}>
            {run.id} is in your daily gauntlet from today. Learning opened the door — ownership comes from spaced recall there, and only the gauntlet writes memory.
          </p>
        </div>
        <Btn full onClick={onExit}>← Learn another line</Btn>
      </>)}

      {mode === "failed" && (<>
        <Board pieces={tPieces} last={null} frame="red" flip={flip} />
        <div className="rounded-md p-4 flex flex-col gap-2" style={{ background: C.redSoft, border: `1px solid ${C.red}88` }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: C.red }}>{slips} slip{slips > 1 ? "s" : ""} — not yet.</div>
          <p style={{ fontSize: 13, color: C.cream, lineHeight: 1.6, margin: 0 }}>A line is learned by one clean pass. Slips here cost nothing — they never touch your memory record.</p>
        </div>
        <Btn full onClick={startTry}>⟳ Try again</Btn>
        <Btn full tone="ghost" onClick={restartWalk}>↺ Walk it again</Btn>
        <Btn full tone="ghost" onClick={onExit}>← Back to the list</Btn>
      </>)}
    </div>
  );
}

function LearnPage({ onOpenPack }) {
  const [, bump] = useState(0);
  useEffect(() => { LEARN.load(); return LEARN.subscribe(() => bump((x) => x + 1)); }, []);
  const [, bumpG] = useState(0);
  useEffect(() => { GAMESTATS.load(); return GAMESTATS.subscribe(() => bumpG((x) => x + 1)); }, []);
  const [mem, setMem] = useState({});
  useEffect(() => { (async () => { try { const m = STORE && (await STORE.get(GKEY3)); if (m && m.value) setMem(JSON.parse(m.value).mem || {}); } catch (e) {} })(); }, []);
  const [study, setStudy] = useState(null);
  const clusters = useMemo(() => buildClusters(PACKS, FULL_TREE, FULL_TREE_B, CORE_PACK_IDS, LEARNABLE_PACK_IDS, BLACK_PACK_IDS), []);
  if (study) return <LineStudy key={study.sig} run={study} onExit={() => setStudy(null)} />;

  const GS = GAMESTATS.res();
  const ls = LEARN.state();
  const now = Date.now();
  const next = learnNext(ALL_RUNS, ls, GS && GS.runProb)[0];
  const learnedN = ALL_RUNS.filter((r) => ls.learned[r.sig]).length;
  const groups = [...new Set(clusters.white.map((c) => c.group))];

  return (
    <div className="flex flex-col gap-4 px-5 pb-8">
      <Eyebrow>📖 Learn — the tree, one line at a time</Eyebrow>
      <p style={{ fontSize: 13.5, color: C.cream, lineHeight: 1.6, margin: 0 }}>
        Every line is numbered like the gauntlet. Walk it with its story, see why the end position is your +1, then play it once from memory — clean pass and it joins today’s practice. {learnedN}/{ALL_RUNS.length} learned.
      </p>
      {next && (
        <button onClick={() => setStudy(next)} className="rounded-md px-4 py-3 text-left"
          style={{ background: C.goldSoft, border: `1px solid ${C.gold}66`, color: C.gold, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
          ▶ Next: {next.id} — {next.label}
          {GS && GS.runProb[next.sig] ? <span style={{ fontWeight: 400, color: C.muted }}> · ≈{(100 * GS.runProb[next.sig]).toFixed(1)}% of your games</span> : null}
        </button>
      )}
      {(() => {
        const Cluster = ({ cl, story }) => {
          const done = cl.runs.filter((r) => ls.learned[r.sig]).length;
          return (
            <div className="rounded-md p-3 flex flex-col gap-1.5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="flex items-baseline justify-between">
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.cream }}>{cl.chip}</span>
                <span className="flex items-baseline gap-2">
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: done === cl.runs.length ? C.gold : C.muted }}>{done}/{cl.runs.length}</span>
                  {story && <button onClick={() => onOpenPack(cl.id)} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 10.5, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>story ↗</button>}
                </span>
              </div>
              {cl.runs.map((r) => {
                const st = runStatus(r, ls, mem, retrievability, owned, now);
                const glyph = st.learned ? "✓" : st.walked ? "◐" : "○";
                return (
                  <button key={r.sig} onClick={() => setStudy(r)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left w-full"
                    style={{ background: "transparent", border: `1px solid ${st.learned ? C.gold + "33" : C.line}`, cursor: "pointer" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: st.learned ? C.gold : C.muted, width: 14 }}>{glyph}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.gold, whiteSpace: "nowrap" }}>{r.id}</span>
                    <span className="flex-1" style={{ fontSize: 12, color: C.cream, opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                    {st.learned && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: st.ownedN === st.total ? C.gold : C.muted }}>✦{st.ownedN}/{st.total}</span>}
                  </button>
                );
              })}
            </div>
          );
        };
        return (<>
          {groups.map((grp) => (
            <div key={grp} className="flex flex-col gap-2">
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.14em", color: C.gold, opacity: 0.9 }}>♔ WHITE · {grp.toUpperCase()}</div>
              {clusters.white.filter((c) => c.group === grp).map((cl) => <Cluster key={cl.id} cl={cl} story />)}
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.14em", color: C.cream, opacity: 0.9 }}>♚ BLACK · YOUR DEFENSES</div>
            {clusters.black.map((cl) => <Cluster key={cl.id} cl={cl} />)}
          </div>
        </>);
      })()}
    </div>
  );
}

/* ============ MY GAMES — coverage, leaks, and what to learn, from real chess.com games ============ */
function GamesPanel({ onExit }) {
  const [user, setUser] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mem, setMem] = useState({});
  const [, bump] = useState(0);
  useEffect(() => { GAMESTATS.load(); return GAMESTATS.subscribe(() => bump((x) => x + 1)); }, []);
  const [, bumpL] = useState(0);
  useEffect(() => { LEARN.load(); return LEARN.subscribe(() => bumpL((x) => x + 1)); }, []);
  useEffect(() => {
    (async () => {
      try { const u = STORE && (await STORE.get(CCUSER)); if (u && u.value) setUser(u.value); } catch (e) {}
      try { const m = STORE && (await STORE.get(GKEY3)); if (m && m.value) setMem(JSON.parse(m.value).mem || {}); } catch (e) {}
    })();
  }, []);

  const res = GAMESTATS.res();

  const fetchGames = async () => {
    const u = user.trim().toLowerCase();
    if (!u) { setStatus("enter your chess.com username first"); return; }
    setBusy(true);
    try {
      try { if (STORE) await STORE.set(CCUSER, u); } catch (e) {}
      setStatus("fetching archive list…");
      const ar = await (await fetch(`https://api.chess.com/pub/player/${u}/games/archives`)).json();
      const months = ar.archives || [];
      if (!months.length) { setStatus("no games found for that username"); setBusy(false); return; }
      let cache = {};
      try { const c = STORE && (await STORE.get(CCCACHE)); if (c && c.value) cache = JSON.parse(c.value); } catch (e) {}
      if (cache.user !== u) cache = { user: u, months: {} };
      const cur = months[months.length - 1];
      const out = [];
      for (let i = 0; i < months.length; i++) {
        const url = months[i];
        const mk = url.slice(-7).replace("/", "-");
        let recs = cache.months[mk];
        if (!recs || url === cur) {
          setStatus(`fetching ${mk} (${i + 1}/${months.length})…`);
          const d = await (await fetch(url)).json();
          recs = (d.games || [])
            .filter((g) => g.time_class === "rapid" && g.rules === "chess" && g.pgn)
            .map((g) => ({ w: g.white.username.toLowerCase() === u ? 1 : 0, s: sanList(g.pgn).slice(0, 44),
              r: g.white.username.toLowerCase() === u ? g.white.result : g.black.result, t: g.end_time, url: g.url }));
          cache.months[mk] = recs;
        }
        out.push(...recs);
      }
      try { if (STORE) await STORE.set(CCCACHE, JSON.stringify(cache)); } catch (e) {}
      GAMESTATS.setGames(out);
      setStatus(null);
    } catch (e) { setStatus("fetch failed — check the username and your connection"); }
    setBusy(false);
  };

  const moveNoOf = (ply) => Math.floor(ply / 2) + 1;
  const learnQueue = res ? learnNext(ALL_RUNS, LEARN.state(), res.runProb).slice(0, 3) : [];
  const Card = ({ title, children }) => (
    <div className="rounded-md p-4 flex flex-col gap-2" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.12em", color: C.muted }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 px-5 pb-8">
      <Eyebrow>{"♟"} My games — the tree vs reality</Eyebrow>
      <div className="flex gap-2">
        <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="chess.com username"
          style={{ flex: 1, background: C.card, color: C.cream, border: `1px solid ${C.line}`, borderRadius: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, padding: "10px 12px" }} />
        <button onClick={fetchGames} disabled={busy}
          style={{ background: C.goldSoft, border: `1px solid ${C.gold}66`, color: C.gold, borderRadius: 8, padding: "0 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
          {busy ? "…" : res ? "Refresh" : "Analyze"}
        </button>
      </div>
      {status && <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.muted, margin: 0 }}>{status}</p>}
      {res && (<>
        <Card title={`GOAL · last 30 days`}>
          <div className="flex items-baseline gap-3">
            <span style={{ fontFamily: "'Fraunces', serif", fontSize: 34, color: (res.recentWhiteScore || 0) >= 80 ? C.gold : C.cream, lineHeight: 1 }}>{res.recentWhiteScore == null ? "—" : res.recentWhiteScore + "%"}</span>
            <span style={{ fontSize: 12, color: C.muted }}>as White ({res.recentWhiteN || 0} games) → converge on 80%. Black: <b style={{ color: C.cream }}>{res.recentBlackScore == null ? "—" : res.recentBlackScore + "%"}</b> ({res.recentBlackN || 0}). The mechanism: a +1 you understand out of every opening, then the game is yours to take.</span>
          </div>
        </Card>
        <Card title={`COVERAGE · from ${res.w.totals.e4} rapid games as White`}>
          <div className="flex items-baseline gap-3">
            <span style={{ fontFamily: "'Fraunces', serif", fontSize: 40, color: C.gold, lineHeight: 1 }}>{Math.round(100 * res.w.coverage)}%</span>
            <span style={{ fontSize: 12, color: C.cream, opacity: 0.85, lineHeight: 1.45 }}>of your 1.e4 games stay inside the tree through your first six moves — the zone where the +1 gets banked.</span>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: C.muted }}>
            by depth: move 3 · {Math.round(100 * res.w.coverageCurve[6])}% — move 4 · {Math.round(100 * res.w.coverageCurve[8])}% — move 5 · {Math.round(100 * res.w.coverageCurve[10])}% — full line · {(100 * res.w.coverageCurve.full).toFixed(1)}%
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: C.muted }}>
            endings observed: {res.w.totals.done} full line · {res.w.totals.opp} opponent left · {res.w.totals.user} you left first
          </div>
          {learnQueue.length > 0 && (
            <div className="flex flex-col gap-1 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
              {learnQueue.map((r) => (
                <div key={r.sig} style={{ fontSize: 12.5, color: C.gold }}>
                  📖 learn next: <b>{r.id}</b> — ≈{(100 * (res.runProb[r.sig] || 0)).toFixed(1)}% of your games
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={`AS BLACK · from ${res.b.totals.mine} rapid games`}>
          <div className="flex items-baseline gap-3">
            <span style={{ fontFamily: "'Fraunces', serif", fontSize: 30, color: C.cream, lineHeight: 1 }}>{Math.round(100 * res.b.coverageCurve[6])}%</span>
            <span style={{ fontSize: 12, color: C.cream, opacity: 0.85 }}>of games follow your Black book through move 3 (move 6: {Math.round(100 * res.b.coverage)}%). Top gaps: {res.b.leaks.slice(0, 3).map((L) => L.move + "×" + L.n).join(", ")}.</span>
          </div>
        </Card>
        <Card title="TOP LEAKS · where opponents leave your tree (White games)">
          {res.w.leaks.slice(0, 8).map((L, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2" style={{ fontSize: 12.5 }}>
              <span style={{ color: C.cream }}>{moveNoOf(L.ply)}… <b>{L.move}</b></span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: L.score != null && L.score < 45 ? C.red : C.muted, whiteSpace: "nowrap" }}>
                {L.n}× · you score {L.score == null ? "—" : L.score + "%"}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.muted, opacity: 0.8 }}>ranked by frequency × score deficit. Uncovered branches you keep meeting are candidates for new lines — they arrive as briefs, not improvisations.</div>
        </Card>
        <Card title="YOUR MISSES · tree positions where you left book first">
          {res.w.misses.length === 0 && <div style={{ fontSize: 12.5, color: C.cream }}>None — every deviation was your opponent’s.</div>}
          {res.w.misses.slice(0, 8).map((m, i) => {
            const rec = mem[m.key];
            const R = retrievability(rec, Date.now());
            const played = Object.entries(m.plays).sort((a, b) => b[1] - a[1]).map(([mv, n2]) => `${mv}×${n2}`).join(" ");
            return (
              <div key={i} className="flex items-baseline justify-between gap-2" style={{ fontSize: 12.5 }}>
                <span style={{ color: C.cream }}>move {moveNoOf(m.ply)}: expected <b style={{ color: C.gold }}>{m.expected}</b> — played {played}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: m.recent ? C.red : C.muted, whiteSpace: "nowrap" }}>
                  {m.n}×{m.recent ? ` · ${m.recent} recent` : ""} · {rec ? `R ${R.toFixed(2)}` : "untrained"}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize: 10.5, color: C.muted, opacity: 0.8 }}>
            “recent” = last 30 days. Old misses are pre-training habit; a recent miss on trained ground is the flag — its runs are ranked for you on the Practice page.
          </div>
        </Card>
        <Card title="RESULTS BY BUCKET">
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: C.cream, lineHeight: 1.8 }}>
            line completed: {res.w.totals.done} games · score {res.w.scores.done == null ? "—" : res.w.scores.done + "%"}<br />
            opponent left tree: {res.w.totals.opp} · score {res.w.scores.opp == null ? "—" : res.w.scores.opp + "%"}<br />
            you left first: {res.w.totals.user} · score {res.w.scores.user == null ? "—" : res.w.scores.user + "%"}
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, opacity: 0.8 }}>the value proposition, measured: the gap between “in book” and “you left first” is what the tree is worth per game.</div>
        </Card>
      </>)}
      {!res && !busy && (
        <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
          Fetches your public chess.com rapid games (straight from your device — nothing leaves it except the chess.com request), walks every 1.e4 game against your tree, and reports coverage by depth, the leaks, what to learn next, and where you left book first.
        </p>
      )}
      <Btn full tone="ghost" onClick={onExit}>{"←"} Back</Btn>
    </div>
  );
}

export default function LinesMock() {
  const [view, setView] = useState("learn");
  const [packId, setPackId] = useState("mieses");
  const [fam, setFam] = useState("scotch");
  const [tab, setTab] = useState("end");
  const pack = PACKS.find((p) => p.id === packId);
  const family = FAMILIES.find((f) => f.id === fam);
  const famPacks = PACKS.filter((p) => p.family === fam && p.side !== "black");
  const switchPack = (id) => {
    const t = PACKS.find((p) => p.id === id);
    if (!t) return;
    setPackId(id); setFam(t.family); setTab("end");
  };
  const TABS = [
    { id: "end", label: "The End" },
    { id: "learn", label: "Learn" },
    { id: "edge", label: "Edge cases" },
  ];
  return (
    <div style={{ background: C.ink, minHeight: "100vh", color: C.cream }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=IBM+Plex+Mono:wght@400;500&display=swap');
        body{margin:0} *{box-sizing:border-box}`}</style>
      <div className="mx-auto flex flex-col" style={{ maxWidth: 460, minHeight: "100vh" }}>
        <header className="px-5 pt-5 pb-3 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <div style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 22 }}>lines</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.muted, letterSpacing: "0.08em" }}>{view === "daily" ? "⚡ PRACTICE" : view === "games" ? "♟ MY GAMES" : view === "learn" ? "📖 LEARN" : pack.badge}</div>
          </div>
          <div className="flex rounded-md" style={{ background: C.card, border: `1px solid ${C.line}`, overflow: "hidden" }}>
            {[["learn", "📖 Learn"], ["daily", "⚡ Practice"], ["games", "♟ Games"]].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)} className="flex-1 py-2.5"
                style={{
                  background: view === id || (id === "learn" && view === "packs") ? C.goldSoft : "transparent",
                  color: view === id || (id === "learn" && view === "packs") ? C.gold : C.muted,
                  border: "none", fontSize: 13, fontWeight: view === id ? 700 : 500, cursor: "pointer",
                }}>
                {label}
              </button>
            ))}
          </div>
          {view === "packs" && (<>
          <div className="flex flex-col gap-1">
            {[true, false].map((rep) => (
              <div key={String(rep)} className="flex gap-2 overflow-x-auto items-center" style={{ scrollbarWidth: "none" }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.14em", color: rep ? C.gold : C.red, opacity: 0.9, flexShrink: 0, width: 74 }}>
                  {rep ? "REPERTOIRE" : "⚔ ARSENAL"}
                </span>
                {FAMILIES.filter((f) => f.rep === rep).map((f) => (
                  <button key={f.id}
                    onClick={() => {
                      const first = PACKS.find((p) => p.family === f.id);
                      setFam(f.id); if (first) setPackId(first.id); setTab("end");
                    }}
                    className="px-2.5 py-1 whitespace-nowrap"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, letterSpacing: "0.04em",
                      fontWeight: f.id === fam ? 700 : 400,
                      background: "transparent",
                      color: f.id === fam ? C.cream : C.muted,
                      borderBottom: `2px solid ${f.id === fam ? (rep ? C.gold : C.red) : "transparent"}`,
                      borderTop: "none", borderLeft: "none", borderRight: "none", borderRadius: 0,
                    }}>
                    {f.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {famPacks.map((p) => (
              <button key={p.id}
                onClick={() => { setPackId(p.id); setTab("end"); }}
                className="px-3 py-1.5 rounded-full whitespace-nowrap"
                style={{
                  fontSize: 12.5, fontWeight: p.id === packId ? 700 : 400,
                  background: p.id === packId ? C.gold : C.card,
                  color: p.id === packId ? "#1C150E" : C.muted,
                  border: `1px solid ${p.id === packId ? C.gold : C.line}`,
                }}>
                {p.chip}
              </button>
            ))}
          </div>
          {family && family.blurb ? (
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, margin: 0 }}>{family.blurb}</p>
          ) : null}
          </>)}
        </header>
        <main className="flex-1 pb-28 pt-2" style={{ paddingLeft: view === "packs" ? 20 : 0, paddingRight: view === "packs" ? 20 : 0 }}>
          {view === "learn" && <LearnPage onOpenPack={(id) => { switchPack(id); setView("packs"); }} />}
          {view === "daily" && <Gauntlet onExit={() => setView("learn")} onLearn={() => setView("learn")} />}
          {view === "games" && <GamesPanel onExit={() => setView("learn")} />}
          {view === "packs" && tab === "end" && <EndScreen key={packId} pack={pack} go={setTab} switchPack={switchPack} />}
          {view === "packs" && tab === "learn" && <LearnFlow key={packId} pack={pack} go={setTab} switchPack={switchPack} />}
          {view === "packs" && tab === "edge" && <EdgeCases key={packId} pack={pack} go={setTab} switchPack={switchPack} />}
          <p className="pt-6" style={{ fontSize: 11, color: C.muted, opacity: 0.7 }}>
            UX prototype {APP_VER} — lines SEE-audited · evals: real on-device search · Stockfish auto-engages outside this sandbox.
          </p>
        </main>
        {view === "packs" && (
        <nav className="fixed bottom-0 left-0 right-0" style={{ background: C.surface, borderTop: `1px solid ${C.line}` }}>
          <div className="mx-auto flex" style={{ maxWidth: 460 }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 py-4"
                style={{
                  color: tab === t.id ? (t.id === "danger" ? C.red : C.gold) : C.muted,
                  fontSize: 12.5, letterSpacing: "0.04em", fontWeight: tab === t.id ? 700 : 400,
                  borderTop: tab === t.id ? `2px solid ${t.id === "danger" ? C.red : C.gold}` : "2px solid transparent",
                }}>
                {t.id === "danger" ? "↯ " : ""}{t.label}
              </button>
            ))}
          </div>
        </nav>
        )}
      </div>
    </div>
  );
}

/* ---------- test exports (tools/*.mjs) — export-only edit, no behavior change ---------- */
export { engineCore, sqName, PACKS, EXTRAS, REP, REPX, RUNS, START, sq, posKey, applyMoves, toFEN, APP_VER, CONF, dayInfo, daySeedOrder, buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, BLACK_PACK_IDS };
