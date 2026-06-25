// Client for the dispatch app's automated attempts feed (CORS, read-only, no auth).
// A delivery "attempt" is a stop a driver couldn't complete; CS prepends "ATT" to
// the shipment and unplans it. The feed computes who ORIGINALLY had each attempt
// from that morning's routed-plan snapshot. Data is keyed by America/New_York day.
export const ATTEMPTS_FEED_URL =
  "https://dd-dispatch-map.netlify.app/.netlify/functions/nuvizz-attempts";

// Today as YYYY-MM-DD in America/New_York (the feed's day boundary).
export function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Fetch the attempts feed for a day. Optional driver filter; pass an AbortSignal
// to cancel. Throws on transport / { ok:false } errors.
export async function fetchAttempts(date, { driver, signal } = {}) {
  const url =
    `${ATTEMPTS_FEED_URL}?date=${encodeURIComponent(date)}` +
    (driver ? `&driver=${encodeURIComponent(driver)}` : "");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.ok === false) throw new Error(j?.error || "Feed error");
  return j;
}

// Remove one auto-detected attempt from the feed (by ET day + stopNbr).
export async function deleteAttempt(date, stopNbr, { signal } = {}) {
  const url =
    `${ATTEMPTS_FEED_URL}?date=${encodeURIComponent(date)}` +
    `&stopNbr=${encodeURIComponent(stopNbr)}`;
  const res = await fetch(url, { method: "DELETE", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({ ok: true }));
}
