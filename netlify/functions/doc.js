// doc — NuVizz POD image download proxy → returns { dataUri }.
//
// Recovered from davis-nuvizz's nuvizz.js (the authoritative working integration).
// The document is fetched by documentGuid from the NuVizz "documentapi" service with
// direct HTTP Basic auth (the JWT/Bearer flow is deprecated — see track.js):
//
//   GET {DOC_BASE}/doc/getdocument/{companyCode}?documentGuid=<guid>&objectType=02&extension=<ext>
//        Authorization: Basic base64(user:pass)
//   → { documentData: "<base64>" }
//
//   DOC_BASE = https://portal.nuvizz.com/deliverit/openapi/documentapi
//
// Uline stop docs may live under either company code, so we try ULINE then DAVIS.
// Fallback: chain to the sibling tracking site's /doc (same creds), as nuvizz.js does.
//
// The client (nuvizzClient.fetchDocDataUri) calls /doc?guid=X&ext=jpg&company=ULINE
// and expects { dataUri } (base64) or 404. Creds from env NUVIZZ_USER / NUVIZZ_PASS.

const DOC_BASES = [
  process.env.NUVIZZ_DOC_BASE ||
    "https://portal.nuvizz.com/deliverit/openapi/documentapi",
  "https://contact-support.nuvizz.com/deliverit/openapi/documentapi",
];
const TRACKING_DOC_URL = "https://tracking.davisdelivery.com/.netlify/functions/doc";

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  pdf: "application/pdf",
};

export default async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);

  const url = new URL(req.url);
  const guid = url.searchParams.get("guid") || url.searchParams.get("documentGuid");
  const ext = (url.searchParams.get("ext") || "jpg").toLowerCase();
  const primary =
    (url.searchParams.get("company") || process.env.NUVIZZ_COMPANY || "ULINE").toUpperCase();
  if (!guid) return json({ error: "guid required" }, 400);

  const user = process.env.NUVIZZ_USER;
  const pass = process.env.NUVIZZ_PASS;
  if (!user || !pass) return json({ error: "NuVizz creds not configured" }, 500);
  const basic = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  const mime = MIME[ext] || "image/jpeg";

  // Most Uline stop docs are stored under ULINE; try the requested company then the other.
  const companies = primary === "DAVIS" ? ["DAVIS", "ULINE"] : ["ULINE", "DAVIS"];
  const attempts = [];

  // Strategy 1 — direct NuVizz documentapi (preferred).
  for (const base of DOC_BASES) {
    for (const cc of companies) {
      const docUrl = `${base}/doc/getdocument/${encodeURIComponent(cc)}?documentGuid=${encodeURIComponent(guid)}&objectType=02&extension=${encodeURIComponent(ext)}`;
      try {
        const res = await fetch(docUrl, { headers: { Authorization: basic, Accept: "application/json" } });
        if (!res.ok) {
          attempts.push({ via: "direct", cc, base, status: res.status });
          continue;
        }
        const data = await res.json();
        if (data && data.documentData) {
          return json({ dataUri: `data:${mime};base64,${data.documentData}`, guid, via: "direct", company: cc });
        }
        attempts.push({ via: "direct", cc, base, reason: data?.reasons?.[0]?.description || data?.message || "no documentData" });
      } catch (err) {
        attempts.push({ via: "direct", cc, base, error: err.message });
      }
    }
  }

  // Strategy 2 — chain to the sibling tracking site's working /doc (same creds).
  try {
    const res = await fetch(
      `${TRACKING_DOC_URL}?guid=${encodeURIComponent(guid)}&ext=${encodeURIComponent(ext)}&company=${encodeURIComponent(primary)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.dataUri) {
        return json({ dataUri: data.dataUri, guid, via: "tracking-chain" });
      }
    }
    attempts.push({ via: "tracking-chain", status: res.status });
  } catch (err) {
    attempts.push({ via: "tracking-chain", error: err.message });
  }

  return json({ error: "document not found", guid, attempts }, 404);
};
