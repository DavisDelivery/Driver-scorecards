import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// A Recharts chart with `accessibilityLayer` takes focus on mousedown — a tap's emulated
// one included — and its focus handler moves the readout to the FIRST slot. On a phone the
// first tap on a column then read out slot 0 ("Wed, Sep 9 · 1") while the column tapped was
// highlighted and its day chip set. Every such chart's wrapper must stop a pointer from
// focusing it (keyboard focus by Tab still works); this holds every chart to that guard.
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../src");

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(jsx?|tsx?)$/.test(e.name) ? [p] : [];
  });
}

test("every accessibility-layer chart stops a pointer from focusing it", () => {
  const charts = sources(ROOT).filter((f) => /\baccessibilityLayer\b/.test(fs.readFileSync(f, "utf8")));
  assert.ok(charts.length >= 2, "StackedColumns and YearLines use the accessibility layer");
  for (const f of charts) {
    const src = fs.readFileSync(f, "utf8");
    assert.match(
      src,
      /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/,
      `${path.relative(ROOT, f)}: a chart with accessibilityLayer needs onMouseDown preventDefault on its wrapper`,
    );
  }
});
