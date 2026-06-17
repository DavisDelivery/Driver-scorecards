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
  // all tokens contained either way
  const tTokens = target.split(/\s+/);
  hit = drivers.find((d) => {
    const dn = norm(d.name);
    return tTokens.every((t) => dn.includes(t));
  });
  if (hit) return hit;
  // first + last initial style fallback
  hit = drivers.find((d) => {
    const dTokens = norm(d.name).split(/\s+/);
    return (
      dTokens[0] === tTokens[0] &&
      dTokens[dTokens.length - 1]?.[0] === tTokens[tTokens.length - 1]?.[0]
    );
  });
  return hit || null;
}
