// Reviews proxy — reads the canonical Davis Delivery review store (Netlify Blobs
// on the DDS-Tracking site) and returns it to this app's UI. Keeping the call
// server-side means the dashboard key never ships in client JS. Single source
// of truth stays in one place; this app just renders it.
const SOURCE_URL =
  process.env.REVIEWS_SOURCE_URL ||
  "https://davisdeliverytracking.netlify.app/.netlify/functions/review";
// No literal fallback here on purpose: a hardcoded key committed to source is a
// leaked credential (visible in git history forever, even after removal). Fail
// loudly instead — set REVIEWS_SOURCE_KEY (or DASHBOARD_KEY) as a Netlify env var.
const SOURCE_KEY = process.env.REVIEWS_SOURCE_KEY || process.env.DASHBOARD_KEY;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  if (!SOURCE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Reviews source not configured",
        required: ["REVIEWS_SOURCE_KEY"],
      }),
    };
  }
  try {
    const res = await fetch(`${SOURCE_URL}?key=${encodeURIComponent(SOURCE_KEY)}`);
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: "Source error", detail: text.slice(0, 300) }) };
    }
    let data;
    try { data = JSON.parse(text); } catch { data = { reviews: [] }; }
    // clicksReadable rides along. The source joins observed Google clicks onto each review
    // and sets this false when its click store was unreachable — in which case EVERY row
    // comes back with googleClickAt: null. Dropping the flag here (which this proxy used to
    // do) would leave the UI unable to tell "nobody clicked" apart from "we could not look",
    // and it would print the confident version of the two. Absent from the source means
    // unknown, not fine, so it is forwarded as null rather than defaulted to true.
    const clicksReadable = data.clicksReadable === true ? true
      : data.clicksReadable === false ? false
      : null;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reviews: data.reviews || [], clicksReadable }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Fetch failed", detail: err.message }) };
  }
};
