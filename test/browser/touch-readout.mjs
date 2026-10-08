// Browser check, run by hand against a running dev server (not part of `npm test`, which
// needs no browser or network):
//
//   npx vite --port 5444 --strictPort &
//   PW_PATH=/path/to/node_modules/playwright node test/browser/touch-readout.mjs \
//     http://127.0.0.1:5444/ "ff&ff.p=30,attempts&att.p=30,reports,trends,company"
//
// On a 390px touch phone it taps one column part-way along the first column chart of each
// tab, ONCE on a fresh page, and asserts the pinned readout names that column: the same
// readout a second tap gives, and — on the manual-entry tabs — the day chip the tap set.
// A chart with Recharts' accessibility layer used to read out the FIRST slot on the first
// tap (the tap focused the chart; its focus handler moved the readout to slot 0). The
// static guard is test/chart-pointer-focus.test.mjs.
//
// Read-only: it only taps chart columns (which set a chip in the URL hash). It reads the
// app's live data, so it never clicks anything that writes.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5444/";
const cases = (process.argv[3] || "ff&ff.p=30,attempts&att.p=30,reports,trends,company").split(",");
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,localhost,127.0.0.1" } : undefined;
// The full Chromium ("chromium" channel): in the bare headless shell a tap showed no readout.
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chromium", proxy, args: (process.env.PW_ARGS || "").split(" ").filter(Boolean) });
let bad = 0;
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`${base}#tab=${c}`, { waitUntil: "load", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(+(process.env.WAIT_MS || 9000));
  const svg = page.locator(".sc-plot svg.recharts-surface").first();
  if (!(await svg.count())) {
    console.log(JSON.stringify({ c, skip: "no column chart" }));
    await ctx.close();
    continue;
  }
  await svg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const bars = await page.evaluate(() => {
    const s = document.querySelector(".sc-plot svg.recharts-surface");
    return [...s.querySelectorAll(".recharts-bar-rectangle path, .recharts-bar-rectangle rect")]
      .map((p) => {
        const b = p.getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height - 3), h: b.height };
      })
      .filter((b) => b.h > 3);
  });
  const xs = [...new Set(bars.map((b) => b.x))].sort((a, b) => a - b);
  if (xs.length < 3) {
    console.log(JSON.stringify({ c, skip: "too few columns" }));
    await ctx.close();
    continue;
  }
  const pick = bars.find((b) => b.x === xs[Math.floor(xs.length * 0.6)]);
  const readout = () => page.evaluate(() => document.querySelector(".ct")?.innerText.replace(/\n/g, " | ") || null);
  const chip = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll("button")]
          .map((e) => e.innerText || "")
          .filter((t) => /[✕×]/.test(t))
          .map((t) => t.replace(/\s*[✕×]\s*/g, "").trim())
          .filter(Boolean)[0] || null,
    );
  await page.touchscreen.tap(pick.x, pick.y);
  await page.waitForTimeout(700);
  const first = await readout();
  const chipText = await chip();
  await page.touchscreen.tap(pick.x, pick.y);
  await page.waitForTimeout(700);
  if (chipText && !(await chip())) {
    await page.touchscreen.tap(pick.x, pick.y);
    await page.waitForTimeout(700);
  }
  const second = await readout();
  const head = (s) => (s || "").split(/ \| | · /)[0];
  const ok = !!first && head(first) === head(second) && (!chipText || head(first).includes(chipText));
  if (!ok) bad++;
  console.log(JSON.stringify({ c, columns: xs.length, first, second, chip: chipText, ok }));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
