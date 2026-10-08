import { useState, useEffect, useMemo, useRef } from "react";
import { getReviews } from "../data/reviews.js";
import {
  getDrivers,
  getHiddenReviews,
  hideReview,
  unhideReview,
} from "../data/firebase.js";
import { fetchStopData } from "../parsers/nuvizzClient.js";
import { matchDriver } from "../data/driverMatch.js";
import {
  generateReviewsReport,
  reviewsReportFilename,
  fmtReviewDate,
} from "../reports/reviewsReport.js";
import { getBrandLogo, setBrandLogo } from "../reports/brandLogo.js";
import { PERIODS, periodWindow, periodLabel, toYMD, etDay } from "../data/period.js";
import { clickStatus, clickLabel, rollupClicks, fmtRate } from "../data/reviewClicks.js";
import StatTile, { TileStrip } from "./kit/StatTile.jsx";
import BarList from "./kit/charts/BarList.jsx";
import Icon from "./kit/Icon.jsx";
import CardMenu from "./kit/CardMenu.jsx";
import { PRESET_TEXT, useActiveInView } from "./kit/PeriodBar.jsx";

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

const ACCENT = "#234294";
const GREEN = "#15803d";
const AMBER = "#b45309";
const RED = "#b91c1c";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// The business day the review was submitted — the same day the period filter and the
// printed report use. This used to render in the BROWSER's timezone while the filter
// bucketed by the UTC day and the click times were pinned to ET: three answers for
// one review, and an evening review showing a date the filter disagreed with.
function fmtDate(iso) {
  const ymd = etDay(iso);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso ? String(iso) : "—";
  return `${MONTH_ABBR[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Click stamps are worth the time of day — "they took the link four minutes after the
// delivery" and "they took it the next morning off the follow-up email" are different facts.
function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return iso;
  }
}

// How the Google hand-off ended, as a pill. Grey is deliberate for the two statuses that
// mean "we cannot say" — only an observed click earns green, and only an observed
// non-click earns amber.
const CLICK_TONE = {
  clicked: { fg: "#15803d", bg: "#e7f4ec", bd: "#cce8d6" },
  "not-taken": { fg: "#b45309", bg: "#fdf3e3", bd: "#f0dfbe" },
  "not-tracked": { fg: "#8b95a3", bg: "#f4f6f8", bd: "#e3e8ee" },
  unreadable: { fg: "#8b95a3", bg: "#f4f6f8", bd: "#e3e8ee" },
  internal: { fg: "#8b95a3", bg: "#f4f6f8", bd: "#e3e8ee" },
};

function ClickBadge({ status, title }) {
  const t = CLICK_TONE[status] || CLICK_TONE.internal;
  return (
    <span
      title={title}
      style={{
        fontSize: "10px",
        fontWeight: 700,
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.bd}`,
        borderRadius: "4px",
        padding: "1px 6px",
        whiteSpace: "nowrap",
      }}
    >
      {clickLabel(status)}
    </span>
  );
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
// Star filters. They scope what is LISTED and PRINTED, never the headline stats: a
// 5-star-only page whose summary also read "5.00 / 5 · 100%" would be a filtered list
// presented as the period's record.
const RATING_FILTERS = [
  ["all", "All stars"],
  ["high", "4★+"],
  ["5", "5★"],
  ["4", "4★"],
  ["3", "3★"],
  ["2", "2★"],
  ["1", "1★"],
  ["low", "≤3★"],
];

const matchesRating = (r, f) => {
  const n = r.rating || 0;
  if (f === "all") return true;
  if (f === "high") return n >= 4;
  if (f === "low") return n <= 3;
  return n === Number(f);
};

const ratingFilterLabel = (f) =>
  (RATING_FILTERS.find(([v]) => v === f) || [])[1] || "All stars";

// "Clicked through" is as far as we can see: the whole of it, in that tile's hover.
const CLICK_EXPLAINER =
  "It means the customer took the Google link from the tracking portal. Whether they then signed in and posted happens on Google, and Google tells us nothing — so a click is evidence they went, not proof a review exists. Reviews submitted before click tracking existed carry no click record either way and are left out of the rate.";

