# My Notebook — Premium Digital Notebook App

A fully functional notebook app: notes, notebooks/folders, rich text, image
attachments, search, pin/favorite, trash + restore, dark/light mode, PIN lock,
share/export, offline-first local storage (IndexedDB), and Firebase
Authentication + Firestore cloud sync.

Built as plain **HTML/CSS/JS** (no build tools required) so it runs directly
in a browser, as a PWA, or wrapped with **Cordova** into an Android APK/AAB —
which is why it works well with **Acode** on your phone.

---

## 1. Project structure

```
MyNotebook/
├── index.html          # App shell / all screens
├── manifest.json        # PWA manifest
├── sw.js                 # Offline service worker
├── config.xml            # Cordova config (for APK/AAB build)
├── package.json           # Cordova/npm scripts
├── firestore.rules         # Firestore security rules
├── css/style.css            # All styling (light + dark theme)
├── js/
│   ├── firebase-config.js    # <-- put YOUR Firebase keys here
│   ├── db.js                  # IndexedDB local storage (offline-first)
│   ├── utils.js                 # helpers (id gen, hashing, toasts, image compress)
│   ├── auth.js                   # Firebase Auth wrapper + guest mode
│   ├── sync.js                    # Firestore sync (push/pull/listen, merge)
│   └── app.js                      # Main app controller / UI logic
└── icons/                            # App icons
```

---

## 2. Quick run (no build tools, works offline as Guest immediately)

You can literally just open `index.html` in a browser, or serve the folder:

```bash
cd MyNotebook
python3 -m http.server 8080
# open http://localhost:8080 in your browser
```

Tap **"Continue Offline (Guest)"** on the login screen — the whole app
(notes, notebooks, pin, dark mode, images, PIN lock, export) works fully
without any Firebase setup, using IndexedDB on the device.

---

## 3. Enable Firebase (cloud sync + real accounts)

1. Go to https://console.firebase.google.com → **Add project**.
2. Inside the project, click **Add app → Web (</>)**, register it, and copy
   the `firebaseConfig` object it gives you.
3. Paste those values into `js/firebase-config.js`, replacing the
   `YOUR_...` placeholders.
4. In the Firebase console:
   - **Authentication → Sign-in method** → enable **Email/Password**.
   - **Firestore Database → Create database** → start in **production
     mode** (any region).
   - **Firestore → Rules** tab → paste the contents of `firestore.rules`
     from this project and click **Publish**. This ensures every user can
     only read/write their own notes (`/users/{uid}/notes/...`).
5. Reload the app. Sign up with a real email/password — notes will now sync
   across devices in real time, and still work offline via the local
   IndexedDB cache + Firestore's own offline persistence.

> If you skip Firebase setup, the app **still works fully** — it just stays
> local-only (Guest mode). No crashes, no dead buttons — this was tested for
> the offline / error path explicitly (see §6).

---

## 4. Running & editing with Acode (on your Android phone)

1. Install **Acode** from the Play Store.
2. Copy/extract the `MyNotebook` folder onto your phone's storage.
3. In Acode: **Open Folder** → select `MyNotebook`.
4. Edit `js/firebase-config.js` directly in Acode with your Firebase keys.
5. To preview: install the **Acode Live Preview** plugin (or any plugin like
   "Web Preview"/"In-App Browser") from Acode's plugin marketplace, open
   `index.html`, and tap the preview/run icon. This serves the folder over
   `http://localhost` so IndexedDB + Service Worker behave correctly (opening
   as a bare `file://` path will disable some browser storage APIs).

---

## 5. Building the Android APK / AAB

You have two options. **Option A (recommended, done from Acode)** uses
Acode's own Cordova-based Android build plugin. **Option B** is the standard
Cordova CLI flow if you have a computer with Node.js + Android Studio.

### Option A — Build directly from Acode (on-device)

1. In Acode, open the **Plugins** marketplace and install **"Acode Build
   APK"** (a.k.a. the Cordova/Android build plugin for Acode — search
   "build" or "apk" in the plugin list; Acode maintains this specifically so
   projects like this one can be compiled to `.apk` without a PC).
2. Make sure your project has `config.xml` at the root (already included
   here) — the plugin reads it for the app id, name, version and icons.
3. Open the command palette → **Build APK** (or the build icon in the
   sidebar). Choose **Debug** for a quick test build, or **Release** if
   you've configured a signing keystore in the plugin settings.
4. The plugin downloads/uses a bundled Android SDK + Gradle and produces the
   `.apk` file, prompting you to install it directly on your phone.

