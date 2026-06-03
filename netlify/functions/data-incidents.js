// data-incidents — incident CRUD with SPLIT-PHOTO storage.
//
// Store: "davis-incidents"
//   inc:{id}    → light incident record (no photo bytes; has_photos + photo_count)
//   photos:{id} → { photo_urls: [dataURI...], photo_meta: [...] }
//
// Routes (all under /.netlify/functions/data-incidents):
//   GET    /                  → { incidents: [...light...] }   (optionally ?report_id=)
//   GET    /photos?id=X       → { photo_urls, photo_meta }
//   PUT    /                  → body=incident; splits + stores; → { incident: light }
//   POST   /batch             → body={ incidents:[...] }; → { incidents: [...light] }
//   DELETE /?id=X             → delete one (meta + photos)
//   DELETE /?report_id=X      → delete all for a report
//   DELETE /batch  body={ids} → delete many
import { getStore } from "@netlify/blobs";

const STORE = "davis-incidents";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const newId = () =>
  `i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Split an incoming incident into a light meta record + photos payload.
function split(incident) {
  const { photo_urls, photo_meta, ...rest } = incident;
  const urls = Array.isArray(photo_urls) ? photo_urls : [];
  const meta = Array.isArray(photo_meta) ? photo_meta : [];
  const light = {
    ...rest,
    has_photos: urls.length > 0,
    photo_count: urls.length,
  };
  return { light, photos: { photo_urls: urls, photo_meta: meta }, hasPhotos: urls.length > 0 };
}

async function listIncidents(store, reportId) {
  const { blobs } = await store.list({ prefix: "inc:" });
  const records = await Promise.all(
    blobs.map((b) => store.get(b.key, { type: "json" })),
  );
  let out = records.filter(Boolean);
  if (reportId) out = out.filter((r) => r.report_id === reportId);
  return out;
}

async function saveOne(store, incident) {
  const id = incident.id || newId();
  const now = new Date().toISOString();
  const { light, photos, hasPhotos } = split({
    ...incident,
    id,
    created_at: incident.created_at || now,
    updated_at: now,
  });
  await store.setJSON(`inc:${id}`, light);
  if (hasPhotos) {
    await store.setJSON(`photos:${id}`, photos);
  }
  return light;
}

async function deleteOne(store, id) {
  await store.delete(`inc:${id}`);
  await store.delete(`photos:${id}`);
}

export default async (req) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);
  const path = url.pathname;
  const isBatch = path.endsWith("/batch");
  const isPhotos = path.endsWith("/photos");

  try {
    if (req.method === "GET") {
      if (isPhotos) {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id required" }, 400);
        const photos = await store.get(`photos:${id}`, { type: "json" });
        return json(photos || { photo_urls: [], photo_meta: [] });
      }
      const reportId = url.searchParams.get("report_id");
      const incidents = await listIncidents(store, reportId);
      return json({ incidents });
    }

    if (req.method === "PUT") {
      const incident = await req.json();
      const saved = await saveOne(store, incident);
      return json({ incident: saved });
    }

    if (req.method === "POST" && isBatch) {
      const { incidents = [] } = await req.json();
      const saved = [];
      for (const inc of incidents) saved.push(await saveOne(store, inc));
      return json({ incidents: saved });
    }

    if (req.method === "DELETE") {
      if (isBatch) {
        const { ids = [] } = await req.json();
        for (const id of ids) await deleteOne(store, id);
        return json({ deleted: ids.length });
      }
      const id = url.searchParams.get("id");
      const reportId = url.searchParams.get("report_id");
      if (id) {
        await deleteOne(store, id);
        return json({ deleted: 1 });
      }
      if (reportId) {
        const toDelete = await listIncidents(store, reportId);
        for (const r of toDelete) await deleteOne(store, r.id);
        return json({ deleted: toDelete.length });
      }
      return json({ error: "id or report_id required" }, 400);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};
