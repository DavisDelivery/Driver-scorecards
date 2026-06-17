import { useState, useEffect, useMemo } from "react";
import { getReviews } from "../data/reviews.js";
import { getDrivers } from "../data/firebase.js";
import { fetchStopData } from "../parsers/nuvizzClient.js";
import { matchDriver } from "../data/driverMatch.js";

// Per-browser cache of PRO → resolved driver so we don't re-hit NuVizz each load.
const ATTR_CACHE = "dds_review_pro_driver";
const readAttrCache = () => {
  try {
    return JSON.parse(localStorage.getItem(ATTR_CACHE) || "{}");
  } catch {
    return {};
  }
};
const writeAttrCache = (o) => {
  try {
    localStorage.setItem(ATTR_CACHE, JSON.stringify(o));
  } catch {
    /* quota / private mode — ignore */
  }
};
// A review counts as already-attributed if the source supplied a driver name.
const sourceHasDriver = (r) => !!(r.driver && r.driver.trim());

const ACCENT = "#1e5b92";
const GREEN = "#15803d";
const AMBER = "#b45309";
const RED = "#b91c1c";

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function Stars({ n }) {
  const full = Math.round(n);
  return (
    <span style={{ color: "#e8a838", letterSpacing: "1px", whiteSpace: "nowrap" }}>
      {"★".repeat(full)}
      <span style={{ color: "#d6dbe2" }}>{"★".repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}

function ratingColor(avg) {
  if (avg >= 4.5) return GREEN;
  if (avg >= 3.5) return AMBER;
  return RED;
}

export default function Reviews() {
  const [reviews, setReviews] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [sortKey, setSortKey] = useState("avg");
  const [sortDir, setSortDir] = useState("asc"); // worst-first by default
  // PRO → driver attribution for reviews the source left unattributed, resolved
  // via NuVizz. { [pro]: { driverId, driverName, status } }
  const [attrib, setAttrib] = useState(() => readAttrCache());
  const [resolving, setResolving] = useState(0); // # of PROs still resolving

  useEffect(() => {
    (async () => {
      try {
        const [revs, drvs] = await Promise.all([getReviews(), getDrivers()]);
        setReviews(revs);
        setDrivers(drvs);
        resolveAttributions(revs, drvs);
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the delivering driver for each unattributed review by looking up its
  // PRO in NuVizz and matching the driver name to the roster. Cached per-PRO so
  // it only hits NuVizz once per PRO per browser; pass force=true to re-check.
  async function resolveAttributions(revs, drvs, force = false) {
    if (force) {
      setAttrib({});
      writeAttrCache({});
    }
    const cache = force ? {} : readAttrCache();
    const pending = [
      ...new Set(
        revs
          .filter((r) => !sourceHasDriver(r) && r.proNumber)
          .map((r) => r.proNumber),
      ),
    ].filter((pro) => force || !(pro in cache));
    if (!pending.length) {
      setAttrib(cache);
      return;
    }
    setResolving(pending.length);
    const CONC = 4;
    for (let i = 0; i < pending.length; i += CONC) {
      const slice = pending.slice(i, i + CONC);
      const results = await Promise.all(
        slice.map(async (pro) => {
          try {
            const res = await fetchStopData(pro);
            const name = res?.stop?.driverName || "";
            const d = matchDriver(name, drvs);
            if (d)
              return [pro, { driverId: d.id, driverName: d.name, nuvizzName: name, status: "resolved" }];
            if (name)
              return [pro, { driverId: "", driverName: "", nuvizzName: name, status: "unmatched" }];
            return [pro, { driverId: "", driverName: "", nuvizzName: "", status: "none" }];
          } catch (e) {
            return [pro, { driverId: "", driverName: "", status: "error", err: e.message }];
          }
        }),
      );
      setAttrib((prev) => {
        const next = { ...prev };
        for (const [pro, v] of results) next[pro] = v;
        writeAttrCache(next);
        return next;
      });
      setResolving((n) => Math.max(0, n - slice.length));
    }
    setResolving(0);
  }

  // Effective driver name for a review: source-provided, else PRO-attributed.
  const driverFor = (r) => {
    if (sourceHasDriver(r)) return r.driver.trim();
    const a = attrib[r.proNumber];
    return a && a.status === "resolved" ? a.driverName : null;
  };
  const attributedViaPro = (r) =>
    !sourceHasDriver(r) && attrib[r.proNumber]?.status === "resolved";

  const kpis = useMemo(() => {
    const n = reviews.length;
    const avg = n ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / n : 0;
    const google = reviews.filter((r) => r.routedTo === "google").length;
    const internal = reviews.filter((r) => r.routedTo === "internal").length;
    const dist = [1, 2, 3, 4, 5].map((star) => reviews.filter((r) => r.rating === star).length);
    return { n, avg, google, internal, dist };
  }, [reviews]);

  // Per-driver rollup. Uses the PRO-attributed driver when the source left one
  // blank; anything still unresolved buckets as "Unattributed".
  const byDriver = useMemo(() => {
    const map = new Map();
    for (const r of reviews) {
      const key = driverFor(r) || "Unattributed (PRO only)";
      if (!map.has(key)) map.set(key, { driver: key, count: 0, sum: 0, low: 0, last: "" });
      const d = map.get(key);
      d.count += 1;
      d.sum += r.rating || 0;
      if ((r.rating || 0) <= 3) d.low += 1;
      if (!d.last || new Date(r.submittedAt) > new Date(d.last)) d.last = r.submittedAt;
    }
    return Array.from(map.values()).map((d) => ({ ...d, avg: d.count ? d.sum / d.count : 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, attrib]);

  const sortedDrivers = useMemo(() => {
    const arr = [...byDriver];
    arr.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "driver") {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
        return sortDir === "asc" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      }
      if (sortKey === "last") {
        av = new Date(av || 0).getTime();
        bv = new Date(bv || 0).getTime();
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [byDriver, sortKey, sortDir]);

  const recent = useMemo(
    () =>
      [...reviews]
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
        .slice(0, 50),
    [reviews]
  );

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "driver" ? "asc" : "desc");
    }
  };

  const Th = ({ k, children, right }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{
        textAlign: right ? "right" : "left",
        padding: "8px 10px",
        cursor: "pointer",
        userSelect: "none",
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: ".04em",
        color: "#5a6779",
        borderBottom: "2px solid #e6eaef",
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  if (loading) return <div className="empty-state">Loading reviews…</div>;

  const card = {
    background: "#fff",
    border: "1px solid #e6eaef",
    borderRadius: "12px",
    padding: "16px 18px",
  };

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "18px", maxWidth: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: "20px", color: "#0a2744", margin: 0 }}>Customer Reviews</h2>
          <p style={{ color: "#97a3b3", fontSize: "13px", marginTop: "4px" }}>
            Delivery ratings from the public tracking portal, attributed to the delivering driver by PRO.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {resolving > 0 && (
            <span style={{ fontSize: "12px", color: "#97a3b3" }}>
              Attributing {resolving} PRO{resolving === 1 ? "" : "s"}…
            </span>
          )}
          <button
            className="btn ghost sm"
            onClick={() => resolveAttributions(reviews, drivers, true)}
            disabled={resolving > 0 || loading}
            title="Re-check every unattributed review's driver from NuVizz"
          >
            Re-attribute
          </button>
        </div>
      </div>

      {err && (
        <div style={{ ...card, borderColor: "#f3c9c9", background: "#fef5f5", color: RED, fontSize: "13px" }}>
          Couldn't reach the review source ({err}). Showing cached data if available.
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "12px" }}>
        <div style={card}>
          <div style={{ fontSize: "11px", color: "#97a3b3", textTransform: "uppercase", letterSpacing: ".04em" }}>Total Reviews</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#0a2744" }}>{kpis.n}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "11px", color: "#97a3b3", textTransform: "uppercase", letterSpacing: ".04em" }}>Avg Rating</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: ratingColor(kpis.avg) }}>
            {kpis.n ? kpis.avg.toFixed(2) : "—"}
          </div>
          <Stars n={kpis.avg} />
        </div>
        <div style={card}>
          <div style={{ fontSize: "11px", color: "#97a3b3", textTransform: "uppercase", letterSpacing: ".04em" }}>4★+ (→ Google)</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: GREEN }}>{kpis.google}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "11px", color: "#97a3b3", textTransform: "uppercase", letterSpacing: ".04em" }}>≤3★</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: RED }}>{kpis.internal}</div>
        </div>
      </div>

      {/* Rating distribution */}
      <div style={card}>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#0a2744", marginBottom: "10px" }}>Rating Distribution</div>
        {[5, 4, 3, 2, 1].map((star) => {
          const c = kpis.dist[star - 1];
          const pct = kpis.n ? Math.round((c / kpis.n) * 100) : 0;
          return (
            <div key={star} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "5px 0" }}>
              <div style={{ width: "44px", fontSize: "12px", color: "#5a6779" }}>{star}★</div>
              <div style={{ flex: 1, background: "#eef1f5", borderRadius: "6px", height: "14px", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: star >= 4 ? GREEN : star === 3 ? AMBER : RED }} />
              </div>
              <div style={{ width: "70px", textAlign: "right", fontSize: "12px", color: "#5a6779" }}>
                {c} · {pct}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-driver scorecard */}
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", fontSize: "13px", fontWeight: 700, color: "#0a2744", borderBottom: "1px solid #eef1f5" }}>
          By Driver
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                <Th k="driver">Driver</Th>
                <Th k="count" right>Reviews</Th>
                <Th k="avg" right>Avg</Th>
                <Th k="low" right>≤3★</Th>
                <Th k="last" right>Last Review</Th>
              </tr>
            </thead>
            <tbody>
              {sortedDrivers.map((d) => (
                <tr key={d.driver} style={{ borderBottom: "1px solid #f1f4f7" }}>
                  <td style={{ padding: "9px 10px", fontWeight: 600, color: d.driver.startsWith("Unattributed") ? "#97a3b3" : "#0a2744" }}>
                    {d.driver}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "right" }}>{d.count}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: ratingColor(d.avg) }}>
                    {d.avg.toFixed(2)} <Stars n={d.avg} />
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: d.low ? RED : "#5a6779" }}>{d.low}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: "#5a6779" }}>{fmtDate(d.last)}</td>
                </tr>
              ))}
              {!sortedDrivers.length && (
                <tr>
                  <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#97a3b3" }}>No reviews yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent reviews */}
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", fontSize: "13px", fontWeight: 700, color: "#0a2744", borderBottom: "1px solid #eef1f5" }}>
          Recent Reviews
        </div>
        <div>
          {recent.map((r) => (
            <div key={r.id} style={{ padding: "12px 18px", borderBottom: "1px solid #f1f4f7" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Stars n={r.rating} />
                  <span style={{ fontWeight: 700, color: driverFor(r) ? "#0a2744" : "#97a3b3" }}>
                    {driverFor(r) || "Unattributed"}
                  </span>
                  {attributedViaPro(r) && (
                    <span
                      style={{
                        fontSize: "10px",
                        color: GREEN,
                        background: "#e7f4ec",
                        border: "1px solid #cce8d6",
                        borderRadius: "4px",
                        padding: "1px 5px",
                      }}
                    >
                      via PRO
                    </span>
                  )}
                  {r.proNumber && (
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#97a3b3" }}>
                      PRO {r.proNumber}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: "12px", color: "#97a3b3" }}>{fmtDate(r.submittedAt)}</span>
              </div>
              {r.comment && <div style={{ fontSize: "13px", color: "#3c4858", marginTop: "6px" }}>{r.comment}</div>}
              {(r.name || r.contact) && (
                <div style={{ fontSize: "11px", color: "#97a3b3", marginTop: "4px" }}>
                  {r.name}
                  {r.name && r.contact ? " · " : ""}
                  {r.contact}
                </div>
              )}
            </div>
          ))}
          {!recent.length && (
            <div style={{ padding: "24px", textAlign: "center", color: "#97a3b3" }}>No reviews yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
