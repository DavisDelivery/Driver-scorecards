import { useState, useEffect, useMemo } from "react";
import { getReviews } from "../data/reviews.js";
import { getDrivers } from "../data/firebase.js";
import { fetchStopData } from "../parsers/nuvizzClient.js";
import { matchDriver } from "../data/driverMatch.js";
import {
  generateReviewsReport,
  reviewsReportFilename,
} from "../reports/reviewsReport.js";
import { PERIODS, periodWindow, periodLabel, toYMD } from "../data/period.js";

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

// `incidents` is the Firestore incident set App already holds. A review only carries
// a PRO, so the customer is looked up: first from those incidents (free — the PRO is
// usually one we've already logged), and only otherwise from the per-PRO NuVizz
// lookup this view was already making to attribute the driver.
export default function Reviews({ incidents = [] }) {
  const [allReviews, setAllReviews] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [sortKey, setSortKey] = useState("avg");
  const [sortDir, setSortDir] = useState("asc"); // worst-first by default
  // PRO → driver attribution for reviews the source left unattributed, resolved
  // via NuVizz. { [pro]: { driverId, driverName, status } }
  const [attrib, setAttrib] = useState(() => readAttrCache());
  const [resolving, setResolving] = useState(0); // # of PROs still resolving
  // How the comment list is ordered, and how many of it are shown.
  const [reviewSort, setReviewSort] = useState("newest");
  const [showAll, setShowAll] = useState(false);
  const [printScope, setPrintScope] = useState("");   // "" = every driver
  const [printing, setPrinting] = useState(false);
  // Period the whole page is scoped to — the same pills every other tab uses, so a
  // range means the same thing here as it does there. Defaults wide (12M) because
  // reviews are sparse and a 30-day default would look like most of them vanished.
  const [periodSel, setPeriodSel] = useState("12");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [revs, drvs] = await Promise.all([getReviews(), getDrivers()]);
        setAllReviews(revs);
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

  const win = useMemo(
    () => periodWindow(periodSel, rangeFrom, rangeTo),
    [periodSel, rangeFrom, rangeTo],
  );
  const periodText = useMemo(
    () => periodLabel(periodSel, rangeFrom, rangeTo),
    [periodSel, rangeFrom, rangeTo],
  );
  // Everything below counts THIS window: the KPIs, the distribution, the by-driver
  // table, the comment list and the report. One control, one answer.
  const reviews = useMemo(
    () =>
      allReviews.filter((r) => {
        const d = String(r.submittedAt || "").slice(0, 10);
        return d && d >= win.start && d <= win.end;
      }),
    [allReviews, win],
  );

  // PRO -> customer from what's already in Firestore. Costs nothing: these are the
  // incidents the app has loaded anyway, and a reviewed delivery is often one we
  // already have on record.
  const customerFromIncidents = useMemo(() => {
    const m = new Map();
    for (const i of incidents) {
      const pro = String(i.pro_number || "").trim();
      if (!pro || m.has(pro)) continue;
      const name = String(i.customer || "").trim();
      if (!name) continue;
      m.set(pro, {
        name,
        place: [i.to_city, i.to_state].filter(Boolean).join(", "),
      });
    }
    return m;
  }, [incidents]);

  // Resolve the delivering driver for each unattributed review by looking up its
  // PRO in NuVizz and matching the driver name to the roster. Cached per-PRO so
  // it only hits NuVizz once per PRO per browser; pass force=true to re-check.
  async function resolveAttributions(revs, drvs, force = false) {
    if (force) {
      setAttrib({});
      writeAttrCache({});
    }
    const cache = force ? {} : readAttrCache();
    // Look a PRO up when we're missing EITHER the driver or the customer. Before,
    // a review that arrived with a driver was never looked up, so it could never
    // show a customer — and the customer rides along in the same response, so
    // resolving it costs no extra call for the ones already being fetched.
    const pending = [
      ...new Set(
        revs
          .filter(
            (r) =>
              r.proNumber &&
              (!sourceHasDriver(r) || !customerFromIncidents.has(String(r.proNumber).trim())),
          )
          .map((r) => r.proNumber),
      ),
    ].filter((pro) => force || !(pro in cache) || !cache[pro]?.customer);
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
            // The customer was always in this response; it was just being dropped.
            const customer = String(res?.stop?.to?.name || "").trim();
            const place = [res?.stop?.to?.city, res?.stop?.to?.state]
              .filter(Boolean)
              .join(", ");
            const d = matchDriver(name, drvs);
            if (d)
              return [pro, { driverId: d.id, driverName: d.name, nuvizzName: name, customer, place, status: "resolved" }];
            if (name)
              return [pro, { driverId: "", driverName: "", nuvizzName: name, customer, place, status: "unmatched" }];
            return [pro, { driverId: "", driverName: "", nuvizzName: "", customer, place, status: "none" }];
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
  // Firestore first, then whatever the PRO lookup brought back.
  const customerFor = (r) => {
    const pro = String(r.proNumber || "").trim();
    const local = customerFromIncidents.get(pro);
    if (local) return local;
    const a = attrib[pro];
    return a?.customer ? { name: a.customer, place: a.place || "" } : null;
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

  const REVIEW_SORTS = [
    ["newest", "Newest"],
    ["oldest", "Oldest"],
    ["lowest", "Lowest rated"],
    ["highest", "Highest rated"],
  ];
  const PAGE = 50;

  // Ordered comment list. Rating sorts break ties by date so an equal-star run still
  // reads chronologically rather than in whatever order the source happened to send.
  const sortedReviews = useMemo(() => {
    const t = (r) => new Date(r.submittedAt || 0).getTime();
    const arr = [...reviews];
    arr.sort((a, b) => {
      if (reviewSort === "oldest") return t(a) - t(b);
      if (reviewSort === "lowest")
        return (a.rating || 0) - (b.rating || 0) || t(b) - t(a);
      if (reviewSort === "highest")
        return (b.rating || 0) - (a.rating || 0) || t(b) - t(a);
      return t(b) - t(a);
    });
    return arr;
  }, [reviews, reviewSort]);

  // The list is capped by default, but the cap is stated and liftable — silently
  // truncating is how you end up trusting a list that isn't the whole list.
  const recent = useMemo(
    () => (showAll ? sortedReviews : sortedReviews.slice(0, PAGE)),
    [sortedReviews, showAll]
  );

  // Reviews as the report wants them: the driver and customer this view resolved,
  // not the bare PRO the source sends.
  const reportRows = (revs) =>
    revs.map((r) => ({
      ...r,
      driverName: driverFor(r) || "Unattributed",
      customer: customerFor(r)?.name || "",
    }));

  async function printReviews() {
    setPrinting(true);
    try {
      const scoped = printScope
        ? sortedReviews.filter((r) => (driverFor(r) || "Unattributed") === printScope)
        : sortedReviews;
      const doc = await generateReviewsReport({
        title: printScope || "All Drivers",
        subtitle: `${scoped.length} review${scoped.length === 1 ? "" : "s"}`,
        periodText,
        rangeText: win.start && win.end ? `${win.start} to ${win.end}` : "",
        reviews: reportRows(scoped),
      });
      doc.save(reviewsReportFilename(printScope || "All Drivers"));
    } catch (e) {
      alert("Could not build the report: " + (e?.message || e));
    } finally {
      setPrinting(false);
    }
  }

  // One PDF, every driver in turn, each starting on a fresh page.
  async function printAllDriverReviews() {
    setPrinting(true);
    try {
      const names = sortedDrivers.map((d) => d.driver);
      let doc = null;
      for (const name of names) {
        const scoped = sortedReviews.filter(
          (r) => (driverFor(r) || "Unattributed") === name,
        );
        if (!scoped.length) continue;
        doc = await generateReviewsReport({
          title: name,
          subtitle: `${scoped.length} review${scoped.length === 1 ? "" : "s"}`,
          periodText,
          rangeText: win.start && win.end ? `${win.start} to ${win.end}` : "",
          reviews: reportRows(scoped),
          doc,
        });
      }
      if (!doc) {
        alert("No reviews to print.");
        return;
      }
      doc.save(reviewsReportFilename("All Drivers by driver"));
    } catch (e) {
      alert("Could not build the report: " + (e?.message || e));
    } finally {
      setPrinting(false);
    }
  }

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
            onClick={() => resolveAttributions(allReviews, drivers, true)}
            disabled={resolving > 0 || loading}
            title="Re-check every unattributed review's driver from NuVizz"
          >
            Re-attribute
          </button>
          <select
            value={printScope}
            onChange={(e) => setPrintScope(e.target.value)}
            aria-label="Driver to print reviews for"
            style={{ maxWidth: 210 }}
          >
            <option value="">All drivers</option>
            {sortedDrivers.map((d) => (
              <option key={d.driver} value={d.driver}>
                {d.driver} ({d.count})
              </option>
            ))}
          </select>
          <button
            className="btn primary sm"
            onClick={printReviews}
            disabled={printing || loading || !reviews.length}
            title="PDF of these reviews, in the order shown"
          >
            {printing ? "Building PDF…" : "📄 Print reviews"}
          </button>
          <button
            className="btn ghost sm"
            onClick={printAllDriverReviews}
            disabled={printing || loading || !reviews.length}
            title="One PDF with every driver's reviews — each driver starts on a new page"
          >
            📄 Print all by driver
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap", minWidth: 0 }}>
        <div className="month-picker" style={{ margin: 0 }}>
          {PERIODS.map(([val, label]) => (
            <button
              key={val}
              className={`month-btn ${periodSel === val ? "active" : ""}`}
              onClick={() => setPeriodSel(val)}
            >
              {label}
            </button>
          ))}
        </div>
        {periodSel === "range" && (
          <div className="custom-range">
            <input
              type="date"
              value={rangeFrom}
              max={toYMD(new Date())}
              onChange={(e) => setRangeFrom(e.target.value)}
            />
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-2)" }}>to</span>
            <input
              type="date"
              value={rangeTo}
              max={toYMD(new Date())}
              onChange={(e) => setRangeTo(e.target.value)}
            />
          </div>
        )}
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
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #eef1f5", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#0a2744" }}>
            Recent Reviews
            <span style={{ fontWeight: 400, color: "#97a3b3" }}>
              {" "}· showing {recent.length} of {sortedReviews.length}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <div className="month-picker" style={{ margin: 0 }}>
              {REVIEW_SORTS.map(([val, label]) => (
                <button
                  key={val}
                  className={`month-btn ${reviewSort === val ? "active" : ""}`}
                  onClick={() => setReviewSort(val)}
                >
                  {label}
                </button>
              ))}
            </div>
            {sortedReviews.length > PAGE && (
              <button className="btn ghost sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? `Show first ${PAGE}` : `Show all ${sortedReviews.length}`}
              </button>
            )}
          </span>
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
                  {/* Who the delivery was FOR. A review only carries a PRO, so this
                      is resolved from the incident record or the PRO lookup. */}
                  {customerFor(r) && (
                    <span style={{ fontSize: "12px", color: "#3c4858" }}>
                      {customerFor(r).name}
                      {customerFor(r).place && (
                        <span style={{ color: "#97a3b3" }}> · {customerFor(r).place}</span>
                      )}
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
