// historyParser.js
// Parses yearly DRIVER_PERFORMANCE.xlsx workbooks into monthly history records.
// Each sheet name encodes a category (e.g. "DAMAGES 2024") and optionally a year.
// The sheet body is a driver × month matrix with counts.

import * as XLSX from "xlsx";

// Map of uppercase sheet-name substrings → internal category ids
const CATEGORY_MAP = {
  DAMAGES: "damage",
  "FORGOTTEN FREIGHT": "forgotten_freight",
  LOST: "missing",
  MISSING: "missing",
  MISDELIVERED: "misdelivery",
  MISDELIVERIES: "misdelivery",
  ATTEMPTS: "attempts",
  LATES: "late",
  LATE: "late",
};

const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

// Returns a map of { 1-based month number → column index } from a header row.
function buildMonthColumnMap(headerRow) {
  const map = {};
  for (let col = 0; col < headerRow.length; col++) {
    const cell = headerRow[col];
    if (!cell) continue;
    const upper = String(cell).trim().toUpperCase();
    const idx = MONTH_NAMES.indexOf(upper);
    if (idx >= 0) map[idx + 1] = col;
  }
  return map;
}

// Extract a 4-digit year from a sheet name, falling back to fileYear.
function extractYear(sheetName, fileYear = null) {
  const m = /\b(20\d\d)\b/.exec(sheetName);
  return m ? parseInt(m[1], 10) : fileYear;
}

// Map a sheet name to a category id, or null if unrecognized.
function detectCategory(sheetName) {
  const upper = String(sheetName).toUpperCase();
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (upper.includes(key)) return val;
  }
  return null;
}

// Find the index of the header row that contains both DRIVER and JANUARY columns.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) =>
      String(c || "")
        .trim()
        .toUpperCase(),
    );
    if (cells.includes("DRIVER") && cells.includes("JANUARY")) return i;
  }
  return -1;
}

// Rows whose driver cell exactly matches these (uppercase) are skipped.
const SKIP_NAMES = new Set(["PRELOADED", "PRELOADERS", "TOTALS", ""]);

/**
 * Parse a single worksheet.
 *
 * @param {object}  sheet     - XLSX worksheet object
 * @param {string}  sheetName - Name of the sheet (used for category/year detection)
 * @param {number|null} fileYear - Year extracted from the filename (fallback)
 * @returns {{ year, category, rows, skipped }}
 *   rows: Array of { driver_raw, year, month, category, count }
 *   skipped: null on success, or a string explaining why the sheet was skipped
 */
export function parseDriverPerformance(sheet, sheetName, fileYear = null) {
  const category = detectCategory(sheetName);
  if (!category) {
    return { year: null, category: null, rows: [], skipped: "unknown category" };
  }

  const year = extractYear(sheetName, fileYear);
  if (!year) {
    return { year: null, category, rows: [], skipped: "no year in sheet name" };
  }

  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const headerRowIdx = findHeaderRow(allRows);
  if (headerRowIdx < 0) {
    return {
      year,
      category,
      rows: [],
      skipped: "no DRIVER/JANUARY header row",
    };
  }

  const headerRow = allRows[headerRowIdx];
  const monthColMap = buildMonthColumnMap(headerRow);

  // Find the DRIVER column index
  let driverCol = -1;
  for (let col = 0; col < headerRow.length; col++) {
    const cell = headerRow[col];
    if (cell && String(cell).trim().toUpperCase() === "DRIVER") {
      driverCol = col;
      break;
    }
  }
  if (driverCol < 0) {
    return { year, category, rows: [], skipped: "no DRIVER column" };
  }

  const rows = [];
  for (let r = headerRowIdx + 1; r < allRows.length; r++) {
    const row = allRows[r] || [];
    const driverCell = row[driverCol];
    if (driverCell == null) continue;

    const driverRaw = String(driverCell).trim();
    if (!driverRaw || SKIP_NAMES.has(driverRaw.toUpperCase())) continue;

    for (const [monthStr, colIdx] of Object.entries(monthColMap)) {
      const month = parseInt(monthStr, 10);
      const rawVal = row[colIdx];
      if (rawVal == null || rawVal === "") continue;
      const count = parseInt(rawVal, 10);
      if (!Number.isFinite(count) || count <= 0) continue;
      rows.push({ driver_raw: driverRaw, year, month, category, count });
    }
  }

  return { year, category, rows, skipped: null };
}

