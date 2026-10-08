import React from "react";

// An element's content box, followed as it resizes. Every layout decision in
// kit/shape.js (ticks, bar width, value labels, tile rows) is made from this measured
// size, never from a phone flag, so a chart reads the same in a narrow card on a wide
// screen as on a phone.
//   → [ref, { width, height }]   0 × 0 until the first measure
// `ref` is a callback ref, so an element that mounts later (a chart that waits for its
// data) is measured as soon as it appears.
export default function useSize() {
  const [node, setNode] = React.useState(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const ref = React.useCallback((el) => setNode(el), []);
  React.useLayoutEffect(() => {
    if (!node) return undefined;
    const read = () => {
      const width = Math.floor(node.clientWidth);
      const height = Math.floor(node.clientHeight);
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [ref, size];
}

// True on a touch-first device: the hover readout is pinned to the plot's top, where a
// finger doesn't cover it.
export function useCoarsePointer() {
  const q = React.useMemo(
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(pointer: coarse)") : null),
    [],
  );
  const [coarse, setCoarse] = React.useState(!!q?.matches);
  React.useEffect(() => {
    if (!q) return undefined;
    const on = () => setCoarse(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, [q]);
  return coarse;
}

// True while a media query matches ("(max-width: 640px)"): for what a phone shows less
// of (a long list 20 at a time), never for a chart's layout, which reads its own width.
export function useMedia(query) {
  const q = React.useMemo(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null), [query]);
  const [on, setOn] = React.useState(!!q?.matches);
  React.useEffect(() => {
    if (!q) return undefined;
    const f = () => setOn(q.matches);
    q.addEventListener?.("change", f);
    return () => q.removeEventListener?.("change", f);
  }, [q]);
  return on;
}
