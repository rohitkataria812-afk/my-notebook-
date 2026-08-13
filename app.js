/**
 * App - main controller. Wires together Auth, LocalDB, SyncManager
 * and the UI. Handles: notes CRUD, notebooks, search, pin, trash,
 * dark mode, PIN lock, image attachments, share/export.
 */
const App = (() => {
  let state = {
    user: null,
    notes: [],
    notebooks: [],
    filter: "all",          // all | pinned | trash | notebookId
    search: "",
    currentNoteId: null,
    theme: "light",
    pinHash: null,
    pinBuffer: "",
    unlocked: false
  };

  const NB_COLORS = ["#6C5CE7", "#00B894", "#FDCB6E", "#FF7675", "#0984E3", "#E84393", "#00CEC9"];

  // ---------------- INIT ----------------
  async function init() {
    bindStaticEvents();
    state.theme = (await LocalDB.getSetting("theme")) || "light";
    applyTheme(state.theme, false);
    state.pinHash = await LocalDB.getSetting("pinHash");

    AuthManager.onChange(async (user) => {
      if (user) {
        await enterApp(user);
      } else {
        const saved = await LocalDB.getSetting("activeUser");
        if (saved && saved.isGuest) {
          await enterApp(saved);
        } else {
          showAuth();
        }
      }
    });

    setTimeout(() => document.getElementById("splash").remove(), 1500);
  }

  async function enterApp(user) {
    state.user = user;
    document.getElementById("userName").textContent = user.displayName || "User";
    document.getElementById("userAvatar").textContent = (user.displayName || "U").charAt(0).toUpperCase();
    document.getElementById("userMode").textContent = user.isGuest ? "Offline / Guest" : "Cloud Synced";

    await loadData();

    if (state.pinHash && !state.unlocked) {
      showPinScreen("verify");
    } else {
      showApp();
    }

    if (SyncManager.canSync(user.uid)) {
      await SyncManager.pullAndMerge(user.uid);
      SyncManager.listen(user.uid, async () => { await loadData(); render(); });
    } else {
      SyncManager.setStatus(user.isGuest ? "offline" : "offline");
    }
  }

  async function loadData() {
    if (!state.notebooks.length) {
      const existing = await LocalDB.getAllNotebooks(state.user.uid);
      if (existing.length === 0) {
        // seed a default notebook
        const def = { id: Utils.uid(), name: "General", color: NB_COLORS[0], ownerId: state.user.uid, createdAt: Date.now() };
        await LocalDB.putNotebook(def);
        await SyncManager.pushNotebook(state.user.uid, def);
      }
    }
    state.notebooks = await LocalDB.getAllNotebooks(state.user.uid);
    state.notes = await LocalDB.getAllNotes(state.user.uid);
    render();
  }

  // ---------------- SCREENS ----------------
  function showAuth() {
    hideAllScreens();
    document.getElementById("authScreen").classList.remove("hidden");
  }
  function showPinScreen(mode) {
    hideAllScreens();
    state.pinBuffer = "";
    updatePinDots();
    document.getElementById("pinScreen").classList.remove("hidden");
    document.getElementById("pinTitle").textContent = mode === "set" ? "Set a new PIN" : "Enter your PIN";
    document.getElementById("pinScreen").dataset.mode = mode;
    document.getElementById("pinError").classList.add("hidden");
  }
  function showApp() {
    hideAllScreens();
    document.getElementById("appScreen").classList.remove("hidden");
    render();
  }
  function hideAllScreens() {
    ["authScreen", "pinScreen", "appScreen"].forEach(id => document.getElementById(id).classList.add("hidden"));
  }

  // ---------------- RENDER ----------------
  function render() {
    renderNotebookList();
    renderCounts();
    renderNotesGrid();
    renderTopbarTitle();
  }

  function renderTopbarTitle() {
    const map = { all: "All Notes", pinned: "Pinned", trash: "Trash" };
    let title = map[state.filter];
    if (!title) {
      const nb = state.notebooks.find(n => n.id === state.filter);
      title = nb ? nb.name : "Notes";
    }
    document.getElementById("topbarTitle").textContent = title;
  }

  function renderCounts() {
    const active = state.notes.filter(n => !n.trashed);
    document.getElementById("countAll").textContent = active.length;
    document.getElementById("countPinned").textContent = active.filter(n => n.pinned).length;
    document.getElementById("countTrash").textContent = state.notes.filter(n => n.trashed).length;
  }

  function renderNotebookList() {
    const list = document.getElementById("notebookList");
    list.innerHTML = "";
    state.notebooks.forEach(nb => {
      const div = document.createElement("div");
      div.className = "notebook-item" + (state.filter === nb.id ? " active" : "");
      div.innerHTML = `<span class="dot" style="background:${nb.color}"></span><span class="label">${Utils.escapeHtml(nb.name)}</span><i class="fa-solid fa-xmark nb-del" data-id="${nb.id}"></i>`;
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains("nb-del")) return;
        setFilter(nb.id);
      });
      div.querySelector(".nb-del").addEventListener("click", (e) => { e.stopPropagation(); confirmDeleteNotebook(nb); });
      list.appendChild(div);
    });
  }

  function getFilteredNotes() {
    let list = state.notes;
    if (state.filter === "trash") {
      list = list.filter(n => n.trashed);
    } else {
      list = list.filter(n => !n.trashed);
      if (state.filter === "pinned") list = list.filter(n => n.pinned);
      else if (state.filter !== "all") list = list.filter(n => n.notebookId === state.filter);
    }
    if (state.search.trim()) {
      const q = state.search.toLowerCase();
      list = list.filter(n => (n.title || "").toLowerCase().includes(q) || Utils.stripHtml(n.body || "").toLowerCase().includes(q));
    }
    return list.sort((a, b) => {
      if (state.filter !== "trash" && a.pinned !== b.pinned) return b.pinned - a.pinned;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function renderNotesGrid() {
    const grid = document.getElementById("notesGrid");
    const empty = document.getElementById("emptyState");
    const notes = getFilteredNotes();
    grid.innerHTML = "";

    if (notes.length === 0) {
      grid.classList.add("hidden");
      empty.classList.remove("hidden");
      const titleEl = document.getElementById("emptyTitle");
      const subEl = document.getElementById("emptySub");
      if (state.search.trim()) { titleEl.textContent = "No matches found"; subEl.textContent = `Nothing matches "${state.search}"`; }
      else if (state.filter === "trash") { titleEl.textContent = "Trash is empty"; subEl.textContent = "Deleted notes will appear here for 30 days."; }
      else if (state.filter === "pinned") { titleEl.textContent = "No pinned notes"; subEl.textContent = "Tap the star on a note to pin it here."; }
      else { titleEl.textContent = "No notes yet"; subEl.textContent = "Tap the + button to create your first note."; }
      return;
    }
    grid.classList.remove("hidden");
    empty.classList.add("hidden");

    notes.forEach((note, i) => {
      const nb = state.notebooks.find(n => n.id === note.notebookId);
      const card = document.createElement("div");
      card.className = "note-card" + (note.trashed ? " trashed" : "");
      card.style.animationDelay = (i * 0.03) + "s";
      const firstImg = (note.body || "").match(/<img[^>]+src="([^"]+)"/);
      const snippet = Utils.stripHtml(note.body || "") || "No additional text";

      card.innerHTML = `
        ${note.pinned && !note.trashed ? '<i class="fa-solid fa-star pin-flag"></i>' : ""}
        ${nb ? `<span class="nb-tag" style="background:${nb.color}22;color:${nb.color}">${Utils.escapeHtml(nb.name)}</span>` : ""}
        ${firstImg ? `<img class="thumb" src="${firstImg[1]}">` : ""}
        <h3>${Utils.escapeHtml(note.title || "Untitled")}</h3>
        <div class="snippet">${Utils.escapeHtml(snippet)}</div>
        <div class="card-foot"><span>${Utils.timeAgo(note.updatedAt)}</span></div>
        ${note.trashed ? `<div class="trash-actions"><button class="restore" data-id="${note.id}">Restore</button><button class="forever" data-id="${note.id}">Delete forever</button></div>` : ""}
      `;
      if (note.trashed) {
        card.querySelector(".restore").addEventListener("click", (e) => { e.stopPropagation(); restoreNote(note.id); });
        card.querySelector(".forever").addEventListener("click", (e) => { e.stopPropagation(); confirmHardDelete(note.id); });
      } else {
        card.addEventListener("click", () => openEditor(note.id));
      }
      grid.appendChild(card);
    });
  }

  function setFilter(f) {
    state.filter = f;
    document.querySelectorAll(".nav-item[data-filter]").forEach(b => b.classList.toggle("active", b.dataset.filter === f));
    render();
    closeSidebarMobile();
  }

  // ---------------- NOTES CRUD ----------------
  async function createNote() {
    const nbId = state.notebooks[0] ? state.notebooks[0].id : null;
    const note = {
      id: Utils.uid(), ownerId: state.user.uid, notebookId: nbId,
      title: "", body: "", pinned: false, trashed: false,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    await LocalDB.putNote(note);
    state.notes.push(note);
    SyncManager.pushNote(state.user.uid, note);
    openEditor(note.id, true);
  }

  async function saveCurrentNote() {
    const note = state.notes.find(n => n.id === state.currentNoteId);
    if (!note) return;
    note.title = document.getElementById("editorTitle").value.trim();
    note.body = document.getElementById("editorBody").innerHTML;
    note.notebookId = document.getElementById("editorNotebookSelect").value;
    note.updatedAt = Date.now();
    await LocalDB.putNote(note);
    SyncManager.pushNote(state.user.uid, note);
    document.getElementById("editorMeta").textContent = "Saved · " + new Date(note.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const debouncedSave = Utils.debounce(saveCurrentNote, 600);

  async function togglePin(id) {
    const note = state.notes.find(n => n.id === id);
    note.pinned = !note.pinned;
    note.updatedAt = Date.now();
    await LocalDB.putNote(note);
    SyncManager.pushNote(state.user.uid, note);
    updatePinIcon();
    render();
  }

  async function trashNote(id) {
    const note = state.notes.find(n => n.id === id);
    note.trashed = true;
    note.trashedAt = Date.now();
    note.updatedAt = Date.now();
    await LocalDB.putNote(note);
    SyncManager.pushNote(state.user.uid, note);
    closeEditor();
    render();
    Utils.toast("Note moved to Trash", "success");
  }

  async function restoreNote(id) {
    const note = state.notes.find(n => n.id === id);
    note.trashed = false;
    note.updatedAt = Date.now();
    await LocalDB.putNote(note);
    SyncManager.pushNote(state.user.uid, note);
    render();
    Utils.toast("Note restored", "success");
  }

  function confirmHardDelete(id) {
    openModal(`
      <h3>Delete forever?</h3>
      <p style="color:var(--text-dim);font-size:14px;margin-bottom:6px;">This note will be permanently deleted. This can't be undone.</p>
      <div class="modal-actions">
        <button class="cancel" id="modalCancel">Cancel</button>
        <button class="confirm danger" id="modalConfirm">Delete Forever</button>
      </div>
    `);
    document.getElementById("modalCancel").onclick = closeModal;
    document.getElementById("modalConfirm").onclick = async () => {
      await LocalDB.deleteNoteHard(id);
      SyncManager.deleteRemoteNote(state.user.uid, id);
      state.notes = state.notes.filter(n => n.id !== id);
      closeModal();
      render();
      Utils.toast("Note permanently deleted", "success");
    };
  }

  // ---------------- EDITOR ----------------
  function openEditor(id, focusTitle = false) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    state.currentNoteId = id;
    document.getElementById("editorTitle").value = note.title || "";
    document.getElementById("editorBody").innerHTML = note.body || "";
    document.getElementById("editorMeta").textContent = note.updatedAt ? "Saved · " + new Date(note.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "New note";

    const sel = document.getElementById("editorNotebookSelect");
    sel.innerHTML = state.notebooks.map(nb => `<option value="${nb.id}" ${nb.id === note.notebookId ? "selected" : ""}>${Utils.escapeHtml(nb.name)}</option>`).join("");
    updatePinIcon();

    document.getElementById("editorScreen").classList.remove("hidden");
    if (focusTitle) setTimeout(() => document.getElementById("editorTitle").focus(), 200);
  }

  function updatePinIcon() {
    const note = state.notes.find(n => n.id === state.currentNoteId);
    const btn = document.getElementById("editorPinBtn");
    if (!note) return;
    btn.classList.toggle("pinned", !!note.pinned);
    btn.innerHTML = note.pinned ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
  }

  function closeEditor() {
    document.getElementById("editorScreen").classList.add("hidden");
    state.currentNoteId = null;
    render();
  }

  // ---------------- NOTEBOOKS ----------------
  function openAddNotebookModal() {
    openModal(`
      <h3>New Notebook</h3>
      <div class="field"><i class="fa-regular fa-folder"></i><input type="text" id="nbName" placeholder="Notebook name" maxlength="30"></div>
      <div class="color-swatches" id="nbColors"></div>
      <div class="modal-actions">
        <button class="cancel" id="modalCancel">Cancel</button>
        <button class="confirm" id="modalConfirm">Create</button>
      </div>
    `);
    let chosenColor = NB_COLORS[Math.floor(Math.random() * NB_COLORS.length)];
    const colorWrap = document.getElementById("nbColors");
    NB_COLORS.forEach(c => {
      const s = document.createElement("span");
      s.style.background = c;
      if (c === chosenColor) s.classList.add("active");
      s.onclick = () => { chosenColor = c; colorWrap.querySelectorAll("span").forEach(x => x.classList.remove("active")); s.classList.add("active"); };
      colorWrap.appendChild(s);
    });
    document.getElementById("modalCancel").onclick = closeModal;
    document.getElementById("modalConfirm").onclick = async () => {
      const name = document.getElementById("nbName").value.trim();
      if (!name) { Utils.toast("Please enter a name", "warn"); return; }
      const nb = { id: Utils.uid(), name, color: chosenColor, ownerId: state.user.uid, createdAt: Date.now() };
      await LocalDB.putNotebook(nb);
      SyncManager.pushNotebook(state.user.uid, nb);
      state.notebooks.push(nb);
      closeModal();
      render();
      Utils.toast("Notebook created", "success");
    };
    setTimeout(() => document.getElementById("nbName").focus(), 150);
  }

  function confirmDeleteNotebook(nb) {
    openModal(`
      <h3>Delete "${Utils.escapeHtml(nb.name)}"?</h3>
      <p style="color:var(--text-dim);font-size:14px;">Notes inside will move to your first remaining notebook.</p>
      <div class="modal-actions">
        <button class="cancel" id="modalCancel">Cancel</button>
        <button class="confirm danger" id="modalConfirm">Delete</button>
      </div>
    `);
    document.getElementById("modalCancel").onclick = closeModal;
    document.getElementById("modalConfirm").onclick = async () => {
      await LocalDB.deleteNotebook(nb.id);
      state.notebooks = state.notebooks.filter(n => n.id !== nb.id);
      const fallback = state.notebooks[0];
      for (const note of state.notes.filter(n => n.notebookId === nb.id)) {
        note.notebookId = fallback ? fallback.id : null;
        await LocalDB.putNote(note);
        SyncManager.pushNote(state.user.uid, note);
      }
      if (state.filter === nb.id) state.filter = "all";
      closeModal();
      render();
    };
  }

  // ---------------- SEARCH ----------------
  function handleSearch(val) {
    state.search = val;
    document.getElementById("clearSearchBtn").classList.toggle("hidden", !val);
    render();
  }

  // ---------------- DARK MODE ----------------
  function applyTheme(theme, save = true) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    const icon = document.getElementById("darkModeIcon");
    const label = document.getElementById("darkModeLabel");
    if (icon) icon.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
    if (label) label.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
    if (save) LocalDB.setSetting("theme", theme);
  }
  function toggleTheme() { applyTheme(state.theme === "dark" ? "light" : "dark"); }

  // ---------------- PIN LOCK ----------------
  function updatePinDots() {
    document.querySelectorAll("#pinDots span").forEach((dot, i) => dot.classList.toggle("filled", i < state.pinBuffer.length));
  }
  async function handlePinKey(key) {
    if (key === "back") { state.pinBuffer = state.pinBuffer.slice(0, -1); updatePinDots(); return; }
    if (key === "fingerprint") return;
    if (state.pinBuffer.length >= 4) return;
    state.pinBuffer += key;
    updatePinDots();
    if (state.pinBuffer.length === 4) {
      const mode = document.getElementById("pinScreen").dataset.mode;
      const hash = await Utils.sha256(state.pinBuffer);
      if (mode === "set") {
        await LocalDB.setSetting("pinHash", hash);
        state.pinHash = hash;
        state.unlocked = true;
        Utils.toast("PIN lock enabled", "success");
        showApp();
      } else {
        if (hash === state.pinHash) {
          state.unlocked = true;
          showApp();
        } else {
          document.getElementById("pinError").classList.remove("hidden");
          const card = document.querySelector(".pin-card");
          card.style.animation = "none"; void card.offsetWidth; card.style.animation = "shake .3s ease";
          state.pinBuffer = "";
          updatePinDots();
        }
      }
    }
  }
  async function disablePin() {
    await LocalDB.setSetting("pinHash", null);
    state.pinHash = null;
    Utils.toast("PIN lock disabled", "success");
  }

  // ---------------- SETTINGS MODAL ----------------
  function openSettingsModal() {
    openModal(`
      <h3>Settings</h3>
      <div class="share-options">
        <button id="setPinOpt"><i class="fa-solid fa-shield-halved"></i> ${state.pinHash ? "Change PIN lock" : "Set up PIN lock"}</button>
        ${state.pinHash ? `<button id="removePinOpt"><i class="fa-solid fa-lock-open"></i> Remove PIN lock</button>` : ""}
        <button id="exportAllOpt"><i class="fa-solid fa-file-export"></i> Export all notes (.json)</button>
      </div>
      <div class="modal-actions"><button class="cancel" id="modalCancel" style="flex:1">Close</button></div>
    `);
    document.getElementById("modalCancel").onclick = closeModal;
    document.getElementById("setPinOpt").onclick = () => { closeModal(); showPinScreen("set"); };
    const rmBtn = document.getElementById("removePinOpt");
    if (rmBtn) rmBtn.onclick = async () => { await disablePin(); closeModal(); };
    document.getElementById("exportAllOpt").onclick = exportAllNotes;
  }

  function exportAllNotes() {
    const data = JSON.stringify(state.notes.filter(n => !n.trashed), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "my-notebook-export.json";
    a.click();
    URL.revokeObjectURL(url);
    closeModal();
    Utils.toast("Notes exported", "success");
  }

  // ---------------- SHARE / EXPORT SINGLE NOTE ----------------
  function openShareModal() {
    const note = state.notes.find(n => n.id === state.currentNoteId);
    if (!note) return;
    openModal(`
      <h3>Share / Export</h3>
      <div class="share-options">
        <button id="shareNative"><i class="fa-solid fa-share-nodes"></i> Share via...</button>
        <button id="exportTxt"><i class="fa-regular fa-file-lines"></i> Export as Text (.txt)</button>
        <button id="exportHtml"><i class="fa-solid fa-file-code"></i> Export as HTML</button>
        <button id="copyClipboard"><i class="fa-regular fa-copy"></i> Copy to clipboard</button>
      </div>
      <div class="modal-actions"><button class="cancel" id="modalCancel" style="flex:1">Close</button></div>
    `);
    document.getElementById("modalCancel").onclick = closeModal;

    document.getElementById("shareNative").onclick = async () => {
      const text = (note.title ? note.title + "\n\n" : "") + Utils.stripHtml(note.body);
      if (navigator.share) {
        try { await navigator.share({ title: note.title || "Note", text }); } catch (e) {}
      } else {
        Utils.toast("Share not supported on this device, copying instead", "warn");
        navigator.clipboard.writeText(text);
      }
      closeModal();
    };
    document.getElementById("exportTxt").onclick = () => {
      const text = (note.title ? note.title + "\n\n" : "") + Utils.stripHtml(note.body);
      downloadBlob(text, (note.title || "note") + ".txt", "text/plain");
      closeModal();
    };
    document.getElementById("exportHtml").onclick = () => {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${Utils.escapeHtml(note.title)}</title></head><body><h1>${Utils.escapeHtml(note.title)}</h1>${note.body}</body></html>`;
      downloadBlob(html, (note.title || "note") + ".html", "text/html");
      closeModal();
    };
    document.getElementById("copyClipboard").onclick = () => {
      const text = (note.title ? note.title + "\n\n" : "") + Utils.stripHtml(note.body);
      navigator.clipboard.writeText(text);
      Utils.toast("Copied to clipboard", "success");
      closeModal();
    };
  }
  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------- MODAL ----------------
  function openModal(html) {
    document.getElementById("modalBox").innerHTML = html;
    document.getElementById("modalOverlay").classList.remove("hidden");
  }
  function closeModal() { document.getElementById("modalOverlay").classList.add("hidden"); }

  // ---------------- SIDEBAR (mobile) ----------------
  function openSidebarMobile() { document.getElementById("sidebar").classList.add("open"); }
  function closeSidebarMobile() { document.getElementById("sidebar").classList.remove("open"); }

  // ---------------- IMAGE INSERT ----------------
  async function insertImage(file) {
    try {
      Utils.toast("Adding image...", "info", "fa-image");
      const dataUrl = await Utils.fileToCompressedDataURL(file);
      document.execCommand("insertHTML", false, `<img src="${dataUrl}">`);
      debouncedSave();
    } catch (e) {
      Utils.toast("Could not add image", "error");
    }
  }

  // ---------------- EVENTS ----------------
  function bindStaticEvents() {
    // Auth forms
    document.getElementById("toSignup").onclick = () => switchAuthForm(true);
    document.getElementById("toLogin").onclick = () => switchAuthForm(false);

    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("loginBtn");
      setBtnLoading(btn, true);
      try {
        await AuthManager.login(document.getElementById("loginEmail").value.trim(), document.getElementById("loginPassword").value);
      } catch (err) { showAuthError(err.message || "Login failed"); }
      setBtnLoading(btn, false);
    });

    document.getElementById("signupForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("signupBtn");
      setBtnLoading(btn, true);
      try {
        await AuthManager.signup(document.getElementById("signupName").value.trim(), document.getElementById("signupEmail").value.trim(), document.getElementById("signupPassword").value);
      } catch (err) { showAuthError(err.message || "Sign up failed"); }
      setBtnLoading(btn, false);
    });

    document.getElementById("forgotBtn").onclick = async () => {
      const email = document.getElementById("loginEmail").value.trim();
      if (!email) return showAuthError("Enter your email above first");
      try { await AuthManager.resetPassword(email); Utils.toast("Password reset email sent", "success"); }
      catch (err) { showAuthError(err.message); }
    };

    document.getElementById("guestBtn").onclick = async () => {
      const g = await AuthManager.getGuestUser();
      await LocalDB.setSetting("activeUser", g);
      await enterApp(g);
    };

    // PIN
    document.getElementById("pinKeypad").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) handlePinKey(btn.dataset.key);
    });
    document.getElementById("pinLogoutBtn").onclick = async () => { await AuthManager.logout(); location.reload(); };

    // Sidebar
    document.getElementById("openSidebarBtn").onclick = openSidebarMobile;
    document.getElementById("closeSidebarBtn").onclick = closeSidebarMobile;
    document.getElementById("sidebarOverlay").onclick = closeSidebarMobile;
    document.querySelectorAll(".nav-item[data-filter]").forEach(b => b.addEventListener("click", () => setFilter(b.dataset.filter)));
    document.getElementById("addNotebookBtn").onclick = openAddNotebookModal;
    document.getElementById("darkModeBtn").onclick = toggleTheme;
    document.getElementById("logoutBtn").onclick = async () => { await AuthManager.logout(); location.reload(); };
    document.getElementById("settingsBtn").onclick = openSettingsModal;

    // Search
    document.getElementById("searchInput").addEventListener("input", (e) => handleSearch(e.target.value));
    document.getElementById("clearSearchBtn").onclick = () => { document.getElementById("searchInput").value = ""; handleSearch(""); };

    // New note / editor
    document.getElementById("newNoteBtn").onclick = createNote;
    document.getElementById("editorBackBtn").onclick = async () => { await saveCurrentNote(); closeEditor(); };
    document.getElementById("editorTitle").addEventListener("input", debouncedSave);
    document.getElementById("editorBody").addEventListener("input", debouncedSave);
    document.getElementById("editorNotebookSelect").addEventListener("change", debouncedSave);
    document.getElementById("editorPinBtn").onclick = () => togglePin(state.currentNoteId);
    document.getElementById("editorDeleteBtn").onclick = () => trashNote(state.currentNoteId);
    document.getElementById("editorShareBtn").onclick = openShareModal;

    // Toolbar
    document.querySelectorAll(".editor-toolbar [data-cmd]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
        document.getElementById("editorBody").focus();
        debouncedSave();
      });
    });
    document.getElementById("insertImageBtn").onclick = () => document.getElementById("imageInput").click();
    document.getElementById("imageInput").addEventListener("change", (e) => {
      if (e.target.files[0]) insertImage(e.target.files[0]);
      e.target.value = "";
    });

    // Modal overlay click-to-close
    document.getElementById("modalOverlay").addEventListener("click", (e) => { if (e.target.id === "modalOverlay") closeModal(); });

    // Offline/online toast
    window.addEventListener("offline", () => Utils.toast("You're offline. Changes are saved locally.", "warn", "fa-wifi"));
    window.addEventListener("online", () => Utils.toast("Back online. Syncing...", "success", "fa-wifi"));

    // Back button (Android hardware / browser) closes editor/modal instead of exiting
    window.addEventListener("popstate", () => {
      if (!document.getElementById("modalOverlay").classList.contains("hidden")) closeModal();
      else if (!document.getElementById("editorScreen").classList.contains("hidden")) closeEditor();
    });
  }

  function switchAuthForm(toSignup) {
    document.getElementById("loginForm").classList.toggle("hidden", toSignup);
    document.getElementById("signupForm").classList.toggle("hidden", !toSignup);
    document.getElementById("toSignupText").classList.toggle("hidden", toSignup);
    document.getElementById("toLoginText").classList.toggle("hidden", !toSignup);
    document.getElementById("authError").classList.add("hidden");
  }
  function showAuthError(msg) {
    const el = document.getElementById("authError");
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function setBtnLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector("span") && (btn.querySelector("span").textContent = loading ? "Please wait..." : btn.dataset.originalText || btn.querySelector("span").textContent);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
