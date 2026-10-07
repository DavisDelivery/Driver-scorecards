// Opening and closing the drill-down drawer: its state lives in the URL hash (#drill=…),
// so opening pushes a history entry and Back closes it again. DrillDrawer.jsx renders
// whatever the hash holds.
//
// Each entry the drawer pushes records how deep into the drawer it is, so closing can
// walk back out of all of them. Closing used to push one more entry, and Back after a
// close reopened the drawer instead of leaving the page.
import { writeHash, readHash } from "../../data/hashState.js";
import { encodeDrill } from "../../data/drill.js";

export const DRILL_KEY = "drill";

const depthHere = () => Number(window.history.state?.drillDepth) || 0;

export function openDrill(state) {
  writeHash({ [DRILL_KEY]: encodeDrill(state) }, { push: true, state: { drillDepth: depthHere() + 1 } });
}

// Record the data stamp a just-opened drawer was counted under, in place.
export function stampDrill(state, at) {
  writeHash({ [DRILL_KEY]: encodeDrill({ ...state, at }) });
}

let closing = false;
export function closeDrill() {
  if (closing) return;
  const depth = depthHere();
  if (depth === 0) {
    // Opened from a link (or a reload): nothing of ours to step back over.
    writeHash({ [DRILL_KEY]: null });
    return;
  }
  // Step back over every entry the drawer pushed. If the page itself was opened on a
  // drawer (a link), that first entry still holds it, and is cleared in place — as it
  // is if the browser never answers the step back, so the drawer always closes.
  closing = true;
  let timer = null;
  const done = () => {
    window.removeEventListener("popstate", done);
    clearTimeout(timer);
    closing = false;
    if (readHash()[DRILL_KEY]) writeHash({ [DRILL_KEY]: null });
  };
  window.addEventListener("popstate", done);
  timer = setTimeout(done, 1000);
  window.history.go(-depth);
}
