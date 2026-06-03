// Reviews proxy — reads the canonical Davis Delivery review store (Netlify Blobs
// on the DDS-Tracking site) and returns it to this app's UI. Keeping the call
// server-side means the dashboard key never ships in client JS. Single source
// of truth stays in one place; this app just renders it.
const SOURCE_URL =
  process.env.REVIEWS_SOURCE_URL ||
  "https://davisdeliverytracking.netlify.app/.netlify/functions/review";
const SOURCE_KEY = process.env.REVIEWS_SOURCE_KEY || process.env.DASHBOARD_KEY || "davis2026";

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
  try {
    const res = await fetch(`${SOURCE_URL}?key=${encodeURIComponent(SOURCE_KEY)}`);
    const text = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: "Source error", detail: text.slice(0, 300) }) };
    }
    let data;
    try { data = JSON.parse(text); } catch { data = { reviews: [] }; }
    return { statusCode: 200, headers, body: JSON.stringify({ reviews: data.reviews || [] }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Fetch failed", detail: err.message }) };
  }
};