/**
 * Parse a single File object (a .xlsx/.xls workbook).
 *
 * @param {File} file
 * @returns {Promise<{ file: string, rows: object[], sheets: object[] }>}
 *   rows: flat array of { driver_raw, year, month, category, count }
 *   sheets: per-sheet summary { name, year, category, rows, skipped }
 */
export async function parseHistoryWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  // Try to extract a year from the filename as a fallback.
  const fileYearMatch = /\b(20\d\d)\b/.exec(file.name || "");
  const fileYear = fileYearMatch ? parseInt(fileYearMatch[1], 10) : null;

  const rows = [];
  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const result = parseDriverPerformance(sheet, sheetName, fileYear);
    sheets.push({
      name: sheetName,
      year: result.year,
      category: result.category,
      rows: result.rows.length,
      skipped: result.skipped,
    });
    rows.push(...result.rows);
  }

  return { file: file.name, rows, sheets };
}

/**
 * Parse multiple File objects and return a combined result with unique driver names.
 *
 * @param {File[]} files
 * @returns {Promise<{ rows, uniqueDrivers, fileSummaries }>}
 *   rows: flat array of all parsed records
 *   uniqueDrivers: sorted array of distinct driver_raw strings
 *   fileSummaries: per-file { name, rows, sheets }
 */
export async function parseHistoryFiles(files) {
  const allRows = [];
  const fileSummaries = [];

  for (const file of files) {
    const result = await parseHistoryWorkbook(file);
    fileSummaries.push({
      name: result.file,
      rows: result.rows.length,
      sheets: result.sheets,
    });
    allRows.push(...result.rows);
  }

  const uniqueDrivers = [
    ...new Set(allRows.map((r) => r.driver_raw)),
  ].sort();

  return { rows: allRows, uniqueDrivers, fileSummaries };
}

/**
 * Fuzzy-match a historical driver name string against the live driver roster.
 *
 * Matching strategy (in priority order):
 *  1. Exact match (case-insensitive, normalised whitespace)
 *  2. Same words in any order
 *  3. Same first-3-chars of first name + same last-4-chars of last name
 *  4. Unique last-name match
 *
 * @param {string}   name    - Raw name from the spreadsheet
 * @param {object[]} drivers - Array of driver objects with at least { id, name }
 * @returns {object|null} The matched driver object, or null
 */
export function matchHistoricalDriver(name, drivers) {
  if (!name) return null;

  const norm = (s) =>
    String(s)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");

  const normalised = norm(name);

  // 1. Exact match
  let match = drivers.find((d) => norm(d.name) === normalised);
  if (match) return match;

  // 2. Same words in any order
  const words = normalised.split(" ").filter(Boolean);
  for (const d of drivers) {
    const dWords = norm(d.name).split(" ").filter(Boolean);
    if (
      dWords.length === words.length &&
      dWords.every((w) => words.includes(w)) &&
      words.every((w) => dWords.includes(w))
    ) {
      return d;
    }
  }

  // 3. First-3 of first word + last-4 of last word
  if (words.length >= 2) {
    const firstPrefix = words[0].slice(0, 3);
    const lastSuffix = words[words.length - 1].slice(-4);
    for (const d of drivers) {
      const dWords = norm(d.name).split(" ").filter(Boolean);
      if (dWords.length < 2) continue;
      const dFirstPrefix = dWords[0].slice(0, 3);
      const dLastSuffix = dWords[dWords.length - 1].slice(-4);
      if (dFirstPrefix === firstPrefix && dLastSuffix === lastSuffix) return d;
    }
  }

  // 4. Unique last-name match
  if (words.length >= 1) {
    const lastName = words[words.length - 1];
    const candidates = drivers.filter((d) => {
      const dWords = norm(d.name).split(" ").filter(Boolean);
      return dWords[dWords.length - 1] === lastName;
    });
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}
