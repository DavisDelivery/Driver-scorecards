import React from "react";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";
import { nameOf } from "../../data/people.js";
import { whatChanged, summaryText } from "../../data/narrative.js";
import { openDrill } from "../kit/drillNav.js";
import { openCoverage } from "./nav.js";

// Company History › Overview: what changed against the comparison, in a few plain
// sentences (narrative.js). Every count opens the drawer on exactly what it counted,
// and each sentence's "Open →" on everything the sentence is about. Hovering a sentence brings its categories
// forward in the monthly chart (`onFocus`). The caveats under them say what the
// sentences couldn't count; one about a left-out cell opens Data Coverage there.
//
// Drivers are named only once the roster is in: without it nobody can be told inactive,
// so the card leaves names out rather than bring a deactivated driver back.

const CAVEATS_SHOWN = 3;

export default function WhatChanged({ cov, months, label, cmpMonths, cmpLabel, cats, lfl, allowSourceChange, today, onFocus }) {
  const a = useAnalytics();
  const blend = a.blend(null);
  const out = React.useMemo(
    () =>
      whatChanged({
        cov,
        blend,
        months,
        cmpMonths,
        cats,
        lfl,
        allowSourceChange,
        today,
        label,
        cmpLabel,
        nameOf: (id) => nameOf(a.people, id),
        hidden: a.hidden,
        rosterReady: !a.rosterBlocking,
        incidents: a.incidents,
      }),
    [cov, blend, months, cmpMonths, cats, lfl, allowSourceChange, today, label, cmpLabel, a.people, a.hidden, a.rosterBlocking, a.incidents],
  );
  const [showAll, setShowAll] = React.useState(false);
  const [copied, setCopied] = React.useState(null);

  // The clipboard can refuse (no permission, an insecure page): say so, never pretend.
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("this browser has no clipboard access here");
      await navigator.clipboard.writeText(summaryText({ ...out, label, cmpLabel }));
      setCopied({ ok: true });
    } catch (e) {
      setCopied({ ok: false, message: e?.message || "the clipboard refused" });
    }
  };
  React.useEffect(() => {
    if (!copied?.ok) return undefined;
    const t = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const caveats = showAll ? out.caveats : out.caveats.slice(0, CAVEATS_SHOWN);
  return (
    <div className="card co-what">
      <div className="card-header">
        <div className="card-title">What changed</div>
        <button type="button" className="btn ghost sm" onClick={copy}>
          {copied?.ok ? "Copied" : "Copy summary"}
        </button>
      </div>
      <div className="card-body">
        <div className="wc-against">against {cmpLabel}</div>
        <ul className="wc-list">
          {out.sentences.map((s) => (
            <li
              key={s.id}
              onMouseEnter={() => onFocus?.(s.focus)}
              onMouseLeave={() => onFocus?.(null)}
              onFocus={() => onFocus?.(s.focus)}
              onBlur={() => onFocus?.(null)}
            >
              {s.segments.map((seg, i) =>
                seg.drill ? (
                  <button key={i} type="button" className="wc-n" onClick={() => openDrill(seg.drill)}>
                    {seg.text}
                  </button>
                ) : seg.strong ? (
                  <b key={i}>{seg.text}</b>
                ) : (
                  <React.Fragment key={i}>{seg.text}</React.Fragment>
                ),
              )}
              {s.drill && (
                <>
                  {" "}
                  <button type="button" className="wc-open" onClick={() => openDrill(s.drill)}>
                    Open →
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {copied && !copied.ok && (
          <div className="co-error" role="alert">
            Couldn&apos;t copy ({copied.message}) — select the sentences and copy them instead.
          </div>
        )}
        {out.caveats.length > 0 && (
          <div className="wc-caveats">
            <span className="co-caveats-h">Caveats</span>
            <ul>
              {caveats.map((c) => (
                <li key={c.text}>
                  {c.ym && c.cat ? (
                    <button
                      type="button"
                      className="wc-caveat"
                      onClick={() => openCoverage({ ym: c.ym, cat: c.cat })}
                      title="Open Data Coverage at this cell"
                    >
                      {c.text}
                    </button>
                  ) : (
                    c.text
                  )}
                </li>
              ))}
            </ul>
            {out.caveats.length > CAVEATS_SHOWN && (
              <button type="button" className="text-link" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Show fewer" : `+${out.caveats.length - CAVEATS_SHOWN} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
