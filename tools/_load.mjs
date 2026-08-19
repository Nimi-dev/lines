// Shared loader: bundles src/app.jsx (JSX → JS, react inlined) so the
// verification tools can import the app's real data and engine in Node.
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "tools", ".build");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "app.bundle.mjs");

export async function loadApp() {
  await build({
    entryPoints: [join(root, "src", "app.jsx")],
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href + "?t=" + Date.now());
}
