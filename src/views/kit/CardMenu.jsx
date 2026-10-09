import React from "react";
import Icon from "./Icon.jsx";

// A card's one quiet control: a ⋯ button that opens its actions (show as table / chart,
// download CSV). It replaces the CHART | TABLE | CSV cluster every chart used to carry.
//
//   items  [{ id, label, icon?, onSelect, disabled?, title?, danger? }]
//   label  the button's accessible name
//   text   a worded button ("More") instead of the ⋯ icon — a toolbar's overflow menu
//   fixed  the list is placed against the window, not the button's box — for a row menu
//          inside a scrolling table, which would otherwise clip it; any scroll closes it
// Escape and a click outside close it; ↑/↓ walk the items; focus returns to the button.
export default function CardMenu({ items = [], label = "Chart options", className = "", fixed = false, text = null }) {
  const [open, setOpen] = React.useState(false);
  const [at, setAt] = React.useState(null);
  const wrap = React.useRef(null);
  const btn = React.useRef(null);
  const list = React.useRef(null);
  const close = React.useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    const onScroll = (e) => {
      if (list.current && list.current.contains(e.target)) return;
      close(false);
    };
    if (fixed) window.addEventListener("scroll", onScroll, true);
    // Focus the first enabled item, so the arrows work straight away.
    list.current?.querySelector("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      if (fixed) window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close, fixed]);
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(list.current?.querySelectorAll("button:not(:disabled)") || [])];
    if (!els.length) return;
    const i = els.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next].focus();
  };
  if (!items.length) return null;
  return (
    <div className={`cc-menu ${className}`.trim()} ref={wrap} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        className={text ? "btn ghost sm cc-menu-text" : "cc-menu-btn"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => {
          if (fixed && btn.current) {
            const r = btn.current.getBoundingClientRect();
            const h = items.length * 44 + 10;
            const below = window.innerHeight - r.bottom > h;
            setAt({ right: Math.max(8, window.innerWidth - r.right), ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) });
          }
          setOpen((o) => !o);
        }}
      >
        {text ? (
          <>
            {text}
            <Icon name="chevron-down" />
          </>
        ) : (
          <Icon name="more-horizontal" />
        )}
      </button>
      {open && (
        <div
          className="cc-menu-list"
          role="menu"
          ref={list}
          style={fixed && at ? { position: "fixed", left: "auto", ...at } : undefined}
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className={`cc-menu-item ${it.danger ? "danger" : ""}`.trim()}
              disabled={!!it.disabled}
              title={it.title}
              onClick={() => {
                close();
                it.onSelect?.();
              }}
            >
              {it.icon && <Icon name={it.icon} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
