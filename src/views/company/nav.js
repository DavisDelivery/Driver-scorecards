// Moving around Company History by its hash keys (co.*), so Back walks the move back
// and a link opens the same place.
import { writeHash } from "../../data/hashState.js";

// Data Coverage, opened on one cell (a caveat chip names a category and its months) or
// on one of its sections ("unattributed", "conflicts", …).
export function openCoverage({ ym = null, cat = null, section = null } = {}) {
  writeHash(
    { "co.sub": "coverage", "co.cell": ym && cat ? `${ym}|${cat}` : null, "co.sec": section },
    { push: true },
  );
}