export default function Reviews({ incidents = [] }) {
  const [allReviews, setAllReviews] = useState([]);
  // Whether the source could read its Google-click store on this load. true / false / null
  // (unknown). Never defaulted to true: see src/data/reviewClicks.js.
  const [clicksReadable, setClicksReadable] = useState(null);
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
  // Which star ratings are listed and printed. "all", "high" (4★+), "low" (≤3★) or a
  // single star as "5".."1". It scopes the comment list and the PDF, never the
  // headline stats — see RATING_FILTERS.
  // Persisted (not just in-memory): the filter used to silently reset to "All stars"
  // on every reload, so a report printed after reopening the tab could carry every
  // rating without any visual sign the filter had dropped.
  const [ratingFilter, setRatingFilter] = useState(() => {
    try {
      return localStorage.getItem("dds_review_rating_filter") || "all";
    } catch {
      return "all";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("dds_review_rating_filter", ratingFilter);
    } catch {
      /* quota / private mode — ignore */
    }
  }, [ratingFilter]);
  // Reviews suppressed as invalid (test rows, wrong carrier, duplicates). Shared via
  // Firestore, so hiding one hides it for everybody.
  const [hidden, setHidden] = useState([]);
  const [showHidden, setShowHidden] = useState(false);
  const [busyHide, setBusyHide] = useState("");
  const [printScope, setPrintScope] = useState("");   // "" = every driver
  const [printing, setPrinting] = useState(false);
  // The logo the printed report puts in its banner, kept in this browser.
  const [logo, setLogo] = useState(() => getBrandLogo());
  // The hidden file input behind the More menu's "Add logo".
  const logoInput = useRef(null);
  // Period the whole page is scoped to — the same pills every other tab uses, so a
  // range means the same thing here as it does there. Defaults wide (12M) because
  // reviews are sparse and a 30-day default would look like most of them vanished.
  const [periodSel, setPeriodSel] = useState("12");
  // On a phone the presets scroll sideways: the picked one is kept in view.
  const periodRow = useActiveInView(periodSel);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [payload, drvs, hid] = await Promise.all([
          getReviews(),
          getDrivers(),
          getHiddenReviews(),
        ]);
        setHidden(hid);
        const revs = payload.reviews || [];
        setAllReviews(revs);
        setClicksReadable(payload.clicksReadable);
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
  const hiddenIds = useMemo(() => new Set(hidden.map((h) => String(h.id))), [hidden]);

  // Everything below counts THIS window: the KPIs, the distribution, the by-driver
  // table, the comment list and the report. One control, one answer. Reviews hidden
  // as invalid are dropped here, so no count anywhere on the page includes them.
  const reviews = useMemo(
    () =>
      allReviews.filter((r) => {
        if (hiddenIds.has(String(r.id))) return false;
        // The ET day it was submitted, not the UTC prefix: an evening review is
        // stored as tomorrow in UTC and would fall outside the window it belongs to.
        const d = etDay(r.submittedAt);
        return d && d >= win.start && d <= win.end;
      }),
    [allReviews, win, hiddenIds],
  );

  // The hidden rows that fall in the window, so the "Hidden" panel shows what was
  // taken out of THIS period rather than all of history.
  const hiddenInWindow = useMemo(() => {
    const byId = new Map(allReviews.map((r) => [String(r.id), r]));
    return hidden
      .map((h) => ({ ...h, review: byId.get(String(h.id)) }))
      .filter((h) => {
        const d = etDay(h.review?.submittedAt || h.submitted_at);
        return d && d >= win.start && d <= win.end;
      });
  }, [hidden, allReviews, win]);

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
    const internal = reviews.filter((r) => r.routedTo === "internal").length;
    const dist = [1, 2, 3, 4, 5].map((star) => reviews.filter((r) => r.rating === star).length);
    // shown / clicked / rate. `shown` is what the old "4★+ (→ Google)" tile counted, and on
    // its own it is just a restatement of the rating — it was never a count of customers
    // who went. `clicked` is the observed one.
    const clicks = rollupClicks(reviews, clicksReadable);
    return { n, avg, internal, dist, clicks };
  }, [reviews, clicksReadable]);

  // Per-driver rollup. Uses the PRO-attributed driver when the source left one
  // blank; anything still unresolved buckets as "Unattributed".
  const byDriver = useMemo(() => {
    const map = new Map();
    for (const r of reviews) {
      const key = driverFor(r) || "Unattributed (PRO only)";
      if (!map.has(key)) map.set(key, { driver: key, count: 0, sum: 0, low: 0, last: "", rows: [] });
      const d = map.get(key);
      d.count += 1;
      d.sum += r.rating || 0;
      d.rows.push(r);
      if ((r.rating || 0) <= 3) d.low += 1;
      if (!d.last || new Date(r.submittedAt) > new Date(d.last)) d.last = r.submittedAt;
    }
    return Array.from(map.values()).map((d) => {
      const c = rollupClicks(d.rows, clicksReadable);
      return {
        ...d,
        avg: d.count ? d.sum / d.count : 0,
        clicked: c.clicked,
        trackable: c.trackable,
        clickRate: c.rate,
        clicksAnswerable: c.answerable,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, attrib, clicksReadable]);

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
  // What the list and the report actually carry: the window, minus hidden, minus
  // anything the star filter excludes.
  const filteredReviews = useMemo(
    () => reviews.filter((r) => matchesRating(r, ratingFilter)),
    [reviews, ratingFilter],
  );

  const sortedReviews = useMemo(() => {
    const t = (r) => new Date(r.submittedAt || 0).getTime();
    const arr = [...filteredReviews];
    arr.sort((a, b) => {
      if (reviewSort === "oldest") return t(a) - t(b);
      if (reviewSort === "lowest")
        return (a.rating || 0) - (b.rating || 0) || t(b) - t(a);
      if (reviewSort === "highest")
        return (b.rating || 0) - (a.rating || 0) || t(b) - t(a);
      return t(b) - t(a);
    });
    return arr;
  }, [filteredReviews, reviewSort]);

  // The list is capped by default, but the cap is stated and liftable — silently
  // truncating is how you end up trusting a list that isn't the whole list.
  const recent = useMemo(
    () => (showAll ? sortedReviews : sortedReviews.slice(0, PAGE)),
    [sortedReviews, showAll]
  );

  // The window, printed the way every other date on the report is printed.
  const rangeText =
    win.start && win.end ? `${fmtReviewDate(win.start)} to ${fmtReviewDate(win.end)}` : "";

  // Reviews as the report wants them: the driver and customer this view resolved,
  // not the bare PRO the source sends.
  const reportRows = (revs) =>
    revs.map((r) => ({
      ...r,
      driverName: driverFor(r) || "Unattributed",
      customer: customerFor(r)?.name || "",
    }));

  // Read the picked file as a data URI: jsPDF needs the bytes at print time, and a
  // blob URL wouldn't survive a reload.
  function onPickLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a remove
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      alert("Please pick a PNG, JPG, GIF or WEBP image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const uri = String(reader.result || "");
      if (!setBrandLogo(uri)) {
        alert("Couldn't save the logo in this browser (storage is full or blocked).");
        return;
      }
      setLogo(uri);
    };
    reader.onerror = () => alert("Couldn't read that image.");
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setBrandLogo("");
    setLogo("");
  }

  async function onHideReview(r) {
    const reason = window.prompt(
      `Hide this ${r.rating || "?"}★ review from ${driverFor(r) || "Unattributed"}?\n\nIt stops counting everywhere — KPIs, the by-driver table and every printed report — and can be restored from "Hidden" below.\n\nReason (optional):`,
      "",
    );
    if (reason === null) return; // cancelled
    setBusyHide(r.id);
    try {
      await hideReview({ ...r, driverName: driverFor(r), customer: customerFor(r)?.name || "" }, reason);
      setHidden((prev) => [
        ...prev.filter((h) => String(h.id) !== String(r.id)),
        {
          id: r.id,
          review_id: r.id,
          reason,
          rating: r.rating,
          driver: driverFor(r) || "",
          customer: customerFor(r)?.name || "",
          submitted_at: r.submittedAt,
        },
      ]);
    } catch (e) {
      alert("Could not hide that review: " + (e?.message || e));
    } finally {
      setBusyHide("");
    }
  }

  async function onUnhideReview(id) {
    setBusyHide(id);
    try {
      await unhideReview(id);
      setHidden((prev) => prev.filter((h) => String(h.id) !== String(id)));
    } catch (e) {
      alert("Could not restore that review: " + (e?.message || e));
    } finally {
      setBusyHide("");
    }
  }

  async function printReviews() {
    setPrinting(true);
    try {
      const inScope = (r) => !printScope || (driverFor(r) || "Unattributed") === printScope;
      const scoped = sortedReviews.filter(inScope);
      const doc = await generateReviewsReport({
        title: printScope || "All Drivers",
        subtitle: `${scoped.length} review${scoped.length === 1 ? "" : "s"}`,
        periodText,
        rangeText,
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
        const mine = (r) => (driverFor(r) || "Unattributed") === name;
        const scoped = sortedReviews.filter(mine);
        if (!scoped.length) continue;
        doc = await generateReviewsReport({
          title: name,
          subtitle: `${scoped.length} review${scoped.length === 1 ? "" : "s"}`,
          periodText,
          rangeText,
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
        fontSize: "12px",
        fontWeight: 500,
        color: "#6b7280",
        borderBottom: "1px solid #eef1f5",
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
        {/* The shared page header (an overline, then the title with its sub-line), as on
            every other page. */}
        <div style={{ minWidth: 0 }}>
          <div className="page-title">Customer feedback</div>
          <h1 className="page-heading" style={{ marginBottom: 0 }}>
            Reviews
            <span className="meta">
              <span className="meta-sep">· </span>delivery ratings from the tracking portal, attributed to the driver by PRO
            </span>
          </h1>
        </div>
        <div className="rv-actions">
          {resolving > 0 && (
            <span style={{ fontSize: "12px", color: "#97a3b3" }}>
              Attributing {resolving} PRO{resolving === 1 ? "" : "s"}…
            </span>
          )}
          {/* One primary action — Print — with the driver it prints for; the rest wait
              behind More, each named in three words or fewer. */}
          <select
            value={printScope}
            onChange={(e) => setPrintScope(e.target.value)}
            aria-label="Driver to print reviews for"
            className="rv-scope"
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
            title={`PDF of these reviews (${ratingFilterLabel(ratingFilter)}), in the order shown`}
          >
            <Icon name="printer" />
            {printing ? "Building PDF…" : "Print"}
          </button>
          <CardMenu
            text="More"
            label="More actions"
            items={[
              {
                id: "by-driver",
                label: "Print by driver",
                icon: "printer",
                disabled: printing || loading || !reviews.length,
                title: `One PDF with every driver's reviews (${ratingFilterLabel(ratingFilter)}) — each driver starts on a new page`,
                onSelect: printAllDriverReviews,
              },
              {
                id: "reattribute",
                label: "Re-attribute",
                icon: "refresh-cw",
                disabled: resolving > 0 || loading,
                title: "Re-check every unattributed review's driver from NuVizz",
                onSelect: () => resolveAttributions(allReviews, drivers, true),
              },
              {
                id: "logo",
                label: logo ? "Change logo" : "Add logo",
                icon: "image-plus",
                title: "The logo printed in the report banner (PNG or JPG). Saved in this browser.",
                onSelect: () => logoInput.current?.click(),
              },
              ...(logo
                ? [{ id: "logo-off", label: "Remove logo", icon: "x", title: "Print the default D mark instead", onSelect: removeLogo }]
                : []),
            ]}
          />
          <input ref={logoInput} type="file" accept="image/*" onChange={onPickLogo} style={{ display: "none" }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", flexWrap: "wrap", minWidth: 0 }}>
        <div className="month-picker" style={{ margin: 0 }} ref={periodRow}>
          {PERIODS.map(([val, label]) => (
            <button
              key={val}
              className={`month-btn ${periodSel === val ? "active" : ""}`}
              onClick={() => setPeriodSel(val)}
            >
              {PRESET_TEXT[val] || label}
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
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>to</span>
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

      {/* Headline tiles. Zero and "—" are ink, never red: an empty period is not an
          alarm — and it keeps its total alone, not a row of zeros and dashes over the
          empty card below. */}
      <TileStrip
        className="card-strip"
        footer={
          /* What a click can and can't tell, as one quiet line inside the tile card (the
             whole of it in the Clicked through tile's hover). Only a click store that
             failed to read is a failure, and says so in red; one that didn't report is
             unknown, said plainly. */
          <>
            <span>
              Clicked through means the customer took the Google link — evidence they went, not proof a
              review was posted.
            </span>
            {clicksReadable !== true && (
              <span className={clicksReadable === false ? "rv-note-failed" : undefined}>
                {" "}
                {clicksReadable === false
                  ? "The click store could not be read on this load, so no row below can show a click — not the same as nobody clicking."
                  : "The review source didn't report whether its click store was readable, so clicks are shown as unconfirmed, not absent."}
              </span>
            )}
          </>
        }
      >
        <StatTile label="Total reviews" value={kpis.n} />
        {kpis.n > 0 && (
          <StatTile
            label="Avg rating"
            value={kpis.n ? kpis.avg.toFixed(2) : "—"}
            sub={kpis.n ? <Stars n={kpis.avg} /> : null}
          />
        )}
        {/* Shown vs clicked, kept apart on purpose. "Shown" is how many customers were
            handed the Google button — it follows from the rating alone and nobody has done
            anything yet. "Clicked through" is the one we actually observed. */}
        {kpis.n > 0 && (
          <StatTile label="Shown Google link" value={kpis.clicks.shown} sub="4★+ · offered, not taken yet" />
        )}
        {/* A 0 during a click-store outage would be the same false confidence this screen
            exists to remove — every tracked row looks un-clicked when the store is down.
            Withhold the count, do not print a zero. */}
        {kpis.n > 0 && (
          <StatTile
            label="Clicked through"
            title={CLICK_EXPLAINER}
            value={kpis.clicks.answerable ? kpis.clicks.clicked : "—"}
            sub={
              !kpis.clicks.answerable
                ? "click store unreadable — cannot say"
                : kpis.clicks.untracked > 0
                  ? `${kpis.clicks.untracked} older review${kpis.clicks.untracked === 1 ? "" : "s"} predate tracking`
                  : "observed at the redirect"
            }
          />
        )}
        {kpis.n > 0 && (
          <StatTile
            label="Click-through rate"
            value={fmtRate(kpis.clicks.rate)}
            kind="number"
            sub={kpis.clicks.rate == null ? "not enough tracked reviews" : `${kpis.clicks.clicked} of ${kpis.clicks.trackable} tracked`}
          />
        )}
        {kpis.n > 0 && (
          <StatTile label="3★ or lower" value={kpis.internal} />
        )}
      </TileStrip>

      {/* A period with no reviews is one empty card, not three ("No ratings", "No reviews
          yet" twice). */}
      {kpis.n === 0 ? (
        <div style={card}>
          <div className="empty-state" style={{ padding: "16px 0" }}>
            No reviews in this period.
          </div>
        </div>
      ) : (
      <>
      {/* Rating distribution */}
      <div style={card}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "12px" }}>Rating distribution</div>
        {kpis.n === 0 ? (
          <div className="empty-state" style={{ padding: "16px 0" }}>No ratings in this period.</div>
        ) : (
          <BarList
            rows={[5, 4, 3, 2, 1].map((star) => ({ key: String(star), label: `${star}★`, value: kpis.dist[star - 1] }))}
            order="given"
            limit={0}
            share
            shareOf={kpis.n}
            colorOf={(r) => (Number(r.key) >= 4 ? GREEN : Number(r.key) === 3 ? AMBER : RED)}
            ariaLabel="Rating distribution"
          />
        )}
      </div>

      {/* Per-driver scorecard */}
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div className="card-header">
          <div className="card-title">By driver</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          {/* On a phone each driver is a card (.cards-on-phone): nothing is cut off. */}
          <table className="rv-drivers cards-on-phone" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                <Th k="driver">Driver</Th>
                <Th k="count" right>Reviews</Th>
                <Th k="avg" right>Avg</Th>
                <Th k="low" right>≤3★</Th>
                <Th k="clicked" right>Google</Th>
                <Th k="last" right>Last review</Th>
              </tr>
            </thead>
            <tbody>
              {sortedDrivers.map((d) => (
                <tr key={d.driver} style={{ borderBottom: "1px solid #f1f4f7" }}>
                  <td className="card-primary" style={{ padding: "9px 10px", fontWeight: 600, color: d.driver.startsWith("Unattributed") ? "#97a3b3" : "#0a2744" }}>
                    <span>{d.driver}</span>
                  </td>
                  <td data-label="Reviews" style={{ padding: "9px 10px", textAlign: "right" }}>{d.count}</td>
                  <td data-label="Avg" style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: ratingColor(d.avg) }}>
                    {d.avg.toFixed(2)} <Stars n={d.avg} />
                  </td>
                  <td data-label="≤3★" style={{ padding: "9px 10px", textAlign: "right", color: d.low ? RED : "#5a6779" }}>{d.low}</td>
                  {/* Clicked out of trackable, never out of total — the denominator is the
                      reviews that could show a click at all. */}
                  <td
                    data-label="Google"
                    style={{ padding: "9px 10px", textAlign: "right", color: d.clicked ? GREEN : "#97a3b3", whiteSpace: "nowrap" }}
                    title={
                      !d.clicksAnswerable
                        ? "The click store could not be read on this load"
                        : d.trackable
                          ? `${d.clicked} of ${d.trackable} tracked 4★+ reviews took the Google link`
                          : "No reviews with click tracking yet"
                    }
                  >
                    {d.clicksAnswerable && d.trackable ? `${d.clicked}/${d.trackable}` : "—"}
                    {d.clickRate != null && (
                      <span style={{ color: "#97a3b3", fontWeight: 400 }}> · {fmtRate(d.clickRate)}</span>
                    )}
                  </td>
                  <td data-label="Last review" style={{ padding: "9px 10px", textAlign: "right", color: "#5a6779" }}>{fmtDate(d.last)}</td>
                </tr>
              ))}
              {!sortedDrivers.length && (
                <tr>
                  <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "#97a3b3" }}>No reviews yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent reviews */}
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #eef1f5", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <span className="card-title">
            Recent reviews
            <span style={{ fontWeight: 400, fontSize: "12px", color: "var(--text-2)" }}>
              {" "}· showing {recent.length} of {sortedReviews.length}
              {ratingFilter !== "all"
                ? ` ${ratingFilterLabel(ratingFilter)} · ${reviews.length} in this period`
                : ""}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {/* Stars filter. It scopes this list AND the printed report — the two
                always show the same set, so what you see is what you hand over. */}
            <div className="month-picker" style={{ margin: 0 }} title="Filters this list and the printed report">
              {RATING_FILTERS.map(([val, label]) => (
                <button
                  key={val}
                  className={`month-btn ${ratingFilter === val ? "active" : ""}`}
                  onClick={() => setRatingFilter(val)}
                >
                  {label}
                </button>
              ))}
            </div>
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
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
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
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", color: "#97a3b3" }}>{fmtDate(r.submittedAt)}</span>
                  <button
                    className="btn ghost sm"
                    onClick={() => onHideReview(r)}
                    disabled={busyHide === r.id}
                    title="Not a valid review — stop counting it anywhere, keep it restorable"
                  >
                    {busyHide === r.id ? "…" : "Hide"}
                  </button>
                </span>
              </div>
              {r.comment && <div style={{ fontSize: "13px", color: "#3c4858", marginTop: "6px" }}>{r.comment}</div>}
              {(r.name || r.contact) && (
                <div style={{ fontSize: "11px", color: "#97a3b3", marginTop: "4px" }}>
                  {r.name}
                  {r.name && r.contact ? " · " : ""}
                  {r.contact}
                </div>
              )}
              {/* Did this customer actually follow the link? Shown only for reviews that
                  were offered Google at all — a 1★ never sees the button, and stamping
                  every complaint "internal only" is noise on a driver scorecard. */}
              {(() => {
                const status = clickStatus(r, clicksReadable);
                if (status === "internal") return null;
                return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                      marginTop: "6px",
                      fontSize: "11px",
                      color: "#97a3b3",
                    }}
                  >
                    <ClickBadge
                      status={status}
                      title={
                        status === "not-tracked"
                          ? "Submitted before click tracking existed — no click record either way"
                          : status === "unreadable"
                            ? "The click store could not be read on this load"
                            : undefined
                      }
                    />
                    {r.googleClickAt && (
                      <span>
                        Took the link {fmtDateTime(r.googleClickAt)}
                        {Number(r.googleClickCount) > 1 ? ` (${Number(r.googleClickCount)}×)` : ""}
                      </span>
                    )}
                    {Number(r.googleClickProbes) > 0 && (
                      <span title="Mail scanners and link-preview bots. Recorded, deliberately not counted as clicks.">
                        {Number(r.googleClickProbes)} bot fetch
                        {Number(r.googleClickProbes) > 1 ? "es" : ""} (not counted)
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
          {!recent.length && (
            <div style={{ padding: "24px", textAlign: "center", color: "#97a3b3" }}>
              {ratingFilter === "all"
                ? "No reviews yet."
                : `No ${ratingFilterLabel(ratingFilter)} reviews in this period.`}
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {/* Hidden reviews. Nothing is deleted — a suppressed review keeps its reason and
          comes back with one click, because "this one doesn't count" is a judgement
          somebody should be able to check and reverse. */}
      {hiddenInWindow.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "12px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              borderBottom: showHidden ? "1px solid #eef1f5" : "none",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#0a2744" }}>
              Hidden
              <span style={{ fontWeight: 400, color: "#97a3b3" }}>
                {" "}· {hiddenInWindow.length} review{hiddenInWindow.length === 1 ? "" : "s"} in
                this period are excluded from every count and report
              </span>
            </span>
            <button className="btn ghost sm" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? "Collapse" : "Show"}
            </button>
          </div>
          {showHidden &&
            hiddenInWindow.map((h) => (
              <div
                key={h.id}
                style={{
                  padding: "10px 18px",
                  borderBottom: "1px solid #f1f4f7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <Stars n={h.rating || h.review?.rating || 0} />
                  <span style={{ fontWeight: 600, color: "#5a6779" }}>
                    {h.driver || h.review?.driver || "Unattributed"}
                  </span>
                  {(h.customer || h.review?.customer) && (
                    <span style={{ fontSize: "12px", color: "#97a3b3" }}>
                      {h.customer || h.review?.customer}
                    </span>
                  )}
                  <span style={{ fontSize: "12px", color: "#97a3b3" }}>
                    {fmtDate(h.submitted_at || h.review?.submittedAt)}
                  </span>
                  {h.reason && (
                    <span style={{ fontSize: "12px", color: "#5a6779", fontStyle: "italic" }}>
                      "{h.reason}"
                    </span>
                  )}
                </span>
                <button
                  className="btn ghost sm"
                  onClick={() => onUnhideReview(h.id)}
                  disabled={busyHide === h.id}
                >
                  {busyHide === h.id ? "…" : "Restore"}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
