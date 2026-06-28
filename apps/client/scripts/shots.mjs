// Capture real screenshots of the seeded "snip" app for the visual guide.
//   node scripts/shots.mjs            (expects the app at SHOT_BASE, default :3001)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const PROJECT = process.env.SHOT_PROJECT ?? "snip";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/screenshots");
mkdirSync(OUT, { recursive: true });

// route, filename, a selector to wait for, optional pre-action
const SHOTS = [
  ["/overview", "overview", '[data-testid="ov-hero"]'],
  ["/backlog", "backlog", ".backlog-grid"],
  ["/brain", "brain", ".brain-explorer"],
  ["/graph-issues", "graph-issues", '[data-testid="gi-issues"]'],
  ["/decisions", "decisions", ".decisions-list"],
  ["/orchestrator", "orchestrator", '[data-testid="orch-table"]'],
  ["/sprints", "sprints", '[data-testid="sprint-hero"]'],
  ["/gate", "gate", '[data-testid="gate-conflict"]'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
// Force the active project to the seeded app before any page script runs.
await page.addInitScript((p) => {
  try { window.localStorage.setItem("spade.projectId", p); } catch {}
}, PROJECT);

for (const [route, name, sel] of SHOTS) {
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 90000 });
    if (sel) await page.waitForSelector(sel, { timeout: 30000 }).catch(() => {});
    await sleep(1600); // let data + animations settle
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`✓ ${name}  (${route})`);
  } catch (e) {
    console.log(`✗ ${name}  (${route})  — ${String(e).split("\n")[0]}`);
  }
}

await browser.close();
console.log(`\nScreenshots → ${OUT}`);
