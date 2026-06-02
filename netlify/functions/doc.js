// doc — NuVizz document (image) proxy.
//
// ⚠️ RECONSTRUCTION GAP — THE ORIGINAL SOURCE OF THIS FUNCTION WAS NOT RECOVERABLE.
// It fetched a single document (POD photo) from the proprietary NuVizz API by
// guid and returned it as a data URI (authenticating via NUVIZZ_USER / NUVIZZ_PASS
// / NUVIZZ_COMPANY env vars). That upstream API is not present in the client
// bundle or deploy artifact, so it cannot be faithfully reconstructed here.
//
// This placeholder returns 404 so the client treats the document as unavailable
// and moves on. DO NOT rely on photo enrichment until the real integration is
// restored (see RECOVERY_STATUS.md → NuVizz functions).
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  const url = new URL(req.url);
  const guid = url.searchParams.get("guid");
  if (!guid) return json({ error: "guid required" }, 400);
  // Placeholder: document unavailable until NuVizz integration is restored.
  return json(
    {
      error: "not_found",
      _placeholder: true,
      _note:
        "NuVizz integration not restored — original doc function source was unrecoverable.",
    },
    404,
  );
};
