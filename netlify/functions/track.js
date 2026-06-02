// track — NuVizz DeliverIt OpenAPI v7 proxy: per-PRO stop + POD documents.
//
// Recovered from the original `nuvizz-photos.js` (davis-full-deploy.zip), then
// updated to match the CURRENT live behavior: NuVizz's token/Bearer flow now
// rejects the minted JWT ("invalid signature"), so the working method is to send
// HTTP **Basic** auth directly on the data endpoint (the live fn reports
// sourceVia:"direct-basic"). We keep host failover.
//
// Flow:
//   GET /stop/info/{stopNbr}/{companyCode}  (Authorization: Basic)  -> { Stop: {...} }
//   Return { stop, exe, load } — the client (nuvizzClient.fetchStopData) reads
//   exe.from.podDoc[] / exe.to.podDoc[] (documentGuid/Name/Path/extension/createdTime),
//   exe.exceptions[], load.driver*, and stop.to/from addresses.
//
// Davis' PROs are stopNbrs inside Uline's NuVizz org → company defaults to ULINE.
// Credentials from site env vars NUVIZZ_USER / NUVIZZ_PASS / NUVIZZ_COMPANY.

const NUVIZZ_HOSTS = [
  "https://portal.nuvizz.com/deliverit/openapi/v7",
  "https://contact-support.nuvizz.com/deliverit/openapi/v7",
];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });

async function getStopInfo(host, company, stopNbr, basic) {
  const url = `${host}/stop/info/${encodeURIComponent(stopNbr)}/${encodeURIComponent(company)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`stop/info ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export default async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);

  const url = new URL(req.url);
  const pro = url.searchParams.get("pro");
  if (!pro) return json({ error: "PRO number required", photos: [] }, 400);

  const user = process.env.NUVIZZ_USER;
  const pass = process.env.NUVIZZ_PASS;
  const company =
    url.searchParams.get("company") || process.env.NUVIZZ_COMPANY || "ULINE";
  if (!user || !pass) {
    return json(
      {
        error: "NuVizz credentials not configured",
        required: ["NUVIZZ_USER", "NUVIZZ_PASS", "NUVIZZ_COMPANY"],
        photos: [],
      },
      500,
    );
  }
  const basic = Buffer.from(`${user}:${pass}`).toString("base64");

  const errors = [];
  for (const host of NUVIZZ_HOSTS) {
    try {
      const stopView = await getStopInfo(host, company, pro, basic);
      const root = stopView?.Stop || stopView?.stop || stopView || {};
      const stop = root?.stop || root;
      const exe = root?.stopExecutionInfo || {};
      const load = root?.load || {};
      return json({
        pro,
        company,
        stop,
        exe,
        load,
        bol: root?.bol,
        sourceVia: "direct-basic",
        sourceHost: host,
      });
    } catch (err) {
      errors.push({ host, message: err.message });
    }
  }
  return json({ pro, error: "All NuVizz hosts failed", attempts: errors, photos: [] }, 502);
};
