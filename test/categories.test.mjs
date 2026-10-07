// Guards the one category vocabulary.
//
// Six copies of the category list had drifted apart: Forgotten Freight was #fb923c on
// the charts and #f97316 on its own tab and in print, Late was a yellow on screen and
// an amber in the PDF, and Attempts printed gray. categories.js is now the only place a
// category gets its label, polarity or colour, and these tests keep it that way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORIES,
  FAILURES,
  ATTEMPTS,
  CREDIT,
  EXCLUDED,
  COUNTED8,
  CHARTED6,
  catColor,
  catLabel,
  catPolarity,
  catRgb,
  categoriesFor,
} from "../src/data/categories.js";
import { INCIDENT_CATEGORIES } from "../src/data/drivers.js";
import { ANALYTICS_CATEGORIES, ANALYTICS_CATEGORY_IDS } from "../src/data/analytics.js";

test("failures are pinned in the validated stack order and colours", () => {
  // `node validate_palette.js "#dc3545,#fb923c,#f472b6,#ca8a04,#a855f7,#14b8a6"
  //  --mode light --surface "#ffffff"` → ALL CHECKS PASS (worst adjacent CVD ΔE 16.1).
  // Changing a hue or the order here means re-running it.
  assert.deepEqual(FAILURES, ["damage", "forgotten_freight", "misdelivery", "late", "missing", "complaint"]);
  assert.deepEqual(
    FAILURES.slice(0, 5).map(catColor),
    ["#dc3545", "#fb923c", "#f472b6", "#ca8a04", "#a855f7"],
  );
  assert.equal(ATTEMPTS, "attempts");
  assert.equal(catColor(ATTEMPTS), "#14b8a6");
  // Complaint is the de-emphasis gray, not a validated slot.
  assert.equal(catColor("complaint"), "#94a3b8");
});

test("the six stacked categories are the validated six-slot order", () => {
  assert.deepEqual(CHARTED6, ["damage", "forgotten_freight", "misdelivery", "late", "missing", "attempts"]);
  assert.deepEqual(
    CHARTED6.map(catColor),
    ["#dc3545", "#fb923c", "#f472b6", "#ca8a04", "#a855f7", "#14b8a6"],
  );
  // Reports and Trends stack exactly these, in this order.
  assert.deepEqual(ANALYTICS_CATEGORY_IDS, CHARTED6);
  // Same six categories they charted before — only the order changed, so no total did.
  assert.deepEqual(
    [...ANALYTICS_CATEGORY_IDS].sort(),
    ["attempts", "damage", "forgotten_freight", "late", "misdelivery", "missing"],
  );
  assert.equal(ANALYTICS_CATEGORIES.find((c) => c.id === "late").color, "#ca8a04");
});

test("COUNTED8 is the rollup's TRACKED set", () => {
  assert.deepEqual(
    [...COUNTED8].sort(),
    ["attempts", "complaint", "compliment", "damage", "forgotten_freight", "late", "misdelivery", "missing"],
  );
  // firebase.js can't be imported here (it starts the SDK), so check its source: the
  // rollup must build TRACKED from COUNTED8, not from a list of its own.
  const src = readFileSync(new URL("../src/data/firebase.js", import.meta.url), "utf8");
  assert.match(src, /const TRACKED = new Set\(COUNTED8\);/);
});

test("every category has a polarity, and polarities partition the registry", () => {
  for (const c of INCIDENT_CATEGORIES) assert.ok(catPolarity(c.id), `${c.id} has no polarity`);
  assert.deepEqual(CREDIT, ["compliment"]);
  assert.deepEqual(EXCLUDED, ["return", "trace", "unable_to_track"]);
  const all = [...FAILURES, ATTEMPTS, ...CREDIT, ...EXCLUDED].sort();
  assert.deepEqual(all, CATEGORIES.map((c) => c.id).sort());
  // Compliments are credit, never a failure; attempts are their own measure.
  assert.ok(!FAILURES.includes("compliment"));
  assert.ok(!FAILURES.includes("attempts"));
});

test("compliment has a defined colour", () => {
  assert.match(catColor("compliment"), /^#[0-9a-f]{6}$/);
  assert.equal(catColor("compliment"), "#22c55e");
});

test("the incident vocabulary takes its labels and colours from the registry", () => {
  for (const c of INCIDENT_CATEGORIES) {
    assert.equal(c.color, catColor(c.id), c.id);
    assert.equal(c.label, catLabel(c.id), c.id);
  }
  assert.equal(INCIDENT_CATEGORIES.find((c) => c.id === "forgotten_freight").color, "#fb923c");
});

test("an unknown id is shown, not dropped", () => {
  assert.equal(catLabel("mystery"), "mystery");
  assert.equal(catColor("mystery"), "#94a3b8");
  assert.deepEqual(categoriesFor(["mystery"]).map((c) => c.id), ["mystery"]);
});

test("print colours are the screen colours", () => {
  assert.deepEqual(catRgb("late"), [202, 138, 4]);
  assert.deepEqual(catRgb("forgotten_freight"), [251, 146, 60]);
  assert.deepEqual(catRgb("attempts"), [20, 184, 166]);
});

// Nothing outside categories.js may spell a category colour again — not in .js, .jsx or
// .css. Every registry hex is banned, with the hexes the six old copies used and the PDF
// RGB triples of the distinctive hues.
//
// A few registry values are ALSO a status or neutral token with a job of its own (the
// red is the driver-fault red; the slates are muted text). Those are allowed only in the
// files listed, each for the reason given; anywhere else they fail like the rest.
const ALLOWED = {
  "styles.css": {
    "#dc3545": "--accent-red and the driver-fault chip: status red",
    "#94a3b8": "slate muted text",
    "#64748b": "slate muted text, and the Uline traces source badge",
    "#3b82f6": "the Uline returns source badge: a report source, not the Return category",
  },
  "data/drivers.js": {
    "#dc3545": "FAULT_CODES driver: status red",
    "#64748b": "FAULT_CODES customer/vendor: neutral",
  },
  "views/Reports.jsx": { "#dc3545": "sparkline rising: status red" },
  "views/kit/chartTheme.js": { "#94a3b8": "PRIOR, the comparison-series gray" },
};

test("no other source file carries a category colour", () => {
  const banned = [
    ...new Set(CATEGORIES.map((c) => c.color.toLowerCase())),
    "#f97316", "#facc15", "#ef4444", "#22aa5c",
    "[249, 115, 22]", "[168, 85, 247]", "[244, 114, 182]",
    ...["forgotten_freight", "misdelivery", "late", "missing", "attempts", "compliment"].map(
      (id) => `[${catRgb(id).join(", ")}]`,
    ),
  ];
  const root = new URL("../src/", import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx|css)$/.test(f) && !p.endsWith("data/categories.js")) files.push(p);
    }
  };
  walk(root);
  const hits = [];
  for (const p of files) {
    const rel = p.slice(root.length);
    const src = readFileSync(p, "utf8").toLowerCase();
    for (const b of banned) if (src.includes(b) && !ALLOWED[rel]?.[b]) hits.push(`${rel}: ${b}`);
  }
  assert.deepEqual(hits, []);
});
