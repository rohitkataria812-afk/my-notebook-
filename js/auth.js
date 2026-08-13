/**
 * AuthManager - wraps Firebase Auth. Falls back to a local "guest"
 * pseudo-account when Firebase isn't configured or device is offline,
 * so the app is always usable.
 */
const AuthManager = (() => {
  const GUEST_KEY = "guestUser";

  async function getGuestUser() {
    let g = await LocalDB.getSetting(GUEST_KEY);
    if (!g) {
      g = { uid: "guest_local", displayName: "Guest", email: null, isGuest: true };
      await LocalDB.setSetting(GUEST_KEY, g);
    }
    return g;
  }

  async function signup(name, email, password) {
    if (!firebaseReady) throw { code: "app/offline", message: "Cloud sign-up needs an internet connection & Firebase setup. Try 'Continue Offline' instead." };
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await db.collection("users").doc(cred.user.uid).set({
      name, email, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return cred.user;
  }

  async function login(email, password) {
    if (!firebaseReady) throw { code: "app/offline", message: "No internet / Firebase not configured. Try 'Continue Offline' instead." };
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function resetPassword(email) {
    if (!firebaseReady) throw { code: "app/offline", message: "Cloud connection required to reset password." };
    return auth.sendPasswordResetEmail(email);
  }

  async function logout() {
    if (firebaseReady && auth.currentUser) await auth.signOut();
    await LocalDB.setSetting("activeUser", null);
  }

  function onChange(callback) {
    if (firebaseReady) {
      auth.onAuthStateChanged(async (user) => {
        if (user) {
          await LocalDB.setSetting("activeUser", { uid: user.uid, displayName: user.displayName, email: user.email, isGuest: false });
          callback({ uid: user.uid, displayName: user.displayName || user.email.split("@")[0], email: user.email, isGuest: false });
        } else {
          callback(null);
        }
      });
    } else {
      // No Firebase: immediately resolve to "no user" so app.js can offer guest mode
      callback(null);
    }
  }

  return { signup, login, resetPassword, logout, onChange, getGuestUser };
})();
