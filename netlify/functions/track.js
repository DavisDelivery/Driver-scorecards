// track — NuVizz stop/document proxy.
//
// ⚠️ RECONSTRUCTION GAP — THE ORIGINAL SOURCE OF THIS FUNCTION WAS NOT RECOVERABLE.
// It proxied an EXTERNAL, proprietary NuVizz tracking API (authenticating with
// the site env vars NUVIZZ_USER / NUVIZZ_PASS / NUVIZZ_COMPANY) to fetch a stop's
// documents (POD photos) + exceptions for a given PRO number. That upstream API
// shape is not present in the client bundle or the deploy artifact, so it cannot
// be reconstructed faithfully from outside.
//
// This placeholder returns a well-formed EMPTY response so the client degrades
// gracefully to "No photos available" instead of crashing. It does NOT perform a
// real NuVizz lookup. DO NOT rely on photo enrichment until the real upstream
// integration is restored here (see RECOVERY_STATUS.md → NuVizz functions).
//
// The client (src/parsers/nuvizzClient.js → fetchStopData) expects:
//   { documents: [{ documentGuid, documentName, extension, createdTime, side }],
//     exceptions: [{ exceptionCode, exceptionDesc, exceptionComment, addedByName, addedOn }],
//     ...stop fields }
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  const url = new URL(req.url);
  const pro = url.searchParams.get("pro");
  if (!pro) return json({ error: "pro required" }, 400);
  // Placeholder: no upstream call. Empty documents → "no photos available".
  return json({
    pro_number: pro,
    documents: [],
    exceptions: [],
    stop: null,
    _placeholder: true,
    _note:
      "NuVizz integration not restored — original track function source was unrecoverable.",
  });
};
