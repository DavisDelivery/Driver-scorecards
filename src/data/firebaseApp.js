// Firebase app + Firestore initialization for the Davis Driver Scorecard.
//
// The web config below is PUBLIC by design — Firebase web keys are meant to ship
// in the client bundle. What actually protects the data is Firestore security
// rules, NOT hiding this key. (We're running without login per product decision,
// so the rules currently allow open access; add Firebase Auth to lock it down.)
//
// Offline persistence is the whole point of moving here: Firestore queues writes
// made while offline / on a flaky connection and syncs them automatically when
// the connection returns, and every other device converges on the same data.
// That structurally fixes the "entered on one device, missing on another" bug.
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// The API key identifies the project's API access; the PROJECT ID identifies the
// database itself. Both are safe to commit. Values can be overridden by Vite env
// vars (VITE_FIREBASE_*) for previews, but default to the production project.
//
// TODO(project): set PROJECT_ID to the real Firebase project id. The api key
// alone does not identify the database, so Firestore cannot connect until this
// is filled in (looks like "davis-driver-scorecard" or similar).
const PROJECT_ID =
  import.meta.env.VITE_FIREBASE_PROJECT_ID || "REPLACE_WITH_PROJECT_ID";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyDyRyjuiP_UD8T_2xmW2xLjvqx9RLCYCmo",
  projectId: PROJECT_ID,
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${PROJECT_ID}.firebaseapp.com`,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || undefined,
};

export const firebaseReady = PROJECT_ID !== "REPLACE_WITH_PROJECT_ID";

export const app = initializeApp(firebaseConfig);

// persistentLocalCache: local reads + an offline write queue that auto-syncs.
// persistentMultipleTabManager: keep multiple tabs of the app consistent.
// If IndexedDB is unavailable (private mode, old browser), Firestore degrades to
// an in-memory cache on its own — no crash.
export const db = initializeFirestore(app, {
  // Incident/report objects carry optional fields that are sometimes undefined;
  // Firestore rejects undefined unless we tell it to skip them.
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
