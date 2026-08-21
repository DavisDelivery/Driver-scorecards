// Did the customer actually FOLLOW the Google link?
//
// WHY THIS FILE EXISTS. Until now this app's Reviews screen had one tile labelled
// "4★+ (→ Google)" and it counted `routedTo === "google"`. That field is set by the
// tracking portal at submit time on `rating >= 4` alone — it records that we SHOWED the
// customer the Google button, before the customer has done anything at all. Read as
// "6 customers went to Google" it is an intent reported as an outcome, which is the exact
// bug the tracking portal already fixed on its own dashboard and never got fixed here.
//
// The observed fact lives on the review row already: the portal mints a `clickRef` in the
// browser before the review is submitted, its /g redirect stamps that ref when somebody
// takes the link, and its GET joins the two on as `googleClickAt`. Those fields have been
// arriving in this app's payload the whole time — nothing read them.
//
// WHAT THIS CAN AND CANNOT KNOW. The ceiling is "clicked through". Whether a review was
// POSTED happens on google.com signed in as the customer, and Google tells us nothing.
// Every label below stops exactly there, and so must anything that renders them.
//
// THE THREE WAYS TO BE WRONG, and why each is handled the way it is:
//   1. A review from before click tracking existed has no `clickRef`. It reports
//      googleClickAt: null — not because nobody went, but because nothing was watching.
//      Calling that "not taken" is the same lie in the other direction, so it is its own
//      status and it is kept OUT of the rate.
//   2. The click store can be unreachable. The source says so with `clicksReadable:false`,
//      and then EVERY row reports no click. Rendering that as "nobody clicked" would put a
//      confident 0% in front of the owner during an outage.
//   3. An old source deploy might not send `clicksReadable` at all. Unknown is not the same
//      as fine: it collapses to the same unreadable state rather than being assumed true.

// The click store's answer for this whole payload. true / false / null (source did not say).
export function normalizeReadable(v) {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

// Was the Google button put in front of this customer at all? Mirrors the portal's own
// rule; `routedTo` is authoritative because the portal wrote it, but a row that lost the
// field still counts as shown when its rating qualifies.
export function wasShownGoogle(review) {
  if (!review || typeof review !== "object") return false;
  const routed = String(review.routedTo || "").toLowerCase();
  if (routed === "google") return true;
  if (routed === "internal") return false;
  return Number(review.rating) >= 4;
}

// Can this row show a click either way? Only rows minted with a ref can.
export function isClickTrackable(review) {
  return wasShownGoogle(review) && !!(review && review.clickRef);
}

// One of: "internal" | "clicked" | "not-taken" | "not-tracked" | "unreadable".
//
// `readable` is the payload-level flag, NOT a per-row one — a dead click store makes every
// tracked row unanswerable at once. It has NO DEFAULT on purpose: a default of true would
// mean a caller that forgot the argument, or a payload whose field went missing, silently
// gets the optimistic answer. Forgetting it now yields "unreadable", which is visible.
export function clickStatus(review, readable) {
  if (!wasShownGoogle(review)) return "internal";
  if (review && review.googleClickAt) return "clicked";
  if (!review || !review.clickRef) return "not-tracked";
  return normalizeReadable(readable) === true ? "not-taken" : "unreadable";
}

// How each status reads to a human. Deliberately worded the same as the tracking portal's
// admin dashboard: two screens describing one fact must not describe it two ways.
export const CLICK_LABEL = {
  clicked: "Went to Google",
  "not-taken": "Link shown — not taken",
  "not-tracked": "Link shown — not tracked",
  unreadable: "Link shown — click store unreadable",
  internal: "Internal only",
};

export function clickLabel(status) {
  return CLICK_LABEL[status] || CLICK_LABEL.internal;
}

// Roll a set of reviews up into the numbers a dashboard may honestly print. Used for the
// whole board and, unchanged, for one driver's slice.
//
// `rate` is null whenever it cannot be computed truthfully: no trackable rows, or a click
// store we could not read. Callers render null as "—", never as 0%.
export function rollupClicks(reviews, readable) {
  const list = Array.isArray(reviews) ? reviews.filter((r) => r && typeof r === "object") : [];
  const ok = normalizeReadable(readable) === true;
  let shown = 0;
  let trackable = 0;
  let clicked = 0;
  for (const r of list) {
    if (!wasShownGoogle(r)) continue;
    shown += 1;
    if (!isClickTrackable(r)) continue;
    trackable += 1;
    if (r.googleClickAt) clicked += 1;
  }
  return {
    shown,
    trackable,
    clicked,
    // May a dashboard PRINT the click counts at all? A dead click store makes every tracked
    // row look un-clicked, so `clicked` collapses to 0 — and a confident green 0 next to
    // "Clicked through" is the same lie as the tile this whole module replaced, just
    // reached by a different route. Callers render "—" when this is false.
    answerable: ok,
    // Only meaningful when the store answered. During an outage every tracked row looks
    // untaken, so "not taken" is not a count we are entitled to.
    notTaken: ok ? trackable - clicked : 0,
    // Shown the link before tracking existed. Permanently unanswerable; excluded from rate.
    untracked: shown - trackable,
    unanswered: ok ? 0 : trackable,
    rate: ok && trackable > 0 ? clicked / trackable : null,
  };
}

export function fmtRate(rate) {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}
