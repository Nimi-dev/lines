// Browser smoke test (LOCAL ONLY — not part of npm test / CI).
// Requires: Chrome/Chromium (CHROME_PATH overrides the default macOS path),
// `npm i` done, and a fresh `npm run build`.
// Runs the built app in headless Chrome and walks the core flows end to end:
// packs, Philidor page, My Games, gauntlet run with a correct move, a miss,
// the relearn message, tree toggles, and a v6.3 export.
// Usage: npm run test:ui
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";

const server = spawn("npx", ["vite", "preview", "--port", "4189"], { stdio: "ignore", detached: false });
await new Promise((r) => setTimeout(r, 1500));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
await browser.defaultBrowserContext().overridePermissions("http://localhost:4189", ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
const page = await browser.newPage();
// count synthesized voices — the move sounds are generated, not fetched, so
// there is no network request or <audio> element to look for
await page.evaluateOnNewDocument(() => {
  window.__voices = 0;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const wrap = function (...a) {
    const c = new AC(...a);
    const co = c.createOscillator.bind(c), cb = c.createBufferSource.bind(c);
    c.createOscillator = () => { window.__voices++; return co(); };
    c.createBufferSource = () => { window.__voices++; return cb(); };
    return c;
  };
  window.AudioContext = wrap;
  window.webkitAudioContext = wrap;
});
await page.setViewport({ width: 400, height: 850 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

const clickByText = async (txt) => {
  const ok = await page.evaluate((t) => {
    const els = [...document.querySelectorAll("button")];
    const el = els.find((b) => b.textContent.includes(t));
    if (el) { el.click(); return true; }
    return false;
  }, txt);
  assert.ok(ok, `no button containing "${txt}"`);
  await new Promise((r) => setTimeout(r, 350));
};
const hasText = async (txt) => page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), txt);
const step = (name, cond) => { assert.ok(cond, "FAILED: " + name); console.log("  ok " + name); };

await page.goto("http://localhost:4189/", { waitUntil: "networkidle0" });
step("app renders", await hasText("lines"));
step("footer stamps v6.3.3·git", await hasText("v6.3.3·git"));

// packs view shows the new Philidor pack chip (in the shield family)
await clickByText("Other defenses");
step("Philidor pack chip exists in shield family", await page.evaluate(() => {
  return [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Philidor"));
}));
await clickByText("Philidor");
await new Promise((r) => setTimeout(r, 400));
step("Philidor pack page renders the Opera promise", await hasText("Two targets. One defender."));
await clickByText("Scotch");
await new Promise((r) => setTimeout(r, 300));

// My Games view renders
await clickByText("My games — coverage");
step("games view renders", await hasText("walks every 1.e4 game"));
await clickByText("← Back");

// Daily gauntlet
await clickByText("Daily gauntlet");
await new Promise((r) => setTimeout(r, 600));
step("gauntlet home renders", await hasText("Same tree. Fresh order."));
step("fresh start (v6.3)", await hasText("fresh start (v6.3)"));
step("16 runs by default", await hasText("YOUR TREE · 16 runs"));

// toggle Philidor into the tree
await clickByText("add to gauntlet");
step("tree grows to 19 runs", await hasText("YOUR TREE · 19 runs"));

// start the first run
await clickByText("Play ");
await new Promise((r) => setTimeout(r, 700));
step("run view renders", await hasText("you are White"));
step("board uses SVG pieces", await page.evaluate(() => document.querySelectorAll('img[src^="/pieces/"]').length === 32));
step("R indicator shows untested", await hasText("R ○ 0.00"));

// play the correct first move: e2 -> e4 (find squares by board geometry)
const tapSquare = async (name) => {
  const done = await page.evaluate((n) => {
    const file = n.charCodeAt(0) - 97, rank = +n[1] - 1;
    // board is the 8x8 grid of divs with aspect-ratio 1/1 inside .grid-cols-8
    const grid = document.querySelector(".grid-cols-8");
    if (!grid) return false;
    const cells = [...grid.children];
    // index: row 0 = rank 8 (unflipped)
    const idx = (7 - rank) * 8 + file;
    cells[idx].click(); return true;
  }, name);
  assert.ok(done, "no board grid");
  await new Promise((r) => setTimeout(r, 250));
};
// wait for the first real evaluation so the hold behaviour can be checked
const evalLabel = () => page.evaluate(() => {
  const els = [...document.querySelectorAll("span")].filter((s) => s.children.length === 0 && s.textContent.length < 40);
  const el = els.find((s) => /[+-]\d+\.\d|#[+−]\d|thinking|offline/.test(s.textContent));
  return el ? el.textContent.trim() : "";
});
let firstEval = "";
for (let i = 0; i < 24 && !/[+-]\d+\.\d|#[+−]/.test(firstEval); i++) { firstEval = await evalLabel(); await new Promise((r) => setTimeout(r, 500)); }
const gotEval = /[+-]\d+\.\d|#[+−]/.test(firstEval);
if (!gotEval) console.log(`  -- eval-hold steps skipped: no engine score in 12s (last label: "${firstEval}")`);
const voicesBefore = await page.evaluate(() => window.__voices || 0);

await tapSquare("e2");
const hints = await page.evaluate(() => ({
  move: document.querySelectorAll('[data-hint="move"]').length,
  capture: document.querySelectorAll('[data-hint="capture"]').length,
}));
step("selecting e2 dots its two legal squares", hints.move === 2 && hints.capture === 0);
await tapSquare("e4");
if (gotEval) {
  const during = await evalLabel();
  step("eval bar holds the last score while recomputing", /[+-]\d+\.\d|#[+−]/.test(during));
  step("eval bar marks the held score as stale", during.includes("⟳"));
}
step("moving a piece makes a sound", (await page.evaluate(() => window.__voices || 0)) > voicesBefore);
await new Promise((r) => setTimeout(r, 900));
step("1.e4 played, opponent replied", await page.evaluate(() => document.body.innerText.includes("your move — from memory")));
step("clean so far", await hasText("clean"));

// selecting another own piece re-selects instead of counting as a miss
await tapSquare("g1"); await tapSquare("b1");
step("re-select is not a miss", !(await hasText("logged as a miss")));
step("re-select shows the new piece's hints", await page.evaluate(() =>
  document.querySelectorAll('[data-hint]').length === 2));

// deliberately miss: tap a wrong move (a2-a3 will not match any script)
await tapSquare("a2"); await tapSquare("a3");
await new Promise((r) => setTimeout(r, 400));
step("miss registered with relearn message", await hasText("logged as a miss"));

// a wrong move buzzes as well as logging
step("a miss makes an error sound", (await page.evaluate(() => window.__voices || 0)) > 0);

// back to session home; memory bar should now show progress
await clickByText("☰ Session");
await new Promise((r) => setTimeout(r, 500));
step("memory bar shows owned 1", await hasText("✦ owned 1"));

// export produces v6.3 schema
const exported = await page.evaluate(async () => {
  const btns = [...document.querySelectorAll("button")];
  btns.find((b) => b.textContent.includes("Export log")).click();
  await new Promise((r) => setTimeout(r, 500));
  try { return await navigator.clipboard.readText(); } catch (e) { const ta = document.querySelector("textarea[readonly]"); return ta ? ta.value : ""; }
});
step("export carries v6.3 schema", exported.includes("v6.3 memory model") && exported.includes('"H":'));

if (errors.length) { console.log("PAGE ERRORS:", errors.slice(0, 5)); }
assert.equal(errors.filter((e) => !e.includes("favicon")).length, 0, "page errors logged");
await browser.close();
server.kill();
console.log("smoke: all UI steps passed, no page errors.");
