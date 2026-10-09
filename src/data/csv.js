// CSV export for every chart's table view, so a number on screen can be checked in a
// spreadsheet. Each table carries a Source column (live entries, imported history,
// a Uline report …), so the export says where every figure came from.
//
// columns: [{ key, label, value?, csvLabel? }] — `value(row)` overrides `row[key]`, and
// `csvLabel` the header, where an export keeps a name the screen has since shortened.

// RFC 4180 quoting: a field with a comma, quote or line break is wrapped in quotes and
// its quotes doubled. A text field that opens like a formula (= + - @) is prefixed with
// an apostrophe so a spreadsheet shows it rather than running it; numbers are left be.
function field(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const head = columns.map((c) => field(c.csvLabel ?? c.label ?? c.key)).join(",");
  const body = (rows || []).map((r) =>
    columns.map((c) => field(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","),
  );
  return [head, ...body].join("\r\n") + "\r\n";
}

// Hand the CSV to the browser as a download. The byte-order mark makes Excel read it as
// UTF-8, so a "–" in a period label doesn't arrive as mojibake.
export function downloadCsv(name, rows, columns) {
  if (typeof document === "undefined") return;
  const blob = new Blob(["﻿", toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = /\.csv$/i.test(name) ? name : `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late on purpose: Safari and some Firefox builds cancel a download whose blob
  // URL goes away before the download has started (FileSaver.js waits 40 s for this).
  setTimeout(() => URL.revokeObjectURL(url), 40000);
}

// "Monthly incidents · 2026" → "Monthly_incidents_2026"
export const csvName = (...parts) =>
  parts
    .filter(Boolean)
    .join(" ")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
