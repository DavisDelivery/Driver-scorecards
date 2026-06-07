/**
 * excelParser.js
 * Parses Uline weekly Excel reports (Laters, Returns, Traces).
 * Uses SheetJS (xlsx) to read workbooks, detects sheet type by headers,
 * and produces normalized incident records.
 */

import * as XLSX from "xlsx";
import { classifyFault } from "../data/drivers.js";

// PRO number pattern: 9-digit number starting with "00"
const PRO_RE = /\b(00\d{7})\b/;

// Category precedence used during deduplication (higher = wins)
const CATEGORY_PRECEDENCE = {
  damage: 100,
  missing: 90,
  misdelivery: 80,
  forgotten_freight: 70,
  return: 60,
  late: 50,
  trace: 40,
  complaint: 30,
  compliment: 20,
  other: 10,
};

// Map internal per-sheet source tags → normalized Uline report ids.
const SOURCE_MAP = {
  excel_laters: "laters",
  excel_returns: "returns",
  excel_traces: "traces",
};

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Normalize a header string for comparison: lowercase, alphanum only */
function normalizeHeader(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Find the index of the first column header matching any of the given keys.
 * Falls back to -1 if none found.
 */
function findCol(headers, keys) {
  for (const key of keys) {
    const idx = headers.findIndex((h) => normalizeHeader(h) === key);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Scan the first 5 rows to locate the true header row.
 * Returns the row index where at least 2 expected header keywords appear.
 */
function findHeaderRow(aoa) {
  const expected = ["pro", "shipdate", "dateshipped", "tracedate", "returndate", "dayslate"];
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const normalized = (aoa[i] || []).map(normalizeHeader);
    if (normalized.filter((h) => expected.some((e) => h.includes(e))).length >= 2) return i;
  }
  return 0;
}

/**
 * Convert an Excel serial date number or "M/D/YY" string to "YYYY-MM-DD".
 * Returns null if unparseable.
 */
function parseDate(val) {
  if (val == null || val === "") return null;

  if (typeof val === "number") {
    const ms = Math.round((val - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d)) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }

  const m = String(val)
    .trim()
    .match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let [, month, day, year] = m;
  if (year.length === 2) year = "20" + year;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Detect the sheet type from its header row.
 * Returns "laters" | "returns" | "traces" | "unknown".
 */
function detectSheetType(headers) {
  const norm = headers.map(normalizeHeader);
  if (norm.some((h) => h === "tracepro") && norm.some((h) => h === "tracedate")) return "traces";
  if (
    norm.some((h) => h === "returndate") ||
    norm.some((h) => h === "returncomments") ||
    norm.some((h) => h === "frtid")
  )
    return "returns";
  if (norm.some((h) => h === "dayslate") || norm.some((h) => h === "expecteddeliverydate"))
    return "laters";
  return "unknown";
}

/**
 * Merge multiple non-empty, non-duplicate text fragments into one string,
 * joining with " / ". Case-insensitive deduplication.
 */
function mergeText(...parts) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    const s = String(p).trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out.join(" / ");
}

// ---------------------------------------------------------------------------
// Classify return / trace categories from reason text
// ---------------------------------------------------------------------------

function classifyReturnCategory(reason = "") {
  const r = reason.toLowerCase();
  if (r.includes("damage")) return "damage";
  if (r.includes("lost")) return "missing";
  if (r.includes("did not deliver") || r.includes("not deliver")) return "return";
  if (r.includes("address") || r.includes("misdeliver")) return "misdelivery";
  return "return";
}

function classifyTraceCategory(reason = "") {
  const r = reason.toLowerCase();
  if (r.includes("damage")) return "damage";
  if (r.includes("wrong address") || r.includes("misdeliver")) return "misdelivery";
  if (r.includes("missing")) return "missing";
  if (r.includes("late") || r.includes("eta")) return "late";
  if (r.includes("carrier fault")) return "damage";
  return "trace";
}

// ---------------------------------------------------------------------------
// Sheet parsers (one per sheet type)
// ---------------------------------------------------------------------------

function parseLaters(aoa) {
  const headerIdx = findHeaderRow(aoa);
  const headers = aoa[headerIdx] || [];
  const cols = {
    cust: findCol(headers, ["cust"]),
    shipTo: findCol(headers, ["shipto"]),
    order: findCol(headers, ["order"]),
    pro: findCol(headers, ["pro"]),
    terminal: findCol(headers, ["terminal"]),
    whse: findCol(headers, ["whse"]),
    via: findCol(headers, ["via"]),
    zip: findCol(headers, ["zipcode", "zip"]),
    state: findCol(headers, ["state"]),
    service: findCol(headers, ["servicetype"]),
    shipped: findCol(headers, ["dateshipped"]),
    expected: findCol(headers, ["expecteddeliverydate"]),
    delivered: findCol(headers, ["delivereddate"]),
    daysLate: findCol(headers, ["dayslate"]),
    respCat: findCol(headers, ["responsecategory"]),
    response: findCol(headers, ["response"]),
    respDate: findCol(headers, ["responsedate"]),
  };

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const proMatch = String(row[cols.pro] || "")
      .trim()
      .match(PRO_RE);
    if (!proMatch) continue;

    const respCat = String(row[cols.respCat] || "").trim();
    const response = String(row[cols.response] || "").trim();

    rows.push({
      pro_number: proMatch[1],
      cust_number: String(row[cols.cust] || "").trim(),
      shipto_number: String(row[cols.shipTo] || "").trim(),
      order_number: String(row[cols.order] || "").trim(),
      terminal: String(row[cols.terminal] || "").trim(),
      warehouse: String(row[cols.whse] || "").trim(),
      via: String(row[cols.via] || "").trim(),
      zip_code: String(row[cols.zip] || "").trim(),
      state: String(row[cols.state] || "").trim(),
      service_type: String(row[cols.service] || "").trim(),
      date_shipped: parseDate(row[cols.shipped]),
      expected_delivery: parseDate(row[cols.expected]),
      delivered_date: parseDate(row[cols.delivered]),
      days_late: Number(row[cols.daysLate]) || null,
      response_category: respCat,
      response: response,
      response_date: parseDate(row[cols.respDate]),
      notes: [respCat, response].filter(Boolean).join(": "),
      category: "late",
    });
  }
  return rows;
}

function parseReturns(aoa) {
  const headerIdx = findHeaderRow(aoa);
  const headers = aoa[headerIdx] || [];
  const cols = {
    cust: findCol(headers, ["cust"]),
    pro: findCol(headers, ["pro"]),
    shipDate: findCol(headers, ["shipdate"]),
    terminal: findCol(headers, ["terminal"]),
    whse: findCol(headers, ["whse"]),
    via: findCol(headers, ["via"]),
    zip: findCol(headers, ["zipcode", "zip"]),
    service: findCol(headers, ["servicetype"]),
    picker: findCol(headers, ["pickerid"]),
    packer: findCol(headers, ["packerid"]),
    frtId: findCol(headers, ["frtid"]),
    retDate: findCol(headers, ["returndate"]),
    reason: findCol(headers, ["reason"]),
    item: findCol(headers, ["item"]),
    comments: findCol(headers, ["returncomments", "comments"]),
  };

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const proMatch = String(row[cols.pro] || "")
      .trim()
      .match(PRO_RE);
    if (!proMatch) continue;

    const reason = String(row[cols.reason] || "").trim() || "Return";
    const comments = String(row[cols.comments] || "").trim();

    rows.push({
      pro_number: proMatch[1],
      cust_number: String(row[cols.cust] || "").trim(),
      ship_date: parseDate(row[cols.shipDate]),
      terminal: String(row[cols.terminal] || "").trim(),
      warehouse: String(row[cols.whse] || "").trim(),
      via: String(row[cols.via] || "").trim(),
      zip_code: String(row[cols.zip] || "").trim(),
      service_type: String(row[cols.service] || "").trim(),
      picker_id: String(row[cols.picker] || "").trim(),
      packer_id: String(row[cols.packer] || "").trim(),
      freight_id: String(row[cols.frtId] || "").trim(),
      return_date: parseDate(row[cols.retDate]),
      reason,
      item_number: String(row[cols.item] || "").trim(),
      comments,
      notes: comments,
      category: classifyReturnCategory(reason),
    });
  }
  return rows;
}

