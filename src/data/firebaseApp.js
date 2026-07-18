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
// NOTE: davismarginiq is a shared Davis Firebase project, so this app namespaces
// all of its collections with a dds_ prefix (see firebase.js) to stay clear of
// any other app's data in the same Firestore.
const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyDyRyjuiP_UD8T_2xmW2xLjvqx9RLCYCmo",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "davismarginiq.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "davismarginiq",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "davismarginiq.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "131773007635",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:131773007635:web:be408aab03d843333afce6",
};

export const firebaseReady = true;

export const app = initializeApp(firebaseConfig);

// persistentLocalCache: local reads + an offline write queue that auto-syncs.
// persistentMultipleTabManager: keep multiple tabs of the app consistent.
// If IndexedDB is unavailable (private mode, old browser), Firestore degrades to
// an in-memory cache on its own — no crash.
// This app's data lives in the NAMED Firestore database "scorecard" inside the
// shared davismarginiq project (not the project's (default) database).
const DATABASE_ID = import.meta.env.VITE_FIREBASE_DATABASE_ID || "scorecard";

export const db = initializeFirestore(
  app,
  {
    // Incident/report objects carry optional fields that are sometimes undefined;
    // Firestore rejects undefined unless we tell it to skip them.
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  },
  DATABASE_ID,
);