> Plugin names/UI can change between Acode versions — if you don't see a
> build option, update Acode and check the Plugins store for "APK Builder" /
> "Cordova Build".

### Option B — Standard Cordova CLI (PC with Node.js + Android Studio/SDK)

```bash
# 1. Install prerequisites once
npm install -g cordova
# Install Android Studio, then via SDK Manager install:
#   Android SDK Platform (matching config.xml targetSdkVersion), 
#   Android SDK Build-Tools, Android SDK Platform-Tools, and a JDK 17.
# Set ANDROID_HOME / ANDROID_SDK_ROOT env vars to the SDK path.

# 2. From inside the MyNotebook folder:
cd MyNotebook
cordova platform add android

# 3. Debug APK (unsigned, for testing on your device):
cordova build android
# Output: platforms/android/app/build/outputs/apk/debug/app-debug.apk

# 4. Release build (for Play Store — AAB is required there):
cordova build android --release -- --packageType=bundle
# Output: platforms/android/app/build/outputs/bundle/release/app-release.aab
```

To sign a release build for the Play Store:

```bash
keytool -genkey -v -keystore my-notebook.keystore -alias mynotebook \
  -keyalg RSA -keysize 2048 -validity 10000

# Then sign the AAB:
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore my-notebook.keystore app-release.aab mynotebook

# And align/optimize with bundletool or Play Console upload (Play Console
# can also sign it for you via "Play App Signing" — recommended default).
```

Install the debug APK directly on your phone for testing:

```bash
adb install platforms/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 6. How the app handles real-world states (not just a UI demo)

- **Loading**: splash screen on boot; sync icon in the top bar animates
  while pushing/pulling Firestore data; auth buttons show "Please wait..."
  and disable themselves during network calls.
- **Empty states**: dedicated empty screens for "no notes yet", "no search
  results", "no pinned notes", and "trash is empty", each with distinct
  copy.
- **Errors**: login/signup failures show an inline error banner with
  Firebase's message (bad password, email in use, etc.); toast
  notifications surface non-blocking errors (e.g. "Could not add image").
- **Offline / no Firebase configured**: the app detects `firebaseReady`
  and `navigator.onLine` and — instead of hanging or crashing — automatically
  falls back to local-only mode, shows an "Offline" cloud icon, and queues
  nothing-to-lose: every note is already safely in IndexedDB. When the
  device reconnects, a `window.addEventListener("online", ...)` hook
  triggers `SyncManager.pullAndMerge()` automatically to reconcile local vs
  remote using a `updatedAt` timestamp (last-write-wins).
- **Automatic local saving**: title/body/notebook changes are debounced
  (600ms) and written to IndexedDB (and pushed to Firestore if online) —
  there is no explicit "Save" button needed; closing the editor also forces
  an immediate save.

---

## 7. Feature checklist (all implemented)

- [x] Home screen with all notes (responsive card grid)
- [x] Create New Note (floating action button)
- [x] Rich text editing (bold/italic/underline/lists/headings/undo, via
      `contenteditable` + `document.execCommand`)
- [x] Notebook/folder system (create, color-tag, delete with reassignment)
- [x] Search notes (title + body, live filtering)
- [x] Pin/Favorite notes (starred, sorted to top)
- [x] Delete & Restore (soft-delete to Trash, hard-delete "forever")
- [x] Dark & light mode (CSS variables, persisted)
- [x] PIN/password lock (4-digit PIN, SHA-256 hashed, stored locally)
- [x] Add images to notes (compressed to base64, inserted inline)
- [x] Share/export notes (native Web Share, .txt, .html, clipboard, full
      JSON export of all notes)
- [x] Automatic local saving (IndexedDB, debounced)
- [x] Firebase Authentication (email/password, guest/offline fallback)
- [x] Firebase Firestore cloud sync (realtime listeners + merge)
- [x] Responsive design for Android phones (mobile-first CSS, collapsible
      sidebar, bottom FAB, full-screen editor)
- [x] Premium animations (splash, card stagger-in, modal slide-up, editor
      slide-in, FAB pop, PIN shake, toasts)

---

## 8. Notes on customization

- Change the accent color/gradient: edit `--accent`, `--accent2`,
  `--accent-grad` in `css/style.css`.
- Change the app id/name for the APK: edit `id`/`<name>` in `config.xml`.
- Add Google/Apple sign-in: add the relevant Firebase Auth provider in the
  console and a new button in `index.html` calling
  `auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())` inside
  `js/auth.js`.
