// Reviews data client for the Davis Driver Scorecard.
//
// Reviews live in the canonical Davis Delivery review store (Netlify Blobs on
// the DDS-Tracking site). This app reads them through its own serverless proxy
// (/.netlify/functions/reviews) so the dashboard key stays server-side. Mirrors
// to localStorage as an offline cache, matching the pattern in firebase.js.

const REVIEWS_API = "/.netlify/functions/reviews";
const CACHE_KEY = "dds_reviews";

const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
  } catch {
    return [];
  }
};
const writeCache = (v) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(v));
  } catch {
    /* quota / private mode — ignore */
  }
};

export async function getReviews() {
  try {
    const res = await fetch(REVIEWS_API);
    if (!res.ok) throw new Error(`GET ${REVIEWS_API} → ${res.status}`);
    const { reviews } = await res.json();
    const list = reviews || [];
    writeCache(list);
    return list;
  } catch (err) {
    console.warn("getReviews cloud failed, using cache:", err.message);
    return readCache();
  }
}
