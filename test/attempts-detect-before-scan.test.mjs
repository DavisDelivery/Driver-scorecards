// A row marked from the dispatch app before 8 PM must not hide the day's other ATT orders.
import test from "node:test";
import assert from "node:assert/strict";
import { shouldDetect, todayET, shiftDay } from "../src/data/attemptsFeed.js";

test("auto: detects when the list is empty, or when the day's scan has not run yet", () => {
  const today = todayET();
  const marked = [{ stopNbr: "007182304", source: "button" }];
  assert.equal(shouldDetect("auto", [], null, today), true);
  // One button row, no scan yet: still detect, so the board's other ATT orders show.
  assert.equal(shouldDetect("auto", marked, null, today), true);
  // The scan has run: the settled list is the answer, as before.
  assert.equal(shouldDetect("auto", marked, { generatedAt: "x" }, today), false);
  assert.equal(shouldDetect("auto", [], { generatedAt: "x" }, today), true);
});

test("explicit true / false and old days are unchanged", () => {
  assert.equal(shouldDetect(true, [{}], {}, "2026-01-01"), true);
  assert.equal(shouldDetect(false, [], null, todayET()), false);
  assert.equal(shouldDetect("auto", [], null, shiftDay(todayET(), -30)), false);
});
