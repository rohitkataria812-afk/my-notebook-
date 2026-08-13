/**
 * SyncManager - mirrors local IndexedDB data to Firestore under:
 *   users/{uid}/notes/{noteId}
 *   users/{uid}/notebooks/{notebookId}
 *
 * Strategy: offline-first. Every write goes to IndexedDB immediately
 * (UI never waits on network). If online + Firebase configured + user
 * is not a guest, the write is also pushed to Firestore in the
 * background. A realtime listener pulls remote changes down and
 * merges by `updatedAt` (last write wins) into IndexedDB, then
 * notifies the UI to re-render.
 */
const SyncManager = (() => {
  let unsubNotes = null;
  let unsubNotebooks = null;
  let onRemoteChange = null;
  let currentUid = null;

  function canSync(uid) {
    return firebaseReady && navigator.onLine && uid && !uid.startsWith("guest");
  }

  function setStatus(status) {
    const el = document.getElementById("syncStatus");
    if (!el) return;
    el.classList.remove("online", "offline", "syncing");
    if (status === "syncing") { el.classList.add("syncing"); el.title = "Syncing..."; el.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>'; }
    else if (status === "online") { el.classList.add("online"); el.title = "Synced to cloud"; el.innerHTML = '<i class="fa-solid fa-cloud"></i>'; }
    else { el.classList.add("offline"); el.title = "Offline / local only"; el.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i>'; }
  }

  async function pushNote(uid, note) {
    if (!canSync(uid)) return;
    try {
      setStatus("syncing");
      await db.collection("users").doc(uid).collection("notes").doc(note.id).set(note);
      setStatus("online");
    } catch (e) {
      console.warn("Push note failed (will stay local):", e.message);
      setStatus("offline");
    }
  }

  async function pushNotebook(uid, nb) {
    if (!canSync(uid)) return;
    try {
      await db.collection("users").doc(uid).collection("notebooks").doc(nb.id).set(nb);
    } catch (e) {
      console.warn("Push notebook failed:", e.message);
    }
  }

  async function deleteRemoteNote(uid, id) {
    if (!canSync(uid)) return;
    try { await db.collection("users").doc(uid).collection("notes").doc(id).delete(); }
    catch (e) { console.warn("Remote delete failed:", e.message); }
  }

  async function pullAndMerge(uid) {
    if (!canSync(uid)) { setStatus("offline"); return; }
    setStatus("syncing");
    try {
      const [remoteNotesSnap, remoteNbSnap] = await Promise.all([
        db.collection("users").doc(uid).collection("notes").get(),
        db.collection("users").doc(uid).collection("notebooks").get()
      ]);
      const localNotes = await LocalDB.getAllNotes(uid);
      const localMap = new Map(localNotes.map(n => [n.id, n]));

      for (const doc of remoteNotesSnap.docs) {
        const remote = doc.data();
        const local = localMap.get(remote.id);
        if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
          await LocalDB.putNote(remote);
        } else if (local && (local.updatedAt || 0) > (remote.updatedAt || 0)) {
          // local is newer -> push up
          pushNote(uid, local);
        }
      }
      const localNbs = await LocalDB.getAllNotebooks(uid);
      const localNbMap = new Map(localNbs.map(n => [n.id, n]));
      for (const doc of remoteNbSnap.docs) {
        const remote = doc.data();
        if (!localNbMap.has(remote.id)) await LocalDB.putNotebook(remote);
      }
      setStatus("online");
      if (onRemoteChange) onRemoteChange();
    } catch (e) {
      console.warn("Pull/merge failed:", e.message);
      setStatus("offline");
    }
  }

  function listen(uid, callback) {
    stopListening();
    currentUid = uid;
    onRemoteChange = callback;
    if (!canSync(uid)) { setStatus("offline"); return; }

    unsubNotes = db.collection("users").doc(uid).collection("notes")
      .onSnapshot(async (snap) => {
        let changed = false;
        for (const change of snap.docChanges()) {
          if (change.type === "removed") continue;
          const remote = change.doc.data();
          const local = (await LocalDB.getAllNotes(uid)).find(n => n.id === remote.id);
          if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
            await LocalDB.putNote(remote);
            changed = true;
          }
        }
        if (changed && onRemoteChange) onRemoteChange();
      }, (err) => console.warn("notes listener error:", err.message));

    unsubNotebooks = db.collection("users").doc(uid).collection("notebooks")
      .onSnapshot(async (snap) => {
        let changed = false;
        for (const change of snap.docChanges()) {
          if (change.type === "removed") continue;
          await LocalDB.putNotebook(change.doc.data());
          changed = true;
        }
        if (changed && onRemoteChange) onRemoteChange();
      }, (err) => console.warn("notebooks listener error:", err.message));
  }

  function stopListening() {
    if (unsubNotes) unsubNotes();
    if (unsubNotebooks) unsubNotebooks();
    unsubNotes = null; unsubNotebooks = null;
  }

  window.addEventListener("online", () => { if (currentUid) pullAndMerge(currentUid); });
  window.addEventListener("offline", () => setStatus("offline"));

  return { pushNote, pushNotebook, deleteRemoteNote, pullAndMerge, listen, stopListening, setStatus, canSync };
})();
