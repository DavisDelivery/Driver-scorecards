// Tab and filter state in the URL hash — #tab=attempts&att.p=30d — so switching tabs
// no longer resets what you were looking at, the Back button walks a tab change back,
// and a link opens the same view for someone else.
//
// Views unmount on every tab switch (App renders one tab at a time), so their filters
// used to live and die with them. The hash outlives the view.
//
// Keys are namespaced per tab (sc.p, att.p, tr.y …). The Scorecard's month presets and
// a manual-entry tab's day presets are different vocabularies; one shared `p` would let
// a link meant for one tab land as nonsense on another. Keys this file doesn't know
// about are carried along untouched.
//
// Navigation (a tab change) pushes a history entry; filter changes replace the current
// one, so Back goes to the previous tab rather than through every pill you clicked.
import { useCallback, useSyncExternalStore } from "react";

// "#a=1&b=x%20y" → { a: "1", b: "x y" }, in the order written. A malformed escape is
// kept as typed rather than thrown on, so a hand-edited link can't blank the app.
export function parseHash(str) {
  const out = {};
  const s = String(str || "").replace(/^#/, "");
  if (!s) return out;
  for (const part of s.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decode(i === -1 ? part : part.slice(0, i));
    if (!k) continue;
    out[k] = i === -1 ? "" : decode(part.slice(i + 1));
  }
  return out;
}

// { a: "1", b: "x y" } → "a=1&b=x%20y" (no leading #). Empty, null and undefined
// values are dropped: an unset filter is simply absent from the link.
export function buildHash(obj) {
  return Object.entries(obj || {})
    .filter(([k, v]) => k && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encode(k)}=${encode(String(v))}`)
    .join("&");
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
// Keep the separators readable: dots and dashes in keys and dates need no escaping.
const encode = (s) => encodeURIComponent(s).replace(/%2C/g, ",");

// Apply a patch to a parsed hash: a null/undefined/"" value removes the key, every
// other key — including ones this build has never heard of — is preserved in place.
export function patchHash(current, patch) {
  const next = { ...current };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined || v === null || v === "") delete next[k];
    else next[k] = String(v);
  }
  return next;
}

// ── Browser side ─────────────────────────────────────────────────────────────

const listeners = new Set();
const hasWindow = () => typeof window !== "undefined" && !!window.location;

export function readHash() {
  return hasWindow() ? parseHash(window.location.hash) : {};
}

// Merge `patch` into the hash. `push` adds a history entry (navigation); the default
// replaces the current one (a filter), keeping that entry's history state. `state` is
// the new entry's history state (the drill drawer counts its depth there).
// pushState/replaceState don't fire hashchange, so subscribers are told directly.
export function writeHash(patch, { push = false, state = null } = {}) {
  if (!hasWindow()) return;
  const next = buildHash(patchHash(readHash(), patch));
  const { pathname, search } = window.location;
  const url = `${pathname}${search}${next ? `#${next}` : ""}`;
  if (`#${next}` === window.location.hash || (!next && !window.location.hash)) return;
  if (push) window.history.pushState(state, "", url);
  else window.history.replaceState(window.history.state, "", url);
  for (const fn of listeners) fn();
}

function subscribe(fn) {
  listeners.add(fn);
  window.addEventListener("hashchange", fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("hashchange", fn);
    window.removeEventListener("popstate", fn);
  };
}
const snapshot = () => (hasWindow() ? window.location.hash : "");

// One hash key as React state: [value, set]. The value is the key's string, or
// `fallback` when the key is absent. Setting the fallback removes the key, so a link
// only carries what differs from the defaults. set(value, { push: true }) navigates.
export function useHashState(key, fallback = "") {
  const hash = useSyncExternalStore(subscribe, snapshot, () => "");
  const raw = parseHash(hash)[key];
  const value = raw === undefined ? fallback : raw;
  const set = useCallback(
    (v, opts) => writeHash({ [key]: v === fallback ? null : v }, opts),
    [key, fallback],
  );
  return [value, set];
}
