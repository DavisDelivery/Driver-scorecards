// Forgotten Freight, plus the PROs that never made it that far.
//
// Looking a PRO up doesn't always end in a forgotten-freight entry: sometimes the
// stop has no driver, the PRO isn't in NuVizz, or the driver simply can't find the
// freight. Those used to have nowhere to go — logging one as forgotten freight would
// charge a driver for something nobody could attribute, and skipping it left no
// record that the lookup happened at all.
//
// So they get their own tab and their own category. Forgotten Freight's counts,
// charts and leaderboard read category === "forgotten_freight" and never see these.
import React from "react";
import ManualEntry, { FF_CONFIG, UNABLE_TO_TRACK_CONFIG, UNABLE_TO_TRACK } from "./ManualEntry.jsx";

const TABS = [
  ["ff", "Forgotten Freight"],
  ["untracked", "Unable to Track"],
];

export default function ForgottenFreightTabs({ drivers, incidents, onSaved }) {
  const [sub, setSub] = React.useState("ff");
  const untrackedCount = incidents.filter((i) => i.category === UNABLE_TO_TRACK).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div className="month-picker" style={{ margin: 0, alignSelf: "flex-start" }}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`month-btn ${sub === id ? "active" : ""}`}
            onClick={() => setSub(id)}
          >
            {label}
            {id === "untracked" && untrackedCount > 0 ? ` (${untrackedCount})` : ""}
          </button>
        ))}
      </div>
      <ManualEntry
        key={sub}
        config={sub === "ff" ? FF_CONFIG : UNABLE_TO_TRACK_CONFIG}
        drivers={drivers}
        incidents={incidents}
        onSaved={onSaved}
      />
    </div>
  );
}
