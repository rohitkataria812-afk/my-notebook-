/**
 * FIREBASE CONFIGURATION
 */
const firebaseConfig = {
  apiKey: "AIzaSyCMLbQYE96DVjFK-NMTNaGPvWokNGrRYJo",
  authDomain: "my-notes-f1902.firebaseapp.com",
  projectId: "my-notes-f1902",
  storageBucket: "my-notes-f1902.firebasestorage.app",
  messagingSenderId: "930148123383",
  appId: "1:930148123383:web:9969932aefb97d7a58c9f2"
};

let firebaseReady = false;
let auth = null;
let db = null;

try {
  if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      console.warn("Firestore persistence not enabled:", err.code);
    });
    firebaseReady = true;
  } else {
    console.warn("Firebase config not set. Running in local-only (guest) mode.");
  }
} catch (e) {
  console.error("Firebase init failed:", e);
  firebaseReady = false;
}