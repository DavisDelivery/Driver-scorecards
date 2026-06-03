// data-drivers — driver roster.
// Store: "davis-drivers", key "roster" → JSON array of driver objects.
//   GET → { drivers: [...] }
//   PUT body={ drivers:[...] } → persists roster → { drivers: [...] }
import { getStore } from "@netlify/blobs";

const STORE = "davis-drivers";
const KEY = "roster";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  try {
    if (req.method === "GET") {
      const drivers = (await store.get(KEY, { type: "json" })) || [];
      return json({ drivers });
    }
    if (req.method === "PUT") {
      const { drivers = [] } = await req.json();
      await store.setJSON(KEY, drivers);
      return json({ drivers });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};