function parseTraces(aoa) {
  const headerIdx = findHeaderRow(aoa);
  const headers = aoa[headerIdx] || [];
  const cols = {
    cust: findCol(headers, ["cust"]),
    order: findCol(headers, ["order"]),
    pro: findCol(headers, ["tracepro", "pro"]),
    terminal: findCol(headers, ["terminal"]),
    whse: findCol(headers, ["whse"]),
    via: findCol(headers, ["via"]),
    service: findCol(headers, ["servicetype"]),
    shipDate: findCol(headers, ["shipdate"]),
    traceDate: findCol(headers, ["tracedate"]),
    reason: findCol(headers, ["tracereason", "reason"]),
    comments: findCol(headers, ["comments"]),
  };

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const proMatch = String(row[cols.pro] || "")
      .trim()
      .match(PRO_RE);
    if (!proMatch) continue;

    const reason = String(row[cols.reason] || "").trim() || "Trace";
    const comments = String(row[cols.comments] || "").trim();

    rows.push({
      pro_number: proMatch[1],
      cust_number: String(row[cols.cust] || "").trim(),
      order_number: String(row[cols.order] || "").trim(),
      terminal: String(row[cols.terminal] || "").trim(),
      warehouse: String(row[cols.whse] || "").trim(),
      via: String(row[cols.via] || "").trim(),
      service_type: String(row[cols.service] || "").trim(),
      ship_date: parseDate(row[cols.shipDate]),
      trace_date: parseDate(row[cols.traceDate]),
      reason,
      comments,
      notes: comments,
      category: classifyTraceCategory(reason),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Read a single File into an array-of-arrays (one sheet)
// ---------------------------------------------------------------------------

async function readFileToAoa(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: true,
    });
    if (aoa.length >= 2) return { aoa, sheetName };
  }
  return { aoa: [], sheetName: null };
}

