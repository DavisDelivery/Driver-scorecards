// Fuzzy-match a NuVizz driver name to the roster. Shared by the Forgotten
// Freight manual entry and the Reviews PRO→driver attribution.
export function matchDriver(nuvizzName, drivers) {
  if (!nuvizzName) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const target = norm(nuvizzName);
  if (!target) return null;
  // exact
  let hit = drivers.find((d) => norm(d.name) === target);
  if (hit) return hit;
  // every target token is a WHOLE token of the driver name. Whole-token equality —
  // not substring — so "Ed Smith" can't match "Fred Smithson" ("ed" ⊂ "fred",
  // "smith" ⊂ "smithson").
  const tTokens = target.split(/\s+/);
  hit = drivers.find((d) => {
    const dTokens = norm(d.name).split(/\s+/);
    return tTokens.every((t) => dTokens.includes(t));
  });
  if (hit) return hit;
  // first name + last-name PREFIX fallback: handles a truncated last name
  // ("Mike John" → "Mike Johnson") but not a mere shared last initial, so
  // "Mike Jones" no longer wrongly matches "Mike Johnson".
  hit = drivers.find((d) => {
    const dTokens = norm(d.name).split(/\s+/);
    const dLast = dTokens[dTokens.length - 1] || "";
    const tLast = tTokens[tTokens.length - 1] || "";
    return (
      dTokens[0] === tTokens[0] &&
      dLast &&
      tLast &&
      (dLast.startsWith(tLast) || tLast.startsWith(dLast))
    );
  });
  if (hit) return hit;
  // first-name-only fallback: if exactly ONE driver on the roster shares the
  // first name, use them (e.g. NuVizz "Kobe Boakye" → the only "Kobe"). Skipped
  // when two or more share a first name so we never credit the wrong driver.
  const firstName = tTokens[0];
  if (firstName) {
    const sameFirst = drivers.filter(
      (d) => norm(d.name).split(/\s+/)[0] === firstName,
    );
    if (sameFirst.length === 1) {
      // Only credit them if the last names don't contradict. If BOTH sides carry a
      // last name and they clearly differ (e.g. "Mike Jones" vs the roster's only
      // "Mike Johnson"), it's a different person — leave it unmatched.
      const dTokens = norm(sameFirst[0].name).split(/\s+/);
      const dLast = dTokens.length > 1 ? dTokens[dTokens.length - 1] : "";
      const tLast = tTokens.length > 1 ? tTokens[tTokens.length - 1] : "";
      if (!dLast || !tLast || dLast.startsWith(tLast) || tLast.startsWith(dLast)) {
        return sameFirst[0];
      }
    }
  }
  return null;
}
