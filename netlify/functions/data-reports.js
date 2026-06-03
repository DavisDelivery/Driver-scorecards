// data-reports — saved weekly reports.
// Store: "davis-reports"
//   meta:{id} → report metadata (light, no pdf bytes)
//   pdf:{id}  → { pdf_data } (large base64 PDF, stored separately to keep list small)
//
//   GET            → { reports: [...light meta...] }
//   GET ?id=X      → { report: {...meta, pdf_data?} }
//   PUT body=report→ persists (pdf_data split out) → { report: light meta }
//   DELETE ?id=X   → delete meta + pdf
import { getStore } from "@netlify/blobs";

const STORE = "davis-reports";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const newId = () =>
  `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export default async (req) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  try {
    if (req.method === "GET") {
      if (id) {
        const meta = await store.get(`meta:${id}`, { type: "json" });
        if (!meta) return json({ report: null });
        const pdf = await store.get(`pdf:${id}`, { type: "json" });
        return json({ report: pdf?.pdf_data ? { ...meta, pdf_data: pdf.pdf_data } : meta });
      }
      const { blobs } = await store.list({ prefix: "meta:" });
      const reports = (
        await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))
      ).filter(Boolean);
      return json({ reports });
    }

    if (req.method === "PUT") {
      const incoming = await req.json();
      const rid = incoming.id || newId();
      const now = new Date().toISOString();
      const { pdf_data, ...meta } = incoming;
      const record = {
        ...meta,
        id: rid,
        created_at: incoming.created_at || now,
        updated_at: now,
      };
      await store.setJSON(`meta:${rid}`, record);
      if (pdf_data !== undefined) {
        await store.setJSON(`pdf:${rid}`, { pdf_data });
      }
      return json({ report: record });
    }

    if (req.method === "DELETE") {
      if (!id) return json({ error: "id required" }, 400);
      await store.delete(`meta:${id}`);
      await store.delete(`pdf:${id}`);
      return json({ deleted: 1 });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};
