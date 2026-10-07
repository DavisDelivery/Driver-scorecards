// Guards the URL-hash state that tabs and filters now live in.
//
// Views unmount on every tab switch, so their filters used to reset each time; they
// live in the hash now (#tab=attempts&att.p=30d). The two things that must never break
// are the round trip, and leaving alone the keys another tab (or a later version)
// wrote — a link should open exactly what was shared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, buildHash, patchHash } from "../src/data/hashState.js";

test("parse and build round-trip", () => {
  const state = { tab: "attempts", "att.p": "range", "att.from": "2026-09-01", "att.to": "2026-09-30" };
  assert.deepEqual(parseHash(`#${buildHash(state)}`), state);
  assert.equal(buildHash(state), "tab=attempts&att.p=range&att.from=2026-09-01&att.to=2026-09-30");
});

test("awkward values survive", () => {
  const state = { "tr.driver": "name:JOSÉ O'NEIL & SONS", q: "a=b#c", empty: "x" };
  assert.deepEqual(parseHash(buildHash(state)), state);
});

test("empty values are left out of the link", () => {
  assert.equal(buildHash({ tab: "trends", "tr.y": "", "tr.view": null, x: undefined }), "tab=trends");
  assert.equal(buildHash({}), "");
});

test("junk degrades instead of throwing", () => {
  assert.deepEqual(parseHash(""), {});
  assert.deepEqual(parseHash("#"), {});
  assert.deepEqual(parseHash(null), {});
  assert.deepEqual(parseHash("#&&tab=reports&"), { tab: "reports" });
  assert.deepEqual(parseHash("#flag"), { flag: "" });
  // A broken escape is kept as typed.
  assert.deepEqual(parseHash("#tab=%E0%A4%A"), { tab: "%E0%A4%A" });
});

test("a patch changes its own keys and preserves every unknown one", () => {
  const current = parseHash("#tab=dashboard&sc.p=3&future.key=keep-me&att.p=lastWeek");
  const next = patchHash(current, { tab: "attempts", "sc.p": null });
  assert.deepEqual(next, { tab: "attempts", "future.key": "keep-me", "att.p": "lastWeek" });
  // Order is kept, so a link doesn't reshuffle every time a filter changes.
  assert.equal(buildHash(next), "tab=attempts&future.key=keep-me&att.p=lastWeek");
});

test("each tab's keys are its own", () => {
  // The Scorecard's month preset and a manual-entry tab's day preset don't collide.
  const h = parseHash("#sc.p=3&att.p=30d&ff.p=lastWeek");
  assert.equal(h["sc.p"], "3");
  assert.equal(h["att.p"], "30d");
  assert.equal(h["ff.p"], "lastWeek");
});