// ---------------------------------------------------------------------------
// Public: parse an array of File objects
// Returns { files, laters, returns, traces, unknown }
// ---------------------------------------------------------------------------

export async function parseExcelFiles(files) {
  const result = { files: [], laters: [], returns: [], traces: [], unknown: [] };

  for (const file of files) {
    const { aoa, sheetName } = await readFileToAoa(file);

    if (aoa.length < 2) {
      result.files.push({ name: file.name, type: "empty", sheetName, rows: 0 });
      continue;
    }

    const headerIdx = findHeaderRow(aoa);
    const headers = aoa[headerIdx] || [];
    const type = detectSheetType(headers);

    let rows = [];
    if (type === "laters") rows = parseLaters(aoa);
    else if (type === "returns") rows = parseReturns(aoa);
    else if (type === "traces") rows = parseTraces(aoa);

    result.files.push({
      name: file.name,
      type,
      sheetName,
      rows: rows.length,
      headers: headers.slice(0, 10),
    });

    if (type === "laters") result.laters.push(...rows);
    else if (type === "returns") result.returns.push(...rows);
    else if (type === "traces") result.traces.push(...rows);
    else result.unknown.push({ file: file.name, headers });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public: normalize parsed rows into incident records tagged with weekEnding
// Returns an array with ._duplicatesRemoved and ._rawRowCount attached.
// ---------------------------------------------------------------------------

export function buildIncidents(parsed, weekEnding) {
  const now = new Date().toISOString();
  const raw = [];

  for (const row of parsed.laters) {
    raw.push({
      pro_number: row.pro_number,
      category: "late",
      source: "excel_laters",
      cust_number: row.cust_number,
      order_number: row.order_number,
      terminal: row.terminal,
      warehouse: row.warehouse,
      zip_code: row.zip_code,
      state: row.state,
      service_type: row.service_type,
      ship_date: row.date_shipped,
      expected_date: row.expected_delivery,
      delivered_date: row.delivered_date,
      days_late: row.days_late,
      response_category: row.response_category,
      response: row.response,
      reason: row.response_category || "Late",
      notes: row.notes,
      driver_raw: "",
      driver_id: null,
      fault: classifyFault(row.notes, ""),
      week_ending: weekEnding,
      ingested_at: now,
      photo_urls: [],
    });
  }

  for (const row of parsed.returns) {
    raw.push({
      pro_number: row.pro_number,
      category: row.category,
      source: "excel_returns",
      cust_number: row.cust_number,
      terminal: row.terminal,
      warehouse: row.warehouse,
      zip_code: row.zip_code,
      service_type: row.service_type,
      picker_id: row.picker_id,
      packer_id: row.packer_id,
      freight_id: row.freight_id,
      item_number: row.item_number,
      ship_date: row.ship_date,
      return_date: row.return_date,
      reason: row.reason,
      notes: row.notes,
      comments: row.comments,
      driver_raw: "",
      driver_id: null,
      fault: classifyFault(row.notes + " " + row.comments, ""),
      week_ending: weekEnding,
      ingested_at: now,
      photo_urls: [],
    });
  }

  for (const row of parsed.traces) {
    raw.push({
      pro_number: row.pro_number,
      category: row.category,
      source: "excel_traces",
      cust_number: row.cust_number,
      order_number: row.order_number,
      terminal: row.terminal,
      warehouse: row.warehouse,
      service_type: row.service_type,
      ship_date: row.ship_date,
      trace_date: row.trace_date,
      reason: row.reason,
      notes: row.notes,
      comments: row.comments,
      driver_raw: "",
      driver_id: null,
      fault: classifyFault(row.notes + " " + row.comments, ""),
      week_ending: weekEnding,
      ingested_at: now,
      photo_urls: [],
    });
  }

  const { incidents, duplicatesRemoved } = dedupeIncidents(raw);
  incidents._duplicatesRemoved = duplicatesRemoved;
  incidents._rawRowCount = raw.length;
  return incidents;
}

// ---------------------------------------------------------------------------
// Public: dedupeIncidents
// Groups by PRO number, keeps highest-precedence category, merges fields.
// Returns { incidents, duplicatesRemoved }.
// ---------------------------------------------------------------------------

export function dedupeIncidents(incidents) {
  const byPro = new Map();
  let duplicatesRemoved = 0;

  for (const inc of incidents) {
    const key =
      inc.pro_number || `__no_pro_${inc.ingested_at}_${Math.random()}`;
    const existing = byPro.get(key);

    if (!existing) {
      byPro.set(key, {
        ...inc,
        items: inc.item_number ? [inc.item_number] : [],
        item_descriptions: inc.freight_id ? [inc.freight_id] : [],
        merged_count: 1,
        merged_sources: [inc.source],
      });
      continue;
    }

    duplicatesRemoved++;
    existing.merged_count++;
    if (inc.source && !existing.merged_sources.includes(inc.source)) {
      existing.merged_sources.push(inc.source);
    }
    if (inc.item_number && !existing.items.includes(inc.item_number)) {
      existing.items.push(inc.item_number);
    }
    if (inc.freight_id && !existing.item_descriptions.includes(inc.freight_id)) {
      existing.item_descriptions.push(inc.freight_id);
    }

    // Category: higher precedence wins
    const existingPrecedence = CATEGORY_PRECEDENCE[existing.category] || 0;
    const incomingPrecedence = CATEGORY_PRECEDENCE[inc.category] || 0;
    if (incomingPrecedence > existingPrecedence) {
      existing.category = inc.category;
    }

    // Merge text fields
    existing.notes = mergeText(existing.notes, inc.notes);
    existing.comments = mergeText(existing.comments, inc.comments);
    existing.reason = mergeText(existing.reason, inc.reason);

    // Dates: earliest ship_date, latest return/delivered/trace dates
    if (inc.ship_date && (!existing.ship_date || inc.ship_date < existing.ship_date)) {
      existing.ship_date = inc.ship_date;
    }
    if (inc.return_date && (!existing.return_date || inc.return_date > existing.return_date)) {
      existing.return_date = inc.return_date;
    }
    if (inc.delivered_date && (!existing.delivered_date || inc.delivered_date > existing.delivered_date)) {
      existing.delivered_date = inc.delivered_date;
    }
    if (inc.trace_date && (!existing.trace_date || inc.trace_date > existing.trace_date)) {
      existing.trace_date = inc.trace_date;
    }

    // Fill-in-blank scalar fields
    for (const field of [
      "cust_number",
      "order_number",
      "terminal",
      "warehouse",
      "zip_code",
      "state",
      "service_type",
      "picker_id",
      "packer_id",
      "freight_id",
      "item_number",
      "days_late",
      "response_category",
      "response",
      "expected_date",
    ]) {
      if (!existing[field] && inc[field]) existing[field] = inc[field];
    }
  }

  const out = [];
  for (const inc of byPro.values()) {
    if (inc.items.length > 0) inc.item_number = inc.items.join(", ");
    if (inc.item_descriptions.length > 0) inc.freight_id = inc.item_descriptions.join(", ");
    if (inc.merged_count > 1) {
      inc.merged_note = `Consolidated from ${inc.merged_count} line items`;
    }
    // Normalize the set of Uline reports this PRO came in on (overlap kept:
    // a PRO on both Traces and Returns keeps both). One row per PRO.
    inc.sources = [
      ...new Set((inc.merged_sources || []).map((s) => SOURCE_MAP[s]).filter(Boolean)),
    ];
    delete inc.items;
    delete inc.item_descriptions;
    delete inc.merged_sources;
    out.push(inc);
  }

  return { incidents: out, duplicatesRemoved };
}

// ---------------------------------------------------------------------------
// Public: resolve driver IDs from a list of drivers
// Mirrors the w6() function in the bundle.
// ---------------------------------------------------------------------------

export function resolveDriverId(driverRaw, drivers) {
  if (!driverRaw) return null;
  const normalized = driverRaw
    .replace(/NON DRIVER\//i, "")
    .trim()
    .toUpperCase();
  if (!normalized || normalized === "****" || /^\*+$/.test(normalized)) return null;

  let match = drivers.find((d) => d.name.toUpperCase() === normalized);
  if (match) return match.id;

  const parts = normalized.split(/\s+/);
  match = drivers.find((d) => {
    const name = d.name.toUpperCase();
    return parts.every((p) => name.includes(p));
  });
  if (match) return match.id;

  match = drivers.find(
    (d) =>
      d.name.toUpperCase().includes(normalized) ||
      normalized.includes(d.name.toUpperCase()),
  );
  return match ? match.id : null;
}
