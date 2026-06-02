// doc — NuVizz POD image download proxy → returns { dataUri }.
//
// The client (nuvizzClient.fetchDocDataUri) calls
//   GET /doc?path=<documentPath>&guid=<documentGuid>&ext=<ext>&company=<co>
// and expects { dataUri } (base64) or 404.
//
// In the current NuVizz API, a podDoc's `documentPath` is a QUERY STRING, e.g.
//   cc=ULINE&objType=stop&docGuid=<guid>&ext
// (the trailing `ext` takes the real extension). We download with direct HTTP
// Basic auth (the same scheme the live data endpoints now require) and re-serve
// the bytes as a data URI. Older file-path style documentPaths are also handled.
//
// Credentials from env NUVIZZ_USER / NUVIZZ_PASS / NUVIZZ_COMPANY.

const NUVIZZ_HOSTS = [
  "https://portal.nuvizz.com/deliverit/openapi/v7",
  "https://contact-support.nuvizz.com/deliverit/openapi/v7",
];

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

const deliveritRoot = (host) => host.replace(/\/openapi\/v7\/?$/, ""); // …/deliverit
const portalRoot = (host) => host.replace(/\/deliverit\/openapi\/v7\/?$/, "");

// Build candidate download URLs for a documentPath (query-string or file-path form).
function candidateUrls(host, path, guid, ext) {
  const urls = [];
  const isQuery = /[?&=]/.test(path || "") || /docGuid=|cc=/.test(path || "");
  if (path && isQuery) {
    // normalize trailing bare `&ext` → `&ext=<ext>`
    let qs = path.replace(/&ext$/i, `&ext=${ext}`);
    if (!/[?&]ext=/.test(qs)) qs += `&ext=${ext}`;
    urls.push(`${deliveritRoot(host)}/document/download?${qs}`);
    urls.push(`${deliveritRoot(host)}/document?${qs}`);
  } else if (path) {
    // older file-path form
    const root = portalRoot(host);
    urls.push(
      /^https?:\/\//i.test(path) ? path : `${root}${path.startsWith("/") ? "" : "/"}${path}`,
    );
  }
  return urls;
}

export default async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const guid = url.searchParams.get("guid");
  const ext = (url.searchParams.get("ext") || "jpg").toLowerCase();
  const company =
    url.searchParams.get("company") || process.env.NUVIZZ_COMPANY || "ULINE";

  if (!path && !guid) return json({ error: "path or guid required" }, 400);
  if (!path) return json({ error: "not_found", guid }, 404);

  const user = process.env.NUVIZZ_USER;
  const pass = process.env.NUVIZZ_PASS;
  if (!user || !pass) return json({ error: "NuVizz creds not configured" }, 500);
  const basic = Buffer.from(`${user}:${pass}`).toString("base64");

  const errors = [];
  for (const host of NUVIZZ_HOSTS) {
    for (const docUrl of candidateUrls(host, path, guid, ext)) {
      try {
        const res = await fetch(docUrl, {
          headers: { Authorization: `Basic ${basic}`, Accept: "image/*,application/octet-stream,*/*" },
          redirect: "follow",
        });
        const ct = res.headers.get("content-type") || "";
        if (!res.ok || /text\/html|application\/json/.test(ct)) {
          errors.push({ url: docUrl, status: res.status, ct });
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 64) {
          errors.push({ url: docUrl, status: res.status, ct, tooSmall: buf.length });
          continue;
        }
        const mime = MIME[ext] || ct || "image/jpeg";
        return json({ dataUri: `data:${mime};base64,${buf.toString("base64")}`, guid, sourceHost: host });
      } catch (err) {
        errors.push({ url: docUrl, message: err.message });
      }
    }
  }
  return json({ error: "document fetch failed", attempts: errors }, 404);
};
