// Reviews data client for the Davis Driver Scorecard.
//
// Reviews live in the canonical Davis Delivery review store (Netlify Blobs on
// the DDS-Tracking site). This app reads them through its own serverless proxy
// (/.netlify/functions/reviews) so the dashboard key stays server-side. Mirrors
// to localStorage as an offline cache, matching the pattern in firebase.js.
//
// The payload carries more than the rows: `clicksReadable` says whether the source could
// read its Google-click store on this load. It has to survive the cache too — a cached
// snapshot taken during an outage holds rows that all look un-clicked, and replaying it
// later without the flag would turn a temporary "we could not look" into a permanent
// "nobody clicked".

const REVIEWS_API = "/.netlify/functions/reviews";
const CACHE_KEY = "dds_reviews";

const EMPTY = { reviews: [], clicksReadable: null };

// The cache used to be a bare array. Old entries are still valid rows — they just predate
// the flag, so they read back as "unknown", which is the honest answer for them.
const readCache = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (Array.isArray(raw)) return { reviews: raw, clicksReadable: null };
    if (raw && Array.isArray(raw.reviews)) {
      return {
        reviews: raw.reviews,
        clicksReadable: raw.clicksReadable === true ? true : raw.clicksReadable === false ? false : null,
      };
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
};
const writeCache = (v) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(v));
  } catch {
    /* quota / private mode — ignore */
  }
};

// Returns { reviews, clicksReadable }. clicksReadable is true / false / null (unknown);
// callers must treat null as unknown rather than as true — see src/data/reviewClicks.js.
export async function getReviews() {
  try {
    const res = await fetch(REVIEWS_API);
    if (!res.ok) throw new Error(`GET ${REVIEWS_API} → ${res.status}`);
    const body = await res.json();
    const payload = {
      reviews: body.reviews || [],
      clicksReadable:
        body.clicksReadable === true ? true : body.clicksReadable === false ? false : null,
    };
    writeCache(payload);
    return payload;
  } catch (err) {
    console.warn("getReviews cloud failed, using cache:", err.message);
    return readCache();
  }
}
