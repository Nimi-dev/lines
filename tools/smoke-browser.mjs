// Browser smoke test (LOCAL ONLY — not part of npm test / CI).
// Requires: Chrome installed (or CHROME_PATH set), `npm i`, and a fresh `npm run build`.
// Walks the v6.4 loop end to end: Learn page → walk MIE·F1 with its story →
// clean try from memory → line enters the Practice gauntlet → play its first
// move there → Games page renders. Usage: npm run test:ui
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
await page.setViewport({ width: 400, height: 850 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

const clickByText = async (txt) => {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent.includes(t));
    if (el) { el.click(); return true; }
    return false;
  }, txt);
  assert.ok(ok, `no button containing "${txt}"`);
  await new Promise((r) => setTimeout(r, 320));
};
const hasText = async (txt) => page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), txt);
const step = (name, cond) => { assert.ok(cond, "FAILED: " + name); console.log("  ok " + name); };
const tapSquare = async (name) => {
  const done = await page.evaluate((n) => {
    const file = n.charCodeAt(0) - 97, rank = +n[1] - 1;
    const grid = document.querySelector(".grid-cols-8");
    if (!grid) return false;
    [...grid.children][(7 - rank) * 8 + file].click();
    return true;
  }, name);
  assert.ok(done, "no board grid");
  await new Promise((r) => setTimeout(r, 220));
};

await page.goto("http://localhost:4189/", { waitUntil: "networkidle0" });
step("app renders", await hasText("lines"));
step("footer stamps v6.4·git", await hasText("v6.4·git"));
step("Learn is the default page", await hasText("one line at a time"));
step("learned counter starts 0/22", await hasText("0/22 learned"));
step("Black section placeholder", await hasText("No Black lines yet"));

// Practice before anything is learned → empty-state gate
await clickByText("⚡ Practice");
await new Promise((r) => setTimeout(r, 500));
step("practice empty state", await hasText("Nothing in the gauntlet yet"));
await clickByText("Go learn your first line");
await new Promise((r) => setTimeout(r, 400));
step("gate navigates back to Learn", await hasText("one line at a time"));

// walk MIE·F1 with its story
await clickByText("MIE·F1");
await new Promise((r) => setTimeout(r, 400));
step("walk view opens", await hasText("walk the line"));
step("board renders", await page.evaluate(() => document.querySelectorAll('img[src^="/pieces/"]').length === 32));
let guard = 0;
while (!(await hasText("Try it from memory")) && guard++ < 30) await clickByText("next move");
step("walk reaches the payoff", await hasText("Try it from memory"));
step("payoff explains the +1", await hasText("Nursing an edge looks exactly like this"));

// clean try: MIE·F1's eleven White moves from memory
await clickByText("Try it from memory");
await new Promise((r) => setTimeout(r, 400));
step("try view opens", await hasText("from memory"));
const MOVES = [["e2","e4"],["g1","f3"],["d2","d4"],["f3","d4"],["d4","c6"],["e4","e5"],["d1","e2"],["c2","c4"],["b2","b3"],["c1","b2"],["b1","d2"]];
for (const [f, t] of MOVES) {
  await tapSquare(f); await tapSquare(t);
  await new Promise((r) => setTimeout(r, 750)); // opponent reply
}
await new Promise((r) => setTimeout(r, 900));
step("clean try marks the line learned", await hasText("✓ Learned"));
await clickByText("Learn another line");
await new Promise((r) => setTimeout(r, 400));
step("learned counter now 1/22", await hasText("1/22 learned"));

// the learned line is in today's practice session
await clickByText("⚡ Practice");
await new Promise((r) => setTimeout(r, 600));
step("gauntlet session holds 1 run", await hasText("0/1"));
step("play button targets MIE·F1", await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Play MIE·F1"))));
await clickByText("Play MIE·F1");
await new Promise((r) => setTimeout(r, 700));
step("gauntlet run opens", await hasText("from memory"));
await tapSquare("e2"); await tapSquare("e4");
await new Promise((r) => setTimeout(r, 900));
step("gauntlet accepts the move", await hasText("clean"));
await clickByText("☰ Session");
await new Promise((r) => setTimeout(r, 400));

// games page
await clickByText("♟ Games");
await new Promise((r) => setTimeout(r, 400));
step("games page renders", await hasText("walks every 1.e4 game"));

if (errors.length) console.log("PAGE ERRORS:", errors.slice(0, 5));
assert.equal(errors.filter((e) => !e.includes("favicon")).length, 0, "page errors logged");
await browser.close();
server.kill();
console.log("smoke: v6.4 learn→try→practice loop passed end to end, no page errors.");
