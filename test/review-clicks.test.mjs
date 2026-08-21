// The first tests in this repo.
//
// They exist because this app's Reviews screen counted "4★+ (→ Google)" and that number was
// never a count of customers who went to Google — it was a count of customers we handed the
// link to. The tracking portal fixed the same confusion on its own dashboard months ago;
// this app kept printing the optimistic version. Every rule below is one that, if it drifts,
// puts another confident-but-unearned number in front of the owner.
//
// Everything here is PURE — no network, no Netlify Blobs, no React.
import test from "node:test";
import assert from "node:assert/strict";
import {
  wasShownGoogle,
  isClickTrackable,
  clickStatus,
  clickLabel,
  rollupClicks,
  fmtRate,
  normalizeReadable,
} from "../src/data/reviewClicks.js";

const shown = (over = {}) => ({ rating: 5, routedTo: "google", clickRef: "r1", ...over });

// ── WHO WAS EVEN OFFERED THE LINK ────────────────────────────────────────────

test("a 3-star review is never sent to Google, so it is not a missed click", () => {
  assert.equal(wasShownGoogle({ rating: 3, routedTo: "internal" }), false);
  assert.equal(clickStatus({ rating: 3, routedTo: "internal" }, true), "internal");
});

test("a row that lost routedTo still counts as shown when the rating qualifies", () => {
  // Defensive: routedTo is written by the portal, but a row missing it must not silently
  // vanish out of the denominator and flatter the click-through rate.
  assert.equal(wasShownGoogle({ rating: 4, clickRef: "r1" }), true);
  assert.equal(wasShownGoogle({ rating: 2 }), false);
});

test("malformed rows do not crash and do not count", () => {
  for (const bad of [null, undefined, 0, "", [], "five stars"]) {
    assert.equal(wasShownGoogle(bad), false);
  }
  assert.equal(wasShownGoogle({ rating: null }), false); // Number(null) is 0, not 4
  assert.equal(wasShownGoogle({ rating: undefined }), false);
});

// ── THE CENTRAL DISTINCTION ──────────────────────────────────────────────────

test("shown the link is NOT the same as took the link", () => {
  // The whole bug in one assertion.
  assert.equal(clickStatus(shown(), true), "not-taken");
  assert.equal(clickStatus(shown({ googleClickAt: "2026-08-20T14:00:00.000Z" }), true), "clicked");
});

test("a review from before click tracking existed says so, instead of saying nobody went", () => {
  // No clickRef means nothing was watching. Calling it "not taken" is the original bug
  // pointed the other way, and it would nag real customers if the follow-up mailer ever
  // trusted it.
  const old = { rating: 5, routedTo: "google" };
  assert.equal(isClickTrackable(old), false);
  assert.equal(clickStatus(old, true), "not-tracked");
});

// ── THE BAD DAY: THE CLICK STORE IS DOWN ─────────────────────────────────────

test("an unreadable click store never renders as nobody clicked", () => {
  assert.equal(clickStatus(shown(), false), "unreadable");
  assert.equal(clickStatus(shown({ googleClickAt: "T" }), false), "clicked");
});

test("a source that does not report clicksReadable is treated as unreadable, not as fine", () => {
  assert.equal(normalizeReadable(undefined), null);
  assert.equal(normalizeReadable("true"), null);
  assert.equal(clickStatus(shown(), undefined), "unreadable");
  assert.equal(clickStatus(shown(), null), "unreadable");
  // Forgetting the argument entirely is the same mistake, and must fail the same way.
  assert.equal(clickStatus(shown()), "unreadable");
  assert.equal(rollupClicks([shown()]).rate, null);
});

test("during an outage the rate is withheld, not printed as 0%", () => {
  const r = rollupClicks([shown(), shown({ clickRef: "r2" })], false);
  assert.equal(r.rate, null);
  assert.equal(fmtRate(r.rate), "—");
  assert.equal(r.notTaken, 0, "an outage entitles us to no not-taken count at all");
  assert.equal(r.unanswered, 2);
});

// ── THE NUMBERS A DASHBOARD MAY PRINT ────────────────────────────────────────

test("an outage withholds the click COUNT too, not just the rate", () => {
  // The rate going to "—" is not enough on its own: "Clicked through: 0" in green, next to
  // six reviews, reads as a collapse in customer follow-through when it is really a dead
  // blob store. Nothing may print the counts unless they were answerable.
  const live = rollupClicks([shown({ googleClickAt: "T" }), shown({ clickRef: "b" })], true);
  assert.equal(live.answerable, true);
  assert.equal(live.clicked, 1);

  const down = rollupClicks([shown({ clickRef: "a" }), shown({ clickRef: "b" })], false);
  assert.equal(down.answerable, false, "callers must render — rather than 0");
  assert.equal(rollupClicks([shown()], null).answerable, false);
  assert.equal(rollupClicks([shown()]).answerable, false);
});

test("the rate divides by trackable rows only — old reviews cannot drag it to zero", () => {
  const reviews = [
    shown({ clickRef: "a", googleClickAt: "T" }),
    shown({ clickRef: "b" }),
    { rating: 5, routedTo: "google" },        // pre-tracking
    { rating: 5, routedTo: "google" },        // pre-tracking
    { rating: 2, routedTo: "internal" },
  ];
  const r = rollupClicks(reviews, true);
  assert.equal(r.shown, 4);
  assert.equal(r.trackable, 2);
  assert.equal(r.clicked, 1);
  assert.equal(r.notTaken, 1);
  assert.equal(r.untracked, 2);
  assert.equal(r.rate, 0.5, "1 of 2 trackable, not 1 of 4 shown");
  assert.equal(fmtRate(r.rate), "50%");
});

test("no trackable reviews yet shows a dash, not a perfect score and not a zero", () => {
  assert.equal(rollupClicks([], true).rate, null);
  assert.equal(rollupClicks([{ rating: 5, routedTo: "google" }], true).rate, null);
  assert.equal(rollupClicks([{ rating: 1, routedTo: "internal" }], true).rate, null);
});

test("the rollup survives junk in the list", () => {
  const r = rollupClicks([null, undefined, "x", shown({ googleClickAt: "T" })], true);
  assert.equal(r.shown, 1);
  assert.equal(r.clicked, 1);
  assert.equal(r.rate, 1);
  assert.deepEqual(rollupClicks(null, true), rollupClicks([], true));
});

test("clicked is always a subset of trackable — the rate can never exceed 100%", () => {
  // A click can only be joined on via a ref, so a googleClickAt without one must not be
  // counted; otherwise a stray field prints 200%.
  const r = rollupClicks([{ rating: 5, routedTo: "google", googleClickAt: "T" }], true);
  assert.equal(r.trackable, 0);
  assert.equal(r.clicked, 0);
  assert.equal(r.rate, null);
});

// ── WORDING ──────────────────────────────────────────────────────────────────

test("no label claims a review was POSTED — the ceiling is that they went", () => {
  for (const s of ["clicked", "not-taken", "not-tracked", "unreadable", "internal"]) {
    const label = clickLabel(s);
    assert.ok(label && label.length, `${s} needs a label`);
    assert.doesNotMatch(label, /posted|left a review|wrote a review/i, `"${label}" overclaims`);
  }
  assert.equal(clickLabel("clicked"), "Went to Google");
  assert.equal(clickLabel("nonsense"), "Internal only", "an unknown status must not claim a click");
});
