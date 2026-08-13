/**
 * LocalDB - IndexedDB wrapper.
 * Every note & notebook is ALWAYS written here first (source of truth
 * for instant UI + offline support). Firestore sync (js/sync.js) is a
 * secondary layer that mirrors this data to the cloud when possible.
 */
const LocalDB = (() => {
  const DB_NAME = "myNotebookDB";
  const DB_VERSION = 1;
  let dbInstance = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (dbInstance) return resolve(dbInstance);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains("notes")) {
          const store = idb.createObjectStore("notes", { keyPath: "id" });
          store.createIndex("notebookId", "notebookId");
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!idb.objectStoreNames.contains("notebooks")) {
          idb.createObjectStore("notebooks", { keyPath: "id" });
        }
        if (!idb.objectStoreNames.contains("settings")) {
          idb.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function tx(storeName, mode) {
    const idb = await open();
    return idb.transaction(storeName, mode).objectStore(storeName);
  }

  return {
    // ---- Notes ----
    async putNote(note) {
      const store = await tx("notes", "readwrite");
      return new Promise((res, rej) => {
        const r = store.put(note);
        r.onsuccess = () => res(note);
        r.onerror = () => rej(r.error);
      });
    },
    async getAllNotes(uid) {
      const store = await tx("notes", "readonly");
      return new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result.filter(n => n.ownerId === uid));
        r.onerror = () => rej(r.error);
      });
    },
    async deleteNoteHard(id) {
      const store = await tx("notes", "readwrite");
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    // ---- Notebooks ----
    async putNotebook(nb) {
      const store = await tx("notebooks", "readwrite");
      return new Promise((res, rej) => {
        const r = store.put(nb);
        r.onsuccess = () => res(nb);
        r.onerror = () => rej(r.error);
      });
    },
    async getAllNotebooks(uid) {
      const store = await tx("notebooks", "readonly");
      return new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result.filter(n => n.ownerId === uid));
        r.onerror = () => rej(r.error);
      });
    },
    async deleteNotebook(id) {
      const store = await tx("notebooks", "readwrite");
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    // ---- Settings (theme, pin hash, last user) ----
    async setSetting(key, value) {
      const store = await tx("settings", "readwrite");
      return new Promise((res, rej) => {
        const r = store.put({ key, value });
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async getSetting(key) {
      const store = await tx("settings", "readonly");
      return new Promise((res, rej) => {
        const r = store.get(key);
        r.onsuccess = () => res(r.result ? r.result.value : null);
        r.onerror = () => rej(r.error);
      });
    }
  };
})();
