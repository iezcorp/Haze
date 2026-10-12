/* =========================================================
   Local-only auth (no backend)
   - Accounts:  localStorage  (cookies are too small for a user list)
   - Session:   cookie "session" (falls back to localStorage when the
                browser blocks cookies, e.g. opening index.html via file://)
   NOTE: This is a front-end demo. Anyone with access to this browser
   can read the stored data, so don't use it to protect anything real.
   ========================================================= */

const USERS_KEY = "glass.users";
const SESSION_KEY = "session";
const SESSION_DAYS = 7;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- Cookies ---------- */
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

const cookiesWork = (() => {
  try {
    document.cookie = "cookietest=1; path=/; SameSite=Lax";
    const ok = document.cookie.includes("cookietest=1");
    document.cookie = "cookietest=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    return ok;
  } catch {
    return false;
  }
})();

/* ---------- Session ---------- */
function saveSession(email, remember = true) {
  if (cloudOn()) return; // Supabase session is persisted at login time
  const payload = JSON.stringify({ email });
  if (cookiesWork) {
    if (remember) setCookie(SESSION_KEY, payload, SESSION_DAYS);
    else document.cookie = `${SESSION_KEY}=${encodeURIComponent(payload)}; path=/; SameSite=Lax`;
  } else if (remember) {
    localStorage.setItem(SESSION_KEY, payload);
  } else {
    sessionStorage.setItem(SESSION_KEY, payload);
  }
}

function readSession() {
  if (cloudOn()) {
    const s = readSupaSession();
    return s && s.user ? { email: s.user.email } : null;
  }
  try {
    const raw = cookiesWork
      ? getCookie(SESSION_KEY)
      : localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  if (cookiesWork) deleteCookie(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("glass.supa.session");
  sessionStorage.removeItem("glass.supa.session");
}

/* ---------- Users ---------- */
function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

/* ---------- Password hashing (never store the plain password) ---------- */
const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex) =>
  new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

function newSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function hashPassword(password, saltHex) {
  if (window.crypto && crypto.subtle) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: fromHex(saltHex), iterations: 150000, hash: "SHA-256" },
      key,
      256
    );
    return toHex(bits);
  }
  // Weak fallback for contexts without Web Crypto
  let h = 5381;
  const s = saltHex + password;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* ---------- UI ---------- */
const authView = $("#auth-view");
const stage = $(".stage");
const desktop = $("#desktop");
const dock = $("#dock");
const toastEl = $("#toast");

/* Surface runtime errors on screen instead of failing silently.
   If anything breaks on any machine, the message shows up here. */
window.addEventListener("error", (e) => {
  const msg = e && e.message ? String(e.message).slice(0, 160) : "";
  if (!msg || /Script error/i.test(msg)) return;
  try {
    toastEl.textContent = "Error: " + msg;
    toastEl.classList.add("show");
  } catch { /* reporting must never break the app itself */ }
});
const form = $("#auth-form");
const message = $("#message");
const submitBtn = $("#submit");
const modeSwitch = $("#mode-switch");
const signupOnly = document.querySelectorAll('[data-only="signup"]');
const passwordInput = $("#password");
const settingsWin = $("#settings-window");
const settingsBtn = dock.querySelector('[data-app="Settings"]');
const browsyWin = $("#browsy-window");
const browsyBtn = dock.querySelector('[data-app="Browsy"]');
const indexyWin = $("#indexy-window");
const indexyBtn = dock.querySelector('[data-app="Indexy"]');
const gamesWin = $("#games-window");
const gamesBtn = dock.querySelector('[data-app="Games"]');
const storeWin = $("#store-window");
const storeBtn = dock.querySelector('[data-app="Store"]');
const driftWin = $("#drift-window");
const driftBtn = dock.querySelector('[data-app="Drift"]');

/* ---------- Window focus order + right-click menu ---------- */
const APPS = [
  { name: "Settings", win: settingsWin, open: openSettings, close: () => closeSettings(true), min: () => { settingsWin.hidden = true; stopPingLoop(); } },
  { name: "Browsy", win: browsyWin, open: openBrowsy, close: () => closeBrowsy(true), min: () => { browsyWin.hidden = true; } },
  { name: "Indexy", win: indexyWin, open: openIndexy, close: () => closeIndexy(true), min: () => { indexyWin.hidden = true; } },
  { name: "Games", win: gamesWin, open: openGames, close: () => closeGames(true), min: () => { stopGame(); gamesWin.hidden = true; } },
  { name: "Drift", win: driftWin, open: openDrift, close: () => closeDrift(true), min: () => closeDrift(false) },
  { name: "Store", label: "Shop", win: storeWin, open: openStore, close: () => closeStore(true), min: () => { storeWin.hidden = true; } },
];
for (const a of APPS) a.max = () => a.win.classList.toggle("max");

/* Front window is last; z stays in 30..34 so toast/spotlight always win. */
let winOrder = [];
function focusWindow(win) {
  if (!win || win.hidden) return;
  winOrder = winOrder.filter((w) => w !== win && !w.hidden);
  winOrder.push(win);
  winOrder.forEach((w, i) => { w.style.zIndex = String(30 + i); });
  try { if (typeof updateHazeTitle === "function") updateHazeTitle(); } catch { /* noop */ }
}
function showApp(app) {
  if (!app) return;
  if (app.win.hidden) app.open();
  focusWindow(app.win);
  try { if (typeof updateHazeTitle === "function") updateHazeTitle(); } catch { /* noop */ }
}
/* Clicking any window raises it above the rest (runs before drag handlers). */
document.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return;
  const w = e.target && e.target.closest ? e.target.closest(".window") : null;
  if (w && !w.hidden) focusWindow(w);
}, true);

const ctxmenu = $("#ctxmenu");
const ctxTitle = $("#ctx-title");
const ctxWins = $("#ctx-wins");
let ctxApp = null;

function hideCtx() {
  if (!ctxmenu) return;
  ctxmenu.hidden = true;
  ctxApp = null;
}

function renderCtxWins() {
  ctxWins.innerHTML = "";
  APPS.forEach((a) => {
    const open = !a.win.hidden;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ctx-item";
    const dot = document.createElement("span");
    dot.className = "ctx-dot" + (open ? " on" : "");
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = a.label || a.name;
    const hint = document.createElement("span");
    hint.className = "ctx-hint";
    hint.textContent = open ? "Focus" : "Open";
    b.append(dot, label, hint);
    b.addEventListener("click", () => { hideCtx(); showApp(a); });
    ctxWins.appendChild(b);
  });
}

function openCtx(app, x, y) {
  ctxApp = app;
  ctxTitle.textContent = app.label || app.name;
  renderCtxWins();
  ctxmenu.hidden = false;
  ctxmenu.classList.remove("show");
  void ctxmenu.offsetWidth;
  ctxmenu.classList.add("show");
  const pad = 8;
  const r = ctxmenu.getBoundingClientRect();
  ctxmenu.style.left = Math.min(Math.max(x, pad), Math.max(pad, innerWidth - r.width - pad)) + "px";
  ctxmenu.style.top = Math.min(Math.max(y, pad), Math.max(pad, innerHeight - r.height - pad)) + "px";
}

ctxmenu.addEventListener("click", (e) => {
  const item = e.target.closest("[data-act]");
  if (!item || !ctxApp) return;
  const app = ctxApp;
  const act = item.dataset.act;
  hideCtx();
  if (act === "close") app.close(true);
  else if (act === "min") app.min();
  else if (act === "max") { focusWindow(app.win); app.max(); }
});

document.addEventListener("contextmenu", (e) => {
  const t = e.target && e.target.closest ? e.target.closest(".window") : null;
  if (t && !t.hidden) {
    const app = APPS.find((a) => a.win === t);
    if (!app) return;
    e.preventDefault();
    focusWindow(t);
    openCtx(app, e.clientX, e.clientY);
    return;
  }
  const btn = e.target && e.target.closest ? e.target.closest("#dock .app") : null;
  if (btn && btn.dataset.app) {
    const app = APPS.find((a) => a.name === btn.dataset.app);
    if (!app) return;
    e.preventDefault();
    openCtx(app, e.clientX, e.clientY);
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!ctxmenu.hidden && !e.target.closest("#ctxmenu")) hideCtx();
}, true);
window.addEventListener("blur", hideCtx);
document.addEventListener("scroll", () => { if (!ctxmenu.hidden) hideCtx(); }, true);
const spot = $("#spotlight");
const spotInput = $("#spot-input");
const spotResults = $("#spot-results");
const spotCaret = $("#spot-caret");
const spotPill = document.querySelector(".spot-pill");
const caretRulerSpot = document.createElement("span");

function syncSpotRuler() {
  const cs = getComputedStyle(spotInput);
  Object.assign(caretRulerSpot.style, {
    fontStyle: cs.fontStyle,
    fontWeight: cs.fontWeight,
    fontSize: cs.fontSize,
    fontFamily: cs.fontFamily,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
  });
}

function placeSpotCaret(restart = true) {
  const focused = document.activeElement === spotInput;
  spotPill.classList.toggle("focused", focused);
  spotPill.classList.toggle("has-value", !!spotInput.value);
  if (!focused) return;
  const value = spotInput.value;
  caretRulerSpot.textContent = value.slice(0, spotInput.selectionStart);
  const prefixWidth = caretRulerSpot.getBoundingClientRect().width;
  const inner = spotInput.clientWidth;
  const x = Math.min(Math.max(prefixWidth - spotInput.scrollLeft, 0), inner);
  // 46px includes the pill's border/padding, search icon, and flex gap.
  spotCaret.style.left = "calc(46px + " + x + "px)";
  if (restart) {
    spotCaret.style.animation = "none";
    void spotCaret.offsetWidth;
    spotCaret.style.animation = "";
  }
}

Object.assign(caretRulerSpot.style, {
  position: "absolute",
  visibility: "hidden",
  whiteSpace: "pre",
  top: "-9999px",
  left: "0",
});
document.body.appendChild(caretRulerSpot);
syncSpotRuler();

let mode = "login";
let settleTimer;

function setMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

function markInvalid(...inputs) {
  document.querySelectorAll("input").forEach((i) => i.removeAttribute("aria-invalid"));
  inputs.forEach((i) => i.setAttribute("aria-invalid", "true"));
  if (inputs[0]) inputs[0].focus();
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let userAnimationsEnabled = true;
function motionAllowed() {
  return !reduceMotion.matches && userAnimationsEnabled;
}
const EASE = "cubic-bezier(0.33, 1, 0.68, 1)";

function fadeIn(el, y = 6) {
  if (!motionAllowed()) return;
  el.animate(
    [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: "translateY(0)" }],
    { duration: 500, easing: EASE }
  );
}

function setMode(next, animate = true) {
  mode = next;
  const isSignup = mode === "signup";
  const canAnimate = animate && motionAllowed();

  modeSwitch.dataset.mode = mode;
  $("#tab-login").setAttribute("aria-selected", String(!isSignup));
  $("#tab-signup").setAttribute("aria-selected", String(isSignup));

  clearTimeout(settleTimer);
  signupOnly.forEach((el) => {
    el.inert = !isSignup;
    el.classList.toggle("open", isSignup);
    if (!isSignup) el.classList.remove("settled");
  });
  if (isSignup) {
    settleTimer = setTimeout(
      () => signupOnly.forEach((el) => el.classList.add("settled")),
      canAnimate ? 720 : 0
    );
  }
  $("#auth-title").textContent = isSignup ? "Create account" : "Welcome back";
  $("#auth-sub").textContent = isSignup
    ? "Sign up to get started."
    : "Log in to continue.";
  submitBtn.textContent = isSignup ? "Create account" : "Log in";
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";

  setMessage("");
  document.querySelectorAll("input").forEach((i) => i.removeAttribute("aria-invalid"));

  if (!canAnimate) return;

  // Text and new fields ease in
  fadeIn($("#auth-title"), 4);
  fadeIn($("#auth-sub"), 4);
}

let currentUser = null;
let stayOn = true;
let activeAvatarDecoration = null;
const AVATAR_DECORATIONS = [
  { id: "blossom", name: "Blossom", cost: 300, description: "A flowering branch for your avatar.", image: "images/Avatar Decoration/Blossm.png" },
];

function showHome(user, opts = {}) {
  currentUser = user;
  activateGameDataAccount(user && user.email);
  stage.hidden = true;
  desktop.hidden = false;
  document.body.classList.add("in-desktop");
  dock.classList.remove("boot");
  void dock.offsetWidth;
  dock.classList.add("boot");
  applyAvatar();
  refreshMistWallet().then(async () => {
    try { await claimLoginMistGifts(); } catch { /* wallet setup may be unavailable */ }
    applyAvatar();
  }).catch(() => { /* wallet UI reports its own load state */ });
  if (opts.notify !== false && prefs.sessionNotifications !== false) {
    const kind = opts.kind || "back";
    showHazeWelcome(user, kind, opts.sound === true);
  }
  try { gcalRefresh(); } catch { /* calendar must never break login */ }
  try {
    const s = driftSession();
    if (s) {
      driftEnsureUsername(s).then((handle) => { driftUsername = handle; }).catch(() => { /* Drift warms up on open */ });
      loadDriftContacts(true).catch(() => { /* Drift warms up on open */ });
    }
  } catch { /* background warm-up must never break login */ }
}

/* ---------- Haze welcome notification (bottom-right + custom chime) ---------- */
let hazeNotifTimer = null;
let hazeHideTimer = null;
let hazeAudioCtx = null;
let hazeChimeQueued = false;
const HAZE_NOTIF_SOUND_SRC = "Sounds/Notifications/General-Notification.wav";
let hazeNotifAudio = null;

function getHazeNotifAudio() {
  if (hazeNotifAudio) return hazeNotifAudio;
  try {
    const a = new Audio(HAZE_NOTIF_SOUND_SRC);
    a.preload = "auto";
    a.volume = 0.6;
    hazeNotifAudio = a;
  } catch { /* audio unsupported — synth fallback below */ }
  return hazeNotifAudio;
}

// Warm up so the first login plays instantly.
try { getHazeNotifAudio(); } catch { /* noop */ }

function playHazeSynthFallback() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!hazeAudioCtx) {
      try { hazeAudioCtx = new AC(); }
      catch { return; }
    }
    const ctx = hazeAudioCtx;
    const startChime = () => {
      try {
        const t = ctx.currentTime + 0.01;
        const notes = [
          [659.25, 0, 0.20],
          [830.61, 0.11, 0.20],
          [987.77, 0.22, 0.34],
        ];
        notes.forEach(([freq, delay, vol]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, t + delay);
          gain.gain.setValueAtTime(0.0001, t + delay);
          gain.gain.exponentialRampToValueAtTime(vol, t + delay + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.65);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + delay);
          osc.stop(t + delay + 0.7);
        });
      } catch { /* sound must never break login */ }
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(startChime).catch(() => {
        if (!hazeChimeQueued) {
          hazeChimeQueued = true;
          const retry = () => {
            hazeChimeQueued = false;
            window.removeEventListener("pointerdown", retry);
            window.removeEventListener("keydown", retry);
            playHazeChime();
          };
          window.addEventListener("pointerdown", retry, { once: true });
          window.addEventListener("keydown", retry, { once: true });
        }
      });
      return;
    }
    startChime();
  } catch { /* noop */ }
}

function playHazeChime() {
  const audio = getHazeNotifAudio();
  if (!audio) {
    playHazeSynthFallback();
    return;
  }
  try {
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        // Autoplay blocked or file missing — retry on first gesture,
        // then fall back to synth so there is always feedback.
        if (!hazeChimeQueued) {
          hazeChimeQueued = true;
          const retry = () => {
            hazeChimeQueued = false;
            window.removeEventListener("pointerdown", retry);
            window.removeEventListener("keydown", retry);
            playHazeChime();
          };
          window.addEventListener("pointerdown", retry, { once: true });
          window.addEventListener("keydown", retry, { once: true });
        }
        playHazeSynthFallback();
      });
    }
  } catch {
    playHazeSynthFallback();
  }
}

const HAZE_NOTIF_DURATION = 5200;
let hazeNotifEndsAt = 0;
let hazeNotifRemaining = 0;

function stampHazeNotifTime() {
  const t = $("#haze-notif-time");
  if (!t) return;
  try {
    t.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    t.textContent = "now";
  }
}

function hideHazeNotif() {
  const el = $("#haze-notif");
  if (!el || el.hidden) return;
  clearTimeout(hazeNotifTimer);
  clearTimeout(hazeHideTimer);
  hazeNotifEndsAt = 0;
  hazeNotifRemaining = 0;
  el.classList.remove("show", "paused");
  el.classList.add("hide");
  hazeHideTimer = setTimeout(() => {
    el.hidden = true;
    el.classList.remove("hide");
  }, 250);
}

function showHazeNotif(title, sub) {
  const el = $("#haze-notif");
  if (!el) return;
  clearTimeout(hazeNotifTimer);
  clearTimeout(hazeHideTimer);
  $("#haze-notif-title").textContent = title;
  $("#haze-notif-sub").textContent = sub;
  $("#haze-notif-sub").title = sub;
  stampHazeNotifTime();
  el.hidden = false;
  el.classList.remove("hide", "show", "paused");
  void el.offsetWidth;
  el.classList.add("show");
  hazeNotifRemaining = HAZE_NOTIF_DURATION;
  hazeNotifEndsAt = Date.now() + HAZE_NOTIF_DURATION;
  hazeNotifTimer = setTimeout(hideHazeNotif, HAZE_NOTIF_DURATION);
}

function pauseHazeNotif() {
  const el = $("#haze-notif");
  if (!el || el.hidden || !el.classList.contains("show")) return;
  const left = hazeNotifEndsAt - Date.now();
  if (left <= 0) return;
  hazeNotifRemaining = left;
  clearTimeout(hazeNotifTimer);
  el.classList.add("paused");
}

function resumeHazeNotif() {
  const el = $("#haze-notif");
  if (!el || el.hidden || !el.classList.contains("paused")) return;
  el.classList.remove("paused");
  hazeNotifEndsAt = Date.now() + hazeNotifRemaining;
  clearTimeout(hazeNotifTimer);
  hazeNotifTimer = setTimeout(hideHazeNotif, hazeNotifRemaining);
}

function showHazeWelcome(user, kind, audible) {
  const rawName = (user && user.name) || String((user && user.email) || "").split("@")[0] || "there";
  const name = String(rawName).slice(0, 24) || "there";
  const email = (user && user.email) || "";
  let title = "Welcome to Haze";
  let sub = email ? "Signed in as " + email : "Signed in";
  if (kind === "new") {
    title = "Welcome to Haze, " + name;
    sub = "Your account is ready";
  } else if (kind === "return") {
    title = "Welcome back to Haze";
    sub = "Signed you back in as " + (email || name);
  } else {
    title = "Welcome back, " + name;
    sub = email ? "Signed in as " + email : "Signed in to Haze";
  }
  setTimeout(() => {
    // Don't notify if the user already signed out again.
    if (desktop.hidden) return;
    showHazeNotif(title, sub);
    // Sound only on manual login (a real user gesture) — never on
    // refresh/session restore, where browsers would block it anyway.
    if (audible) playHazeChime();
  }, 100);
}

$("#haze-notif-close").addEventListener("click", hideHazeNotif);
try {
  const hazeNotifEl = $("#haze-notif");
  if (hazeNotifEl) {
    hazeNotifEl.addEventListener("mouseenter", pauseHazeNotif);
    hazeNotifEl.addEventListener("mouseleave", resumeHazeNotif);
    hazeNotifEl.addEventListener("click", (e) => {
      if (!e.target.closest("#haze-notif-close")) hideHazeNotif();
    });
  }
} catch { /* notification extras are optional */ }

/* ---------- Profile pictures (per-user, stored locally) ---------- */
const AVATAR_DEFAULT = "images/Default-User-Icon.png";

function userPic(email) {
  if (!email) return "";
  try {
    const users = loadUsers();
    const u = users[String(email).trim().toLowerCase()];
    return u && u.pic ? u.pic : "";
  } catch { return ""; }
}

function applyAvatar() {
  const src = (currentUser && userPic(currentUser.email)) || AVATAR_DEFAULT;
  const a = document.querySelector("#profile-avatar img");
  if (a) a.src = src;
  const b = document.querySelector("#account-avatar img");
  if (b) b.src = src;
  [$("#profile-avatar"), $("#account-avatar")].forEach((avatar) => {
    if (!avatar) return;
    if (activeAvatarDecoration) avatar.dataset.decoration = activeAvatarDecoration;
    else delete avatar.dataset.decoration;
    avatar.querySelectorAll(".avatar-decoration-art").forEach((art) => art.remove());
    const decoration = AVATAR_DECORATIONS.find((item) => item.id === activeAvatarDecoration);
    if (decoration && decoration.image) {
      const art = document.createElement("img");
      art.className = "avatar-decoration-art";
      art.src = decoration.image;
      art.alt = "";
      art.setAttribute("aria-hidden", "true");
      avatar.appendChild(art);
    }
  });
  const profile = $(".profile");
  if (profile) profile.classList.toggle("has-avatar-decoration", activeAvatarDecoration === "blossom");
  try {
    if (currentUser && typeof driftPaintMyAvatar === "function" && !$("#drift-window").hidden) {
      driftPaintMyAvatar();
      if (typeof driftContactsCache !== "undefined" && driftContactsCache.length) renderDriftContacts(driftContactsCache);
    }
  } catch { /* Drift header is optional */ }
}

function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("not an image"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const S = 256;
        const side = Math.max(1, Math.min(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = S;
        c.height = S;
        c.getContext("2d").drawImage(
          img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S
        );
        resolve(c.toDataURL("image/jpeg", 0.85));
      } catch (err) { reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    img.src = url;
  });
}

async function handleAvatarFile(file) {
  if (!currentUser) return;
  const key = String(currentUser.email || "").trim().toLowerCase();
  if (!key) return;
  try {
    const dataUrl = await fileToAvatar(file);
    const users = loadUsers();
    if (!users[key]) users[key] = { name: key.split("@")[0], createdAt: Date.now() };
    users[key].pic = dataUrl;
    saveUsers(users);
    applyAvatar();
    try { renderReviews(); } catch { /* games view not open */ }
    driftPushAvatar(dataUrl).catch(() => { /* avatar stays local-only */ });
    toast("Profile picture updated");
  } catch {
    toast("Couldn't use that image — try another file");
  }
}

function clearAvatar() {
  if (!currentUser) return;
  const key = String(currentUser.email || "").trim().toLowerCase();
  try {
    const users = loadUsers();
    if (users[key]) {
      delete users[key].pic;
      saveUsers(users);
    }
  } catch { /* noop */ }
  applyAvatar();
  try { renderReviews(); } catch { /* games view not open */ }
  driftPushAvatar("").catch(() => { /* avatar stays local-only */ });
  toast("Profile picture removed");
}

$("#profile-avatar").addEventListener("click", () => $("#avatar-input").click());
$("#avatar-change").addEventListener("click", () => $("#avatar-input").click());
$("#avatar-remove").addEventListener("click", clearAvatar);
$("#avatar-input").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (f) handleAvatarFile(f);
});

function showAuth() {
  if (currentUser && currentUser.email) {
    saveAccountGameData(currentUser.email, captureGameData(currentUser.email));
    clearActiveGameData();
    currentUser = null;
  }
  try {
    const n = $("#haze-notif");
    if (n) { clearTimeout(hazeNotifTimer); clearTimeout(hazeHideTimer); n.hidden = true; n.classList.remove("show", "hide"); }
  } catch { /* noop */ }
  desktop.hidden = true;
  settingsWin.hidden = true;
  settingsBtn.classList.remove("running");
  browsyWin.hidden = true;
  browsyBtn.classList.remove("running");
  indexyWin.hidden = true;
  indexyBtn.classList.remove("running");
  gamesWin.hidden = true;
  gamesBtn.classList.remove("running");
  driftWin.hidden = true;
  driftBtn.classList.remove("running");
  stopDriftPolling();
  driftSelectedFriend = null;
  driftContactsCache = [];
  $("#drift-chat").hidden = true;
  $("#drift-messages").replaceChildren();
  $("#drift-message").value = "";
  storeWin.hidden = true;
  storeBtn.classList.remove("running");
  stopPingLoop();
  closeSpotlight();
  stage.hidden = false;
  document.body.classList.remove("in-desktop");
  authView.hidden = false;
  const keep = $("#remember").checked;
  form.reset();
  $("#remember").checked = keep;
  setMode("login", false);
}

/* ---------- Actions ---------- */
async function handleSignup({ email, password, confirm }) {
  const users = loadUsers();

  if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) {
    setMessage("Enter a valid email address.");
    return markInvalid(email);
  }
  if (password.value.length < 8) {
    setMessage("Use at least 8 characters for your password.");
    return markInvalid(password);
  }
  if (password.value !== confirm.value) {
    setMessage("Passwords don't match.");
    return markInvalid(confirm);
  }

  const key = email.value.trim().toLowerCase();
  if (cloudOn()) return cloudSignup(key, password.value);
  if (users[key]) {
    setMessage("An account with this email already exists. Log in instead.");
    return markInvalid(email);
  }

  const salt = newSalt();
  users[key] = {
    name: key.split("@")[0],
    salt,
    hash: await hashPassword(password.value, salt),
    createdAt: Date.now(),
  };
  saveUsers(users);
  stayOn = $("#remember").checked;
  saveSession(key, stayOn);
  showHome({ name: users[key].name, email: key }, { kind: "new", sound: true });
}

async function handleLogin({ email, password }) {
  const key = email.value.trim().toLowerCase();
  const user = loadUsers()[key];

  if (!key || !password.value) {
    setMessage("Enter your email and password.");
    return markInvalid(!key ? email : password);
  }
  if (cloudOn()) return cloudLogin(key, password.value);

  const hash = user ? await hashPassword(password.value, user.salt) : null;
  if (!user || hash !== user.hash) {
    setMessage("Email or password is incorrect.");
    return markInvalid(password);
  }

  stayOn = $("#remember").checked;
  saveSession(key, stayOn);
  showHome({ name: user.name, email: key }, { kind: "back", sound: true });
}

/* ---------- Events ---------- */
modeSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (btn && btn.dataset.mode !== mode) setMode(btn.dataset.mode);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMessage("");
  submitBtn.disabled = true;

  const fields = {
    email: $("#email"),
    password: $("#password"),
    confirm: $("#confirm"),
  };
  try {
    if (mode === "signup") await handleSignup(fields);
    else await handleLogin(fields);
  } catch (err) {
    console.error(err);
    setMessage("Something went wrong. Try again.");
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------- Dock ---------- */
const dockApps = [...dock.querySelectorAll(".app")];

function toast(text) {
  showHazeNotif("Haze", String(text || ""));
}

dock.addEventListener("click", (e) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const btn = e.target.closest(".app");
  if (!btn) return;
  if (btn.id === "power-btn") {
    clearSession();
    showAuth();
    return;
  }
  btn.classList.remove("launch");
  void btn.offsetWidth;
  btn.classList.add("launch");
  if (btn.dataset.app === "Settings") {
    openSettings();
    return;
  }
  if (btn.dataset.app === "Browsy") {
    openBrowsy();
    return;
  }
  if (btn.dataset.app === "Indexy") {
    openIndexy();
    return;
  }
  if (btn.dataset.app === "Games") {
    openGames();
    return;
  }
  if (btn.dataset.app === "Drift") {
    openDrift();
    return;
  }
  if (btn.dataset.app === "Store") {
    openStore();
    return;
  }
  // Unknown dock item: no invented state — only real windows mark running.
});

/* ---------- Dock reordering (drag icons) ---------- */
const ORDER_KEY = "glass.dockOrder";
let dragging = null;
let suppressClick = false;

function saveDockOrder() {
  try {
    localStorage.setItem(
      ORDER_KEY,
      JSON.stringify([...dock.querySelectorAll(".app")].filter((a) => a.id !== "power-btn").map((a) => a.dataset.app))
    );
  } catch {
    /* storage unavailable, order just won't persist */
  }
}

function restoreDockOrder() {
  let order;
  try {
    order = JSON.parse(localStorage.getItem(ORDER_KEY));
  } catch {
    return;
  }
  if (!Array.isArray(order)) return;
  const apps = [...dock.querySelectorAll(".app")];
  const byName = new Map(apps.map((a) => [a.dataset.app, a]));
  const sep = dock.querySelector(".sep");
  const power = byName.get("Log out");
  order.forEach((name) => {
    if (name === "Log out") return;
    const app = byName.get(name);
    if (app) dock.insertBefore(app, sep);
  });
  if (sep && power) dock.insertBefore(sep, power);
  if (power) dock.appendChild(power);
}

function placeLogoutDivider() {
  const sep = dock.querySelector(".sep");
  const power = dock.querySelector("#power-btn");
  if (sep && power) dock.insertBefore(sep, power);
  if (power) dock.appendChild(power);
}

function resetMagnify() {
  dockApps.forEach((app) => (app.querySelector(".ico").style.transform = ""));
}

function endDrag(e) {
  if (!dragging) return;
  const wasDragging = dragging.classList.contains("dragging");
  dragging.classList.remove("dragging");
  dock.classList.remove("reordering");
  dragging.removeAttribute("data-drag-start");
  if (dock.hasPointerCapture(e.pointerId)) dock.releasePointerCapture(e.pointerId);
  dragging = null;
  resetMagnify();
  if (wasDragging) {
    if (prefs.separateLogout !== false) placeLogoutDivider();
    saveDockOrder();
  }
}

/* Dock axis: bottom docks lay out horizontally, side docks vertically */
function dockAxis() {
  return prefs.dockPosition === "left" || prefs.dockPosition === "right" ? "Y" : "X";
}

dock.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".app");
  if (!btn || e.button !== 0) return;
  if (btn.id === "power-btn" && prefs.separateLogout !== false) return;
  // No setPointerCapture here — capturing on pointerdown swallows the
  // click event, so the icon would never open. Capture only once a real
  // drag begins.
  dragging = btn;
  btn.dataset.dragStartX = e.clientX;
  btn.dataset.dragStartY = e.clientY;
  suppressClick = false;
});

dock.addEventListener("pointermove", (e) => {
  if (!dragging) {
    const btn = e.target.closest(".app");
    if (!btn || !motionAllowed() || !prefs.magnify) return;
    const horizontal = dockAxis() === "X";
    for (const app of dockApps) {
      const r = app.getBoundingClientRect();
      const center = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      const d = Math.abs((horizontal ? e.clientX : e.clientY) - center);
      const t = Math.max(0, 1 - d / 140);
      const scale = 1 + 0.16 * t * t;
      const lift = (scale - 1) * 14;
      const shift = horizontal
        ? `translateY(${-lift}px)`
        : prefs.dockPosition === "left" ? `translateX(${lift}px)` : `translateX(${-lift}px)`;
      app.querySelector(".ico").style.transform = `${shift} scale(${scale})`;
    }
    return;
  }

  // Only start a drag once the pointer has actually travelled
  if (!dragging.classList.contains("dragging")) {
    const ax = dockAxis();
    const cur = ax === "X" ? e.clientX : e.clientY;
    if (Math.abs(cur - Number(dragging.dataset["dragStart" + ax])) < 6) return;
    dragging.classList.add("dragging");
    dock.classList.add("reordering");
    suppressClick = true;
    dock.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  // Shift the dragged icon to whichever slot the pointer is over
  const moveAx = dockAxis();
  const pointer = moveAx === "X" ? e.clientX : e.clientY;
  for (const other of dockApps) {
    if (other === dragging) continue;
    const r = other.getBoundingClientRect();
    const mid = moveAx === "X" ? r.left + r.width / 2 : r.top + r.height / 2;
    if (pointer < mid) {
      dock.insertBefore(dragging, other);
      break;
    }
  }
  dragging.querySelector(".ico").style.transform = "scale(1.18)";
});

dock.addEventListener("pointerup", endDrag);
dock.addEventListener("pointercancel", endDrag);
dock.addEventListener("mouseleave", () => {
  if (!dragging) resetMagnify();
});
// The icons are <img>s, so the browser's native image drag would
// otherwise take over mid-gesture
dock.addEventListener("dragstart", (e) => e.preventDefault());

/* ---------- Preferences ---------- */
const PREFS_KEY = "glass.prefs";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

let prefs = Object.assign(
  { magnify: true, indicators: true, animations: true, settingsAccent: "purple", sessionNotifications: true, clock24: false, showDeskTime: true, showDeskDate: true, showCalendar: false, deskDateFormat: "long", dim: 18, uiScale: 95, titlebarSize: 44, wall: "default", dockSize: 42, dockPosition: "bottom", separateLogout: true, widgetPos: null, iconPack: "dark", proxy: { mode: "local", wisp: "wss://wisp.mercurywork.shop/", searchEngine: "duckduckgo", userAgent: "default" } },
  loadPrefs()
);
if (prefs.visualDefaultsVersion !== 1) {
  if (Number(prefs.dockSize) === 40) prefs.dockSize = 42;
  if (Number(prefs.uiScale) === 100) prefs.uiScale = 95;
  if (Number(prefs.titlebarSize) === 56) prefs.titlebarSize = 44;
  prefs.visualDefaultsVersion = 1;
  savePrefs();
}
if (prefs.separateLogoutDefaultVersion !== 1) {
  prefs.separateLogout = true;
  prefs.separateLogoutDefaultVersion = 1;
  savePrefs();
}
if (!prefs.proxy || typeof prefs.proxy !== "object") prefs.proxy = { mode: "local", wisp: "wss://wisp.mercurywork.shop/", searchEngine: "duckduckgo", userAgent: "default" };
if (prefs.proxy.mode !== "epoxy" && prefs.proxy.mode !== "local") prefs.proxy.mode = "local";
if (!/^wss?:\/\//.test(String(prefs.proxy.wisp || "").trim())) prefs.proxy.wisp = "wss://wisp.mercurywork.shop/";

// Move existing saved widget positions up once to match the tighter layout.
const widgetTopVersion = Number(prefs.widgetPosTopVersion) || 0;
if (widgetTopVersion < 2) {
  const moveUpBy = widgetTopVersion < 1 ? 26 : 10;
  prefs.widgetPosTopVersion = 2;
  if (prefs.widgetPos && typeof prefs.widgetPos === "object") {
    for (const id of ["clock", "cal"]) {
      const item = prefs.widgetPos[id];
      if (item && Number.isFinite(item.top)) item.top = Math.max(20, item.top - moveUpBy);
    }
    savePrefs();
  }
}

if (!["duckduckgo", "google", "brave"].includes(prefs.proxy.searchEngine)) prefs.proxy.searchEngine = "duckduckgo";
if (!["default", "iphone", "ipad", "android", "ps5"].includes(prefs.proxy.userAgent)) prefs.proxy.userAgent = "default";

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function applyPrefs() {
  document.documentElement.style.setProperty("--dim", String(prefs.dim / 100));
  document.body.classList.toggle("no-dots", !prefs.indicators);
  userAnimationsEnabled = prefs.animations !== false;
  document.body.classList.toggle("animations-off", prefs.animations === false);
  settingsWin.classList.toggle("accent-white", prefs.settingsAccent === "white");
  document.querySelectorAll("#settings-accent [data-accent]").forEach((button) => {
    button.classList.toggle("active", button.dataset.accent === (prefs.settingsAccent === "white" ? "white" : "purple"));
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
  });
  if (!prefs.magnify) {
    dockApps.forEach((app) => (app.querySelector(".ico").style.transform = ""));
  }
  const slider = $("#dim-slider");
  if (slider) slider.value = prefs.dim;
  const dv = $("#dim-val");
  if (dv) dv.textContent = prefs.dim;
  const scale = Math.min(130, Math.max(80, Number(prefs.uiScale) || 95)) / 100;
  document.documentElement.style.setProperty("--ui-scale", scale);
  const us = $("#ui-scale");
  if (us) us.value = Math.round(scale * 100);
  const sv = $("#scale-val");
  if (sv) sv.textContent = Math.round(scale * 100) + "%";

  const tb = Math.min(80, Math.max(40, Number(prefs.titlebarSize) || 44));
  document.documentElement.style.setProperty("--titlebar-size", tb + "px");
  document.documentElement.style.setProperty("--tb-scale", tb / 56);
  const tbInput = $("#titlebar-size");
  if (tbInput) tbInput.value = tb;
  const tbVal = $("#titlebar-val");
  if (tbVal) tbVal.textContent = tb + "px";

  const ds = Math.min(64, Math.max(32, Number(prefs.dockSize) || 42));
  document.documentElement.style.setProperty("--dock-icon", ds + "px");
  const dsInput = $("#dock-size");
  if (dsInput) dsInput.value = ds;
  const dsVal = $("#dock-size-val");
  if (dsVal) dsVal.textContent = ds + "px";
  const pos = ["bottom", "left", "right"].includes(prefs.dockPosition) ? prefs.dockPosition : "bottom";
  dock.classList.toggle("pos-left", pos === "left");
  dock.classList.toggle("pos-right", pos === "right");
  dock.classList.toggle("separate-logout", prefs.separateLogout !== false);
  if (prefs.separateLogout !== false) placeLogoutDivider();
  document.querySelectorAll("#dock-pos button").forEach((b) => b.classList.toggle("active", b.dataset.pos === pos));

  // The caret position is measured against a hidden span that mirrors the
  // input's font, so it has to be re-synced when the scale changes.
  if (typeof settingsCaret !== "undefined") {
    settingsCaret.sync();
    settingsCaret.place(false);
  }
  if (typeof gamesCaret !== "undefined") {
    gamesCaret.sync();
    gamesCaret.place(false);
  }

  tickClock();
  const dateFormat = $("#desk-date-format");
  if (dateFormat) dateFormat.value = prefs.deskDateFormat === "short" ? "short" : "long";
  const deskTime = $("#desk-time");
  const deskDate = $("#desk-date");
  if (deskTime) deskTime.hidden = !prefs.showDeskTime;
  if (deskDate) deskDate.hidden = !prefs.showDeskDate;
  if (typeof renderDeskCal === "function") renderDeskCal();
  applyIconPack(ICON_PACKS[prefs.iconPack] ? prefs.iconPack : "dark");
}

/* ---------- Dock icon packs (Classic built-in + Store packs) ---------- */
const ICON_PACKS = {
  classic: {
    name: "Classic",
    desc: "The original built-in app icons.",
    store: true,
    icons: {},
  },
  dark: {
    name: "Dark",
    desc: "Dark icon pack for every dock app. Switch back to Classic anytime.",
    store: true,
    icons: {
      Store: "images/App%20Icons/Dark%20Pack/appstore.png",
      Games: "images/App%20Icons/Dark%20Pack/gameapp.png",
      Drift: "images/App%20Icons/Drift%20Dark.svg",
      Indexy: "images/App%20Icons/Dark%20Pack/indexyapp.png",
      Settings: "images/App%20Icons/Dark%20Pack/settingsapp.png",
      "Log out": "images/App%20Icons/Dark%20Pack/logout.png",
      Browsy: "images/App%20Icons/Dark%20Pack/browser.png",
    },
  },
  light: {
    name: "Light",
    desc: "Light icons for a bright, simple dock.",
    store: true,
    light: true,
    icons: {
      Store: "images/App%20Icons/Dark%20Pack/appstore.png",
      Games: "images/App%20Icons/Dark%20Pack/gameapp.png",
      Drift: "images/App%20Icons/Drift%20Light.svg",
      Indexy: "images/App%20Icons/Dark%20Pack/indexyapp.png",
      Settings: "images/App%20Icons/Dark%20Pack/settingsapp.png",
      "Log out": "images/App%20Icons/Dark%20Pack/logout.png",
      Browsy: "images/App%20Icons/Dark%20Pack/browser.png",
    },
  },
};

/* Snapshot the built-in markup once so Classic can always be restored. */
function snapshotClassicIcons() {
  document.querySelectorAll("#dock .app .ico").forEach((ico) => {
    if (ico.dataset.classic === undefined) ico.dataset.classic = ico.innerHTML;
  });
}

function applyIconPack(id) {
  const pack = ICON_PACKS[id] || ICON_PACKS.classic;
  dock.classList.toggle("light-icon-pack", !!pack.light);
  dock.classList.toggle("dark-icon-pack", id === "dark");
  document.querySelectorAll("#dock .app").forEach((btn) => {
    const ico = btn.querySelector(".ico");
    if (!ico) return;
    const src = pack.icons && pack.icons[btn.dataset.app];
    if (src) {
      ico.innerHTML = "";
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      img.classList.toggle("pack-light-image", !!pack.light);
      img.addEventListener("error", () => img.remove(), { once: true });
      ico.appendChild(img);
    } else if (ico.dataset.classic !== undefined) {
      ico.innerHTML = ico.dataset.classic;
    }
  });
}

function setIconPack(id) {
  if (!ICON_PACKS[id]) return;
  prefs.iconPack = id;
  savePrefs();
  applyIconPack(id);
  refreshPackUI();
}

function packCard(id) {
  const pack = ICON_PACKS[id];
  const card = document.createElement("div");
  card.className = "pack-card";
  card.dataset.pack = id;
  const prev = document.createElement("div");
  prev.className = "pack-previews";
  prev.setAttribute("aria-hidden", "true");
  ["Store", "Games", "Indexy", "Settings"].forEach((app) => {
    const m = document.createElement("span");
    m.className = "pack-mini";
    const src = pack.icons && pack.icons[app];
    if (src) {
      const im = document.createElement("img");
      im.src = src;
      im.alt = "";
      im.loading = "lazy";
      im.classList.toggle("pack-light-image", !!pack.light);
      m.appendChild(im);
    } else {
      const ico = dock.querySelector('.app[data-app="' + app + '"] .ico');
      if (ico && ico.dataset.classic !== undefined) m.innerHTML = ico.dataset.classic;
    }
    prev.appendChild(m);
  });
  const info = document.createElement("div");
  info.className = "pack-info";
  const t = document.createElement("strong");
  t.textContent = pack.name;
  const d = document.createElement("span");
  d.textContent = pack.desc;
  info.append(t, d);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "player-btn pack-cta";
  card.append(prev, info, b);
  const activate = (e) => { if (e) e.stopPropagation(); setIconPack(id); };
  b.addEventListener("click", activate);
  card.addEventListener("click", () => setIconPack(id));
  return card;
}

function renderPackRows() {
  const s = $("#pack-row");
  if (s) {
    s.innerHTML = "";
    Object.keys(ICON_PACKS).forEach((id) => s.appendChild(packCard(id)));
  }
  const t = $("#st-pack-row");
  if (t) {
    t.innerHTML = "";
    Object.keys(ICON_PACKS).filter((id) => ICON_PACKS[id].store).forEach((id) => t.appendChild(packCard(id)));
  }
  refreshPackUI();
}

function refreshPackUI() {
  const cur = ICON_PACKS[prefs.iconPack] ? prefs.iconPack : "dark";
  document.querySelectorAll(".pack-card").forEach((c) => {
    const on = c.dataset.pack === cur;
    c.classList.toggle("active", on);
    const b = c.querySelector(".pack-cta");
    if (!b) return;
    b.textContent = on ? "Enabled" : "Enable";
    b.disabled = on;
  });
}

snapshotClassicIcons();
renderPackRows();

/* ---------- Wallpaper library ---------- */
const WALLS_KEY = "glass.wallpapers";
const BUILTIN_WALLS = [
  { id: "default", name: "Original", video: "wallpaper.mp4" },
  { id: "aurora", name: "Aurora", css: "linear-gradient(135deg,#16233f 0%,#33538a 48%,#7f9cc9 100%)" },
  { id: "sunset", name: "Sunset", css: "linear-gradient(135deg,#33183a 0%,#8a3a5c 46%,#e0785c 100%)" },
  { id: "deep", name: "Deep Sea", css: "linear-gradient(135deg,#041d2c 0%,#0a4a64 50%,#12889c 100%)" },
  { id: "meadow", name: "Meadow", css: "linear-gradient(135deg,#0f2f1c 0%,#2f6b3c 50%,#7cb46a 100%)" },
  { id: "graphite", name: "Graphite", css: "linear-gradient(135deg,#111113 0%,#2b2b30 50%,#4c4c55 100%)" },
];
const WALL_MAX_EDGE = 2560;

function loadWalls() {
  try {
    const list = JSON.parse(localStorage.getItem(WALLS_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveWalls() {
  try {
    localStorage.setItem(WALLS_KEY, JSON.stringify(walls));
    return true;
  } catch {
    return false;
  }
}

let walls = loadWalls();

function wallCss(wall) {
  if (!wall) return null;
  if (typeof wall === "object") {
    if (wall.image) return wall.image;
    if (wall.data) return 'url("' + wall.data + '")';
    if (wall.id) wall = wall.id;
    else return null;
  }
  const found = BUILTIN_WALLS.find((w) => w.id === wall) || walls.find((w) => w.id === wall);
  if (!found) return null;
  if (found.data) return 'url("' + found.data + '")';
  return found.image || found.css || null;
}

function wallVideo(wall) {
  if (!wall) return null;
  if (typeof wall === "object") {
    if (wall.video) return wall.video;
    if (wall.videoData) return wall.videoData;
    if (wall.id) wall = wall.id;
    else return null;
  }
  const found = BUILTIN_WALLS.find((w) => w.id === wall) || walls.find((w) => w.id === wall);
  return found ? found.video || found.videoData || null : null;
}

function applyWallpaper() {
  const videoEl = $("#wallpaper-video");
  const videoSrc = wallVideo(prefs.wall);

  if (videoSrc) {
    // Video wallpaper: play it on a loop, hide the CSS background behind it.
    if (videoEl.getAttribute("src") !== videoSrc) videoEl.src = videoSrc;
    videoEl.onerror = () => {
      // Video missing/unreadable — fall back to a dark gradient.
      videoEl.classList.remove("playing");
      document.documentElement.style.setProperty("--wall-image", "linear-gradient(135deg,#111113 0%,#2b2b30 50%,#4c4c55 100%)");
    };
    videoEl.classList.add("playing");
    if (reduceMotion.matches) videoEl.pause(); // paused first frame = a still
    else {
      const p = videoEl.play();
      if (p && p.catch) p.catch(() => videoEl.classList.remove("playing"));
    }
    document.documentElement.style.setProperty("--wall-image", "none");
    return;
  }

  // Image/gradient wallpaper: stop the video and restore the CSS background.
  videoEl.pause();
  videoEl.onerror = null;
  videoEl.classList.remove("playing");
  videoEl.removeAttribute("src");
  videoEl.load();
  const css = wallCss(prefs.wall);
  if (!css) {
    // Unknown selection (e.g. a removed wallpaper) — reset to the video loop.
    prefs.wall = "default";
    savePrefs();
    applyWallpaper();
    renderWalls();
    return;
  }
  document.documentElement.style.setProperty("--wall-image", css);
}

function renderWalls() {
  const swatches = $("#wall-swatches");
  swatches.innerHTML = "";
  BUILTIN_WALLS.forEach((w) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wall-swatch" + (prefs.wall === w.id ? " active" : "");
    btn.style.backgroundImage = w.image || w.css || "";
    btn.title = w.name;
    if (w.video) {
      btn.classList.add("is-video");
      const v = document.createElement("video");
      v.src = w.video;
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      btn.appendChild(v);
    }
    const label = document.createElement("span");
    label.textContent = w.name;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      prefs.wall = w.id;
      savePrefs();
      applyWallpaper();
      renderWalls();
    });
    swatches.appendChild(btn);
  });

  const thumbs = $("#wall-thumbs");
  thumbs.innerHTML = "";
  walls.forEach((wall) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wall-thumb strip-item" + (prefs.wall === wall.id ? " active" : "");
    const vidSrc = wall.video || wall.videoData;
    if (vidSrc) {
      btn.classList.add("is-video");
      const v = document.createElement("video");
      v.src = vidSrc;
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      btn.appendChild(v);
    } else {
      btn.style.backgroundImage = 'url("' + wall.data + '")';
    }
    btn.title = wall.name;
    const del = document.createElement("span");
    del.className = "wall-del";
    del.setAttribute("role", "button");
    del.setAttribute("aria-label", "Remove " + wall.name);
    del.textContent = "×";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeWall(wall.id);
    });
    btn.appendChild(del);
    btn.addEventListener("click", () => {
      prefs.wall = wall.id;
      savePrefs();
      applyWallpaper();
      renderWalls();
    });
    swatches.appendChild(btn);
  });

  // Keep the selected thumbnail's full white outline inside the strip after
  // a selection or wallpaper list refresh.
  const activeSwatch = swatches.querySelector(".wall-swatch.active");
  if (activeSwatch) {
    const strip = swatches.getBoundingClientRect();
    const item = activeSwatch.getBoundingClientRect();
    const inset = 8;
    if (item.left < strip.left + inset) swatches.scrollLeft -= strip.left + inset - item.left;
    else if (item.right > strip.right - inset) swatches.scrollLeft += item.right - (strip.right - inset);
  }
}

function removeWall(id) {
  walls = walls.filter((w) => w.id !== id);
  if (!saveWalls()) toast("Could not update saved wallpapers");
  if (prefs.wall === id) {
    prefs.wall = "default";
    savePrefs();
    applyWallpaper();
  }
  renderWalls();
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, WALL_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/webp", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

async function addWallpapers(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  if (!files.length) {
    toast("No images found in that drop");
    return;
  }
  let added = 0;
  for (const file of files) {
    try {
      const data = await shrinkImage(file);
      const id = "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      walls.push({ id, name: file.name.replace(/\.[^.]+$/, ""), data });
      added++;
    } catch {
      /* unreadable image — skip it */
    }
  }
  if (!added) {
    toast("Those images could not be read");
    return;
  }
  if (!saveWalls()) {
    walls = walls.slice(0, Math.max(0, walls.length - added));
    toast("Not enough storage for more wallpapers");
    renderWalls();
    return;
  }
  prefs.wall = walls[walls.length - 1].id;
  savePrefs();
  applyWallpaper();
  renderWalls();
  toast(added + (added === 1 ? " wallpaper added" : " wallpapers added"));
}

const wallDrop = $("#wall-drop");
const wallInput = $("#wall-input");
wallDrop.addEventListener("click", () => wallInput.click());
wallDrop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    wallInput.click();
  }
});
wallInput.addEventListener("change", () => {
  if (wallInput.files.length) addWallpapers(wallInput.files);
  wallInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  wallDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    wallDrop.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((evt) =>
  wallDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    wallDrop.classList.remove("drag");
  })
);
wallDrop.addEventListener("drop", (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) addWallpapers(e.dataTransfer.files);
});

/* ---------- Settings window ---------- */
const titlebar = $("#settings-titlebar");

function syncSwitches() {
  document.querySelectorAll(".switch").forEach((sw) => {
    const on = sw.dataset.setting === "stay" ? stayOn : !!prefs[sw.dataset.setting];
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", String(on));
  });
  $("#stay-sub").textContent = stayOn ? "Auto sign-in is on" : "Auto sign-in is off";
}

function openSettings() {
  // Already open -> clicking the dock icon minimizes it, like macOS
  if (!settingsWin.hidden) {
    closeSettings(false);
    return;
  }
  settingsWin.hidden = false;
  settingsWin.classList.remove("open");
  void settingsWin.offsetWidth;
  settingsWin.classList.add("open");
  settingsBtn.classList.add("running");
  focusWindow(settingsWin);
  if ($('.side-item[data-pane="info"].active')) startPingLoop();
  if (currentUser) {
    const display = currentUser.name || currentUser.email;
    $("#profile-name").textContent = display;
    $("#profile-email").textContent = currentUser.email;
    $("#account-name").textContent = display;
    $("#account-email").textContent = currentUser.email;
    applyAvatar();
  }
  syncCloakUI(true);
  syncProxyUI();
  syncSwitches();
  syncLinksUI();
}

function syncLinksUI() {
  renderLinks();
}

function closeSettings(quit = true) {
  settingsWin.hidden = true;
  stopPingLoop();
  if (quit) settingsBtn.classList.remove("running");
}

$("#set-close").addEventListener("click", () => closeSettings(true));
$("#set-min").addEventListener("click", () => {
  settingsWin.hidden = true;
  stopPingLoop();
});
$("#set-max").addEventListener("click", () => settingsWin.classList.toggle("max"));

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (typeof isPanicKeyEvent === "function" && isPanicKeyEvent(e)) return;
  if (!$("#game-data-modal").hidden) { closeSavedGameData(); return; }
  if (!ctxmenu.hidden) { hideCtx(); return; }
  if (!spot.hidden) closeSpotlight();
  else if (!settingsWin.hidden) closeSettings(true);
  else if (!browsyWin.hidden) closeBrowsy(true);
  else if (!indexyWin.hidden) closeIndexy(true);
  else if (!gamesWin.hidden) closeGames(true);
  else if (!driftWin.hidden) closeDrift(true);
  else if (!storeWin.hidden) closeStore(true);
});

const settingsSideItems = [...document.querySelectorAll(".side-item")];
const settingsPanePages = [...document.querySelectorAll(".pane-page")];
const reducedSettingsMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
settingsPanePages.forEach((page) => {
  const releaseLayerHint = (e) => {
    if (e.animationName === "settings-pane-in") page.style.willChange = "auto";
  };
  page.addEventListener("animationend", releaseLayerHint);
  page.addEventListener("animationcancel", releaseLayerHint);
});

function activateSettingsPane(btn) {
  if (!btn) return;
  const previousIndex = settingsSideItems.findIndex((b) => b.classList.contains("active"));
  const nextIndex = settingsSideItems.indexOf(btn);
  const paneChanged = nextIndex !== previousIndex;
  if (paneChanged) {
    settingsWin.style.setProperty("--settings-pane-offset", nextIndex >= previousIndex ? "22px" : "-22px");
    settingsSideItems.forEach((b) => b.classList.toggle("active", b === btn));
    settingsPanePages.forEach((page) => {
      const entering = page.dataset.pane === btn.dataset.pane;
      page.style.willChange = entering && motionAllowed()
        ? "transform, opacity, filter"
        : "auto";
      page.classList.toggle("active", entering);
    });
  }
  if (btn.dataset.pane === "info") startPingLoop();
  else stopPingLoop();
}

settingsSideItems.forEach((btn) => btn.addEventListener("click", () => activateSettingsPane(btn)));

document.querySelectorAll(".switch").forEach((sw) =>
  sw.addEventListener("click", () => {
    const key = sw.dataset.setting;
    if (key === "stay") {
      stayOn = !stayOn;
      if (currentUser) saveSession(currentUser.email, stayOn);
    } else {
      prefs[key] = !prefs[key];
      savePrefs();
      applyPrefs();
    }
    syncSwitches();
  })
);

$("#dim-slider").addEventListener("change", (e) => {
  prefs.dim = Number(e.target.value);
  savePrefs();
  applyPrefs();
});

$("#ui-scale").addEventListener("change", (e) => {
  prefs.uiScale = Number(e.target.value);
  savePrefs();
  applyPrefs();
});

$("#titlebar-size").addEventListener("change", (e) => {
  prefs.titlebarSize = Number(e.target.value);
  savePrefs();
  applyPrefs();
});

$("#dock-size").addEventListener("change", (e) => {
  prefs.dockSize = Number(e.target.value);
  savePrefs();
  applyPrefs();
});

$("#desk-date-format").addEventListener("change", (e) => {
  prefs.deskDateFormat = e.target.value === "short" ? "short" : "long";
  savePrefs();
  tickClock();
});

document.querySelectorAll("#dock-pos button").forEach((b) =>
  b.addEventListener("click", () => {
    prefs.dockPosition = b.dataset.pos;
    savePrefs();
    applyPrefs();
  })
);

const settingsSearch = $("#settings-search");
const settingsSearchClear = $("#settings-search-clear");
function filterSettingsSearch(value) {
  const q = value.trim().toLowerCase();
  settingsWin.classList.toggle("searching", q.length > 0);
  settingsSearchClear.hidden = q.length === 0;
  settingsPanePages.forEach((page) => {
    let n = 0;
    page.querySelectorAll(".row").forEach((row) => {
      const hit = !q || row.textContent.toLowerCase().includes(q);
      row.classList.toggle("hidden", !hit);
      if (hit) n++;
    });
    page.classList.toggle("no-match", q.length > 0 && n === 0);
  });
}
settingsSearch.addEventListener("input", () => filterSettingsSearch(settingsSearch.value));
settingsSearchClear.addEventListener("click", () => {
  settingsSearch.value = "";
  filterSettingsSearch("");
  settingsSearch.focus();
});
settingsWin.addEventListener("click", (e) => {
  if (!settingsWin.classList.contains("searching")) return;
  const row = e.target.closest(".pane-page .row:not(.hidden)");
  if (!row) return;
  const pane = row.closest(".pane-page");
  const sideItem = settingsSideItems.find((item) => item.dataset.pane === pane?.dataset.pane);
  if (!sideItem) return;
  settingsSearch.value = "";
  filterSettingsSearch("");
  activateSettingsPane(sideItem);
});

document.querySelectorAll("#settings-accent [data-accent]").forEach((button) => {
  button.addEventListener("click", () => {
    prefs.settingsAccent = button.dataset.accent === "white" ? "white" : "purple";
    savePrefs();
    applyPrefs();
  });
});

/* ---------- Settings Links: service integrations ----------
   Registry model: each integration defines id/name/desc/icon/status/connect/
   disconnect. Add new services via registerIntegration() — no Settings
   rebuild needed. */
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const INTEGRATIONS = {};

function registerIntegration(def) {
  if (!def || !def.id) return;
  INTEGRATIONS[def.id] = def;
}

function renderLinks() {
  const group = $("#links-group");
  if (!group) return;
  const ids = Object.keys(INTEGRATIONS);
  if (!ids.length) {
    group.innerHTML = '<div class="row"><div><div class="row-title">No integrations yet</div></div></div>';
    return;
  }
  group.innerHTML = ids.map((id) => {
    const def = INTEGRATIONS[id];
    let st = { state: "off", label: "Not connected", action: "Connect" };
    try { st = Object.assign(st, def.status() || {}); } catch { /* show default */ }
    const dotCls = st.state === "on" ? "on" : (st.state === "expired" || st.state === "error" ? "warn" : "");
    const btnLabel = escH(st.action || (st.state === "on" ? "Disconnect" : "Connect"));
    const btnAct = st.state === "on" ? "disconnect" : "connect";
    return (
      '<div class="row">' +
        '<div class="link-row-main">' +
          '<span class="link-ico" aria-hidden="true">' + (def.icon || "🔗") + "</span>" +
          "<div><div class=\"row-title\">" + escH(def.name) + "</div>" +
          "<div class=\"row-sub\">" + escH(st.label || "") + "</div></div>" +
        "</div>" +
        '<span class="row-actions">' +
          '<span class="link-status ' + dotCls + '">' + escH(st.state === "on" ? "Connected" : (st.state === "expired" ? "Expired" : (st.state === "error" ? "Error" : "Not connected"))) + "</span>" +
          '<button type="button" class="player-btn" data-link="' + escH(id) + '" data-act="' + btnAct + '"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Working…" : btnLabel) + "</button>" +
        "</span>" +
      "</div>"
    );
  }).join("");
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-link][data-act]");
  if (!btn || btn.disabled) return;
  const def = INTEGRATIONS[btn.dataset.link];
  if (!def) return;
  try {
    if (btn.dataset.act === "connect" && typeof def.connect === "function") def.connect();
    else if (btn.dataset.act === "disconnect" && typeof def.disconnect === "function") def.disconnect();
  } catch { toast("Something went wrong — try again"); }
});

function openSettingsToLinks() {
  openSettings();
  const tab = document.querySelector('.side-item[data-pane="links"]');
  if (tab) tab.click();
}

/* ---------- Google Calendar integration (OAuth 2.0 via GIS) ----------
   The built-in public OAuth client ID is used automatically. */
const GCAL_KEY = "glass.gcal";
const GCAL_DEFAULT_CLIENT_ID = "767881698813-ehupp76fsa3qvte2s832fcstu63udhar.apps.googleusercontent.com";
const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email";
const GCAL_GIS_SRC = "https://accounts.google.com/gsi/client";

const GCAL_G_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2 3.8-5.1 3.8-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-.1.1-3.7 2.9v.1C3.5 21.4 7.5 24 12 24z"/><path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.1-.1-3.6-2.8-.1.1C.5 8.7 0 10.2 0 12s.5 3.3 1.4 4.7l3.8-2.3z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.6 1.4 6.7l3.8 2.9c1-2.9 3.7-4.9 6.8-4.9z"/></svg>';

function gcalStore() {
  try { return JSON.parse(localStorage.getItem(GCAL_KEY)) || {}; }
  catch { return {}; }
}

function gcalSave(patch) {
  try {
    const cur = gcalStore();
    localStorage.setItem(GCAL_KEY, JSON.stringify(Object.assign(cur, patch)));
  } catch { /* storage unavailable — connection lasts for this session only */ }
}

function gcalClearToken() {
  try {
    const cur = gcalStore();
    delete cur.token;
    delete cur.tokenExp;
    delete cur.email;
    localStorage.setItem(GCAL_KEY, JSON.stringify(cur));
  } catch { /* noop */ }
  gcalCache = null;
}

function gcalClientId() {
  return GCAL_DEFAULT_CLIENT_ID;
}

let gcalBusy = false;
let gcalError = "";
let gcalCache = null; // { at, events: [] }
let gcalScope = "today";

function gcalTokenValid() {
  const s = gcalStore();
  return !!(s.token && s.tokenExp && Date.now() < s.tokenExp);
}

function gcalConnected() {
  const s = gcalStore();
  return !!s.token;
}

let gisPromise = null;

function gisLoad() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = GCAL_GIS_SRC;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      gisPromise = null;
      reject(new Error("Could not load Google sign-in (check your connection)."));
    };
    document.head.appendChild(tag);
  });
  return gisPromise;
}

function gcalRequestToken(clientId, prompt) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("Google sign-in timed out.")); }
    }, 120000);
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GCAL_SCOPES,
        prompt: prompt || "",
        callback: (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (resp && resp.access_token) resolve(resp);
          else reject(new Error(gisErrText(resp)));
        },
      });
      client.requestAccessToken();
    } catch (err) {
      if (!settled) { settled = true; clearTimeout(timer); reject(err instanceof Error ? err : new Error("Google sign-in failed to start.")); }
    }
  });
}

function gisErrText(resp) {
  const code = resp && (resp.error || resp.error_code);
  if (code === "popup_closed_by_user") return "Sign-in was closed before finishing.";
  if (code === "access_denied") return "Permission was denied. Calendar access is required.";
  if (code === "popup_blocked_by_browser") return "The sign-in popup was blocked — allow popups and try again.";
  if (code === "immediate_failed" || code === "user_logged_out") return "Session expired — please reconnect.";
  return "Google sign-in failed" + (code ? " (" + code + ")." : ".");
}

async function gcalAcceptToken(tok) {
  const exp = Date.now() + (Math.max(0, (tok.expires_in || 3600)) * 1000) - 60000;
  gcalSave({ token: tok.access_token, tokenExp: exp });
  // Best-effort account email for the status line (needs userinfo.email scope).
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + tok.access_token },
    });
    if (r.ok) {
      const info = await r.json();
      if (info && info.email) gcalSave({ email: info.email });
    }
  } catch { /* email is cosmetic */ }
}

async function gcalConnect(silent) {
  if (gcalBusy) return false;
  const clientId = gcalClientId();
  gcalBusy = true;
  gcalError = "";
  renderLinks();
  try {
    await gisLoad();
    const tok = await gcalRequestToken(clientId, silent ? "none" : "");
    await gcalAcceptToken(tok);
    gcalBusy = false;
    renderLinks();
    await gcalRefresh();
    return true;
  } catch (err) {
    gcalBusy = false;
    gcalError = err && err.message ? err.message : "Could not connect to Google Calendar.";
    // Silent attempts must never surface popups or errors.
    if (!silent) {
      renderLinks();
      renderDeskCal();
      toast(gcalError);
    }
    return false;
  }
}

async function gcalDisconnect() {
  const s = gcalStore();
  if (s.token) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(s.token), { method: "POST" });
    } catch { /* revocation is best-effort; local data is cleared regardless */ }
  }
  gcalClearToken();
  gcalError = "";
  renderLinks();
  renderDeskCal();
  toast("Google Calendar disconnected");
}

async function gcalApi(path) {
  const s = gcalStore();
  if (!s.token) return { unauthorized: true };
  let r;
  try {
    r = await fetch("https://www.googleapis.com/calendar/v3/" + path, {
      headers: { Authorization: "Bearer " + s.token },
    });
  } catch {
    return { networkError: true };
  }
  if (r.status === 401 || r.status === 403) return { unauthorized: true };
  if (!r.ok) return { httpError: r.status };
  try { return { data: await r.json() }; }
  catch { return { httpError: "bad-response" }; }
}

function gcalDayBounds(days) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + days * 86400000);
  return { timeMin: now.toISOString(), timeMax: end.toISOString() };
}

async function gcalRefresh() {
  if (!gcalConnected()) {
    renderDeskCal();
    return;
  }
  if (!gcalTokenValid()) {
    // Try one silent re-auth before showing the expired state.
    const ok = await gcalConnect(true);
    if (!ok && !gcalTokenValid()) {
      renderLinks();
      renderDeskCal();
      return;
    }
  }
  renderDeskCal("loading");
  const { timeMin, timeMax } = gcalDayBounds(14);
  const q = "calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=25" +
    "&timeMin=" + encodeURIComponent(timeMin) + "&timeMax=" + encodeURIComponent(timeMax) +
    "&fields=items(id,summary,location,start,end,htmlLink)";
  const res = await gcalApi(q);
  if (res.unauthorized) {
    renderLinks();
    renderDeskCal();
    return;
  }
  if (res.networkError || res.httpError || !res.data) {
    gcalError = "Could not load events — check your connection.";
    renderDeskCal("error");
    return;
  }
  gcalError = "";
  gcalCache = { at: Date.now(), events: Array.isArray(res.data.items) ? res.data.items : [] };
  renderDeskCal();
}

function gcalIsAllDay(ev) {
  return !!(ev && ev.start && ev.start.date && !ev.start.dateTime);
}

function gcalLocalParts(ev) {
  // Returns { day: Date(local midnight), timeText, dateText, allDay }
  if (gcalIsAllDay(ev)) {
    const p = String(ev.start.date).split("-");
    const day = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    const endP = ev.end && ev.end.date ? String(ev.end.date).split("-") : null;
    let dateText = day.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    if (endP) {
      const endDay = new Date(Number(endP[0]), Number(endP[1]) - 1, Number(endP[2]) - 1);
      if (endDay > day) dateText += " – " + endDay.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    }
    return { day, timeText: "", dateText, allDay: true };
  }
  const start = new Date(ev.start.dateTime);
  const end = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : null;
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const t = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const timeText = end ? t(start) + " – " + t(end) : t(start);
  const dateText = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return { day, timeText, dateText, allDay: false };
}

function gcalTodayKey(d) {
  return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
}

function renderDeskCal(force) {
  const box = $("#desk-cal");
  if (!box) return;
  const show = !desktop.hidden && !!prefs.showCalendar;
  if (!show) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  if (!gcalConnected()) {
    let dismissed = false;
    try { dismissed = !!gcalStore().promptDismissed; } catch { /* noop */ }
    if (dismissed) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<div class="cal-state">See upcoming events here.<br>Connect Google Calendar to get started.<br>' +
      '<button type="button" class="player-btn" data-cal="connect">Connect</button></div>' +
      '<button type="button" class="cal-dismiss" data-cal="dismiss">Not now</button>';
    return;
  }
  box.hidden = false;
  if (force === "loading" || gcalBusy) {
    box.innerHTML = '<div class="cal-state">Loading events…</div>';
    return;
  }
  if (force === "error" || (gcalError && !gcalCache)) {
    box.innerHTML = '<div class="cal-state">' + escH(gcalError || "Could not load events.") +
      '<br><button type="button" class="player-btn" data-cal="retry">Retry</button></div>';
    return;
  }
  if (!gcalTokenValid()) {
    box.innerHTML = '<div class="cal-state">Calendar session expired.<br>Reconnect to keep events up to date.<br>' +
      '<button type="button" class="player-btn" data-cal="reconnect">Reconnect</button></div>';
    renderLinks();
    return;
  }
  const events = (gcalCache && gcalCache.events) || [];
  const todayK = gcalTodayKey(new Date());
  const todays = events.filter((ev) => { try { return gcalTodayKey(gcalLocalParts(ev).day) === todayK; } catch { return false; } });
  const list = gcalScope === "today" ? todays : events;
  let html = '<div class="cal-head"><span class="cal-title">Calendar</span>' +
    '<span class="cal-seg" role="group" aria-label="Event range">' +
    '<button type="button" data-cal="today"' + (gcalScope === "today" ? ' class="active"' : "") + ">Today</button>" +
    '<button type="button" data-cal="upcoming"' + (gcalScope === "upcoming" ? ' class="active"' : "") + ">Upcoming</button>" +
    "</span></div>";
  if (!list.length) {
    html += '<div class="cal-state">' + (gcalScope === "today" ? "Nothing on today — enjoy the quiet." : "No upcoming events.") + "</div>";
  } else {
    html += '<div class="cal-list">' + list.map((ev) => {
      let parts;
      try { parts = gcalLocalParts(ev); }
      catch { return ""; }
      const title = escH(ev.summary || "(No title)");
      const subBits = [];
      if (gcalScope !== "today") subBits.push(escH(parts.dateText));
      if (ev.location) subBits.push(escH(ev.location));
      const timeHtml = parts.allDay
        ? '<span class="cal-ev-time allday">All day</span>'
        : '<span class="cal-ev-time">' + escH(parts.timeText) + "</span>";
      const inner = '<div class="cal-ev-top"><span class="cal-ev-dot" style="--dot:' + calDotColor(ev) + '"></span><span class="cal-ev-title">' + title + "</span>" + timeHtml + "</div>" +
        (subBits.length ? '<div class="cal-ev-sub">' + subBits.join(" · ") + "</div>" : "");
      if (ev.htmlLink) {
        return '<a class="cal-event" href="' + escH(ev.htmlLink) + '" target="_blank" rel="noopener">' + inner + "</a>";
      }
      return '<span class="cal-event">' + inner + "</span>";
    }).join("") + "</div>";
  }
  box.innerHTML = html;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("#desk-cal [data-cal]");
  if (!btn) return;
  const act = btn.dataset.cal;
  if (act === "connect") {
    if (!gcalClientId()) openSettingsToLinks();
    else gcalConnect(false);
  } else if (act === "reconnect" || act === "retry") {
    gcalRefresh();
  } else if (act === "dismiss") {
    gcalSave({ promptDismissed: true });
    renderDeskCal();
  } else if (act === "today" || act === "upcoming") {
    // Clicking the active scope again flips back to the other view.
    gcalScope = (act === gcalScope) ? (act === "today" ? "upcoming" : "today") : act;
    renderDeskCal();
  }
});

function gcalAutoRefresh() {
  if (desktop.hidden || !gcalConnected() || document.hidden) return;
  if (gcalCache && Date.now() - gcalCache.at < 14 * 60 * 1000) return;
  gcalRefresh();
}
setInterval(gcalAutoRefresh, 60000);

function gcalStatus() {
  if (gcalBusy) return { state: "off", label: "Connecting…", action: "Connect", busy: true };
  if (gcalError && !gcalConnected()) return { state: "error", label: gcalError, action: "Retry" };
  const s = gcalStore();
  if (!s.token) return { state: "off", label: "See upcoming events on your desktop", action: "Connect" };
  if (!gcalTokenValid()) return { state: "expired", label: "Session expired — reconnect to continue", action: "Reconnect" };
  return { state: "on", label: s.email ? "Connected as " + s.email : "Connected", action: "Disconnect" };
}

registerIntegration({
  id: "gcal",
  name: "Google Calendar",
  icon: GCAL_G_ICON,
  status: gcalStatus,
  connect: () => gcalConnect(false),
  disconnect: gcalDisconnect,
});

// First paint: links list + calendar widget (hidden until login).
// Runs after all integrations above have registered.
renderLinks();
renderDeskCal();

/* ---------- Movable desktop widgets (clock + calendar) ----------
   Drag the clock anywhere, or the calendar by its header. Positions persist
   in prefs; Reset layout in Settings → Appearance restores the default. */
const CAL_DOT_COLORS = ["#8fb6f2", "#93d3a6", "#e3c07f", "#dda3ae", "#b7a6f2"];

function calDotColor(ev) {
  const s = String((ev && ev.id) || (ev && ev.summary) || "event");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CAL_DOT_COLORS[h % CAL_DOT_COLORS.length];
}

function widgetEl(id) {
  return id === "clock" ? document.querySelector(".desk-clock") : $("#desk-cal");
}

function savedWidgetPos() {
  const p = prefs.widgetPos;
  return p && typeof p === "object" ? p : {};
}

function clampWidget(id, left, top) {
  const el = widgetEl(id);
  const w = (el && el.offsetWidth) || 300;
  const h = (el && el.offsetHeight) || 80;
  return {
    left: Math.min(Math.max(left, 96 - w), window.innerWidth - 96),
    top: Math.min(Math.max(top, 20), window.innerHeight - 96),
  };
}

function placeWidget(id, left, top) {
  const el = widgetEl(id);
  if (!el) return;
  const c = clampWidget(id, left, top);
  el.style.position = "fixed";
  el.style.left = c.left + "px";
  el.style.top = c.top + "px";
  el.style.right = "auto";
  el.style.bottom = "auto";
}

function applyWidgetPos() {
  const pos = savedWidgetPos();
  for (const id of ["clock", "cal"]) {
    const el = widgetEl(id);
    if (!el) continue;
    const s = pos[id];
    if (s && Number.isFinite(s.left) && Number.isFinite(s.top)) {
      placeWidget(id, s.left, s.top);
    } else {
      el.style.position = "";
      el.style.left = "";
      el.style.top = "";
      el.style.right = "";
      el.style.bottom = "";
    }
  }
}

let widgetDrag = null;

function endWidgetDrag(save) {
  if (!widgetDrag) return;
  const w = widgetDrag;
  widgetDrag = null;
  w.el.classList.remove("dragging");
  if (!w.engaged) return;
  if (save) {
    const r = w.el.getBoundingClientRect();
    const pos = savedWidgetPos();
    pos[w.id] = { left: Math.round(r.left), top: Math.round(r.top) };
    prefs.widgetPos = pos;
    savePrefs();
  } else {
    applyWidgetPos();
  }
}

document.addEventListener("pointerdown", (e) => {
  if (desktop.hidden) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.target.closest("button, a, input, select, textarea")) return;
  const widget = e.target.closest(".desk-clock, #desk-cal");
  if (!widget) return;
  // Calendar drags by its header only, so event links keep working.
  if (widget.id === "desk-cal" && !e.target.closest(".cal-head")) return;
  const r = widget.getBoundingClientRect();
  widgetDrag = {
    el: widget,
    id: widget.classList.contains("desk-clock") ? "clock" : "cal",
    dx: e.clientX - r.left,
    dy: e.clientY - r.top,
    sx: e.clientX,
    sy: e.clientY,
    engaged: false,
  };
});

window.addEventListener("pointermove", (e) => {
  if (!widgetDrag) return;
  const w = widgetDrag;
  if (!w.engaged) {
    if (Math.hypot(e.clientX - w.sx, e.clientY - w.sy) < 5) return;
    w.engaged = true;
    w.el.classList.add("dragging");
  }
  placeWidget(w.id, e.clientX - w.dx, e.clientY - w.dy);
});

window.addEventListener("pointerup", () => endWidgetDrag(true));
window.addEventListener("pointercancel", () => endWidgetDrag(false));
window.addEventListener("resize", () => applyWidgetPos());

try {
  $("#layout-reset").addEventListener("click", () => {
    prefs.widgetPos = null;
    savePrefs();
    applyWidgetPos();
    toast("Desktop layout reset");
  });
} catch { /* settings markup missing — reset unavailable */ }

applyWidgetPos();

/* ---------- Tab Cloak (panic key) ---------- */
const CLOAK_PRESETS = {
  google: {
    title: "Google",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5.1c-1.8 1.2-4.1 2-6.8 2-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.8 27.9a12 12 0 0 1 0-7.8v-5.2H5.9a20 20 0 0 0 0 18.2l6.9-5.2Z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6.1 29.5 4 24 4A20 20 0 0 0 5.9 14.9l6.9 5.2C14.4 15.5 18.8 12 24 12Z"/></svg>',
  },
  docs: {
    title: "Google Docs",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#4285F4" d="M9 2h21l10 10v32a2 2 0 0 1-2 2H9a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z"/><path fill="#A1C2FA" d="M30 2v7a3 3 0 0 0 3 3h7L30 2Z"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3.5" d="M13 21h19M13 29h19M13 37h13"/></svg>',
  },
  drive: {
    title: "Google Drive",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#00832D" d="M14 4h10L9 31H0L14 4Z"/><path fill="#2684FC" d="M24 4h10l14 27h-10L24 4Z"/><path fill="#FFBA00" d="M9 31h29l-5 9H4l5-9Z"/><path fill="#00AC47" d="M0 31h9l-5 9H0V31Z"/><path fill="#0066DA" d="M38 31h10l-5 9h-10l5-9Z"/></svg>',
  },
  classroom: {
    title: "Google Classroom",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="10" fill="#188038"/><rect x="9" y="7" width="30" height="22" rx="2" fill="#fff"/><rect x="12" y="10" width="24" height="16" rx="1" fill="#34A853"/><path fill="#fff" d="M20 31h8v3h-8z"/><circle cx="17" cy="34" r="3.5" fill="#F9AB00"/><circle cx="31" cy="34" r="3.5" fill="#F9AB00"/><path fill="#F9AB00" d="M10 43c.3-4.3 2.6-6.5 7-6.5s6.7 2.2 7 6.5H10Zm14 0c.3-4.3 2.6-6.5 7-6.5s6.7 2.2 7 6.5H24Z"/></svg>',
  },
  blank: {
    title: "New Tab",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#c9ccd1"/></svg>',
  },
};

prefs.cloak = Object.assign(
  { enabled: false, key: "", preset: "google", title: "Google", icon: "", url: "" },
  prefs.cloak || {}
);
/* A fresh page load always starts uncloaked. */
prefs.cloak.enabled = false;

let cloaked = false;
let savedTitle = "";
let savedIcon = "";
let capturingKey = false;
const MOD_KEYS = ["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"];

function friendlyKey(code) {
  if (!code) return "Not set";
  const map = {
    Escape: "Esc", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[",
    BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
    Comma: ",", Period: ".", Slash: "/", Space: "Space", Tab: "Tab",
    CapsLock: "Caps Lock", Enter: "Enter", Backspace: "Backspace",
  };
  if (map[code]) return map[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^F\d+$/.test(code)) return code;
  if (code.startsWith("Arrow")) return code.slice(5) + " arrow";
  return code;
}

function cloakIconUrl() {
  const custom = String(prefs.cloak.icon || "").trim();
  if (custom) return custom;
  const p = CLOAK_PRESETS[prefs.cloak.preset];
  const svg = p ? p.svg : CLOAK_PRESETS.blank.svg;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function setFavicon(url) {
  let link = document.querySelector('link[rel~="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (String(url).startsWith("data:image/svg+xml")) link.type = "image/svg+xml";
  else link.removeAttribute("type");
  link.href = url;
}

function hazeAppForWin(win) {
  try {
    const a = APPS.find((x) => x.win === win);
    return a ? (a.label || a.name) : "";
  } catch { return ""; }
}

function updateHazeTitle() {
  if (cloaked) return;
  try {
    const top = [...winOrder].reverse().find((w) => w && !w.hidden)
      || APPS.map((a) => a.win).find((w) => w && !w.hidden);
    if (!top) {
      if (document.title !== "Haze") document.title = "Haze";
      return;
    }
    const next = "Haze - " + (hazeAppForWin(top) || "Desktop");
    if (document.title !== next) document.title = next;
  } catch { /* title must never break the app */ }
}

/* Re-apply the disguise while cloaked so preset/title/icon edits show instantly. */
function refreshCloakLive() {
  if (!cloaked) return;
  try {
    document.title = String(prefs.cloak.title || "Google").slice(0, 120) || "Google";
    setFavicon(cloakIconUrl());
  } catch { /* noop */ }
}

function cloakOn() {
  if (cloaked) return;
  cloaked = true;
  savedTitle = document.title;
  const link = document.querySelector('link[rel~="icon"]');
  savedIcon = link ? link.href : "";
  refreshCloakLive();
  prefs.cloak.enabled = true;
  savePrefs();
  syncCloakUI();
}

function cloakOff() {
  if (!cloaked) return;
  cloaked = false;
  if (savedIcon) {
    try { setFavicon(savedIcon); } catch { /* noop */ }
  }
  prefs.cloak.enabled = false;
  savePrefs();
  syncCloakUI();
  updateHazeTitle();
}

/* A set panic website wins: the key leaves this site entirely.
   Otherwise the key cloaks the tab in place. */
function panicUrl() {
  let u = String(prefs.cloak.url || "").trim();
  if (!u) return "";
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch { return ""; }
}

function firePanic() {
  if (!prefs.cloak.key) return;
  const dest = panicUrl();
  if (dest) {
    location.href = dest;
    return;
  }
  cloakOn();
}

/* The panic key is live whenever one is bound — no switch needed. */
function isPanicKeyEvent(e) {
  try {
    const c = prefs.cloak;
    return !!(c && c.key && e.code === c.key);
  } catch { return false; }
}

function syncCloakUI(withFields) {
  const c = prefs.cloak;
  const sw = $("#cloak-enabled");
  if (sw) {
    sw.classList.toggle("on", cloaked);
    sw.setAttribute("aria-checked", cloaked ? "true" : "false");
  }
  const keyBtn = $("#cloak-key");
  if (keyBtn && !capturingKey) keyBtn.textContent = c.key ? friendlyKey(c.key) : "Set keybind";
  const st = $("#cloak-status");
  if (st) {
    st.textContent = capturingKey
      ? "Press any key now"
      : cloaked
        ? "Cloaked" + (c.key ? " — turn off Tab cloak to restore" : " — turn off to restore")
        : c.key
          ? "Press " + friendlyKey(c.key) + " anywhere to escape instantly"
          : "Turn on to cloak now, or set a panic key below";
  }
  if (withFields) {
    const sel = $("#cloak-preset");
    if (sel) sel.value = CLOAK_PRESETS[c.preset] ? c.preset : "custom";
    const t = $("#cloak-title");
    if (t && document.activeElement !== t) t.value = c.title || "";
    const ic = $("#cloak-icon");
    if (ic && document.activeElement !== ic) ic.value = c.icon || "";
    const cu = $("#cloak-url");
    if (cu && document.activeElement !== cu) cu.value = c.url || "";
  }
  const pi = $("#cloak-preview-icon");
  if (pi) pi.src = cloakIconUrl();
  const pt = $("#cloak-preview-title");
  if (pt) pt.textContent = c.title || "Google";
}

window.addEventListener("keydown", (e) => {
  if (capturingKey) {
    if (MOD_KEYS.includes(e.code)) return;
    try { e.preventDefault(); e.stopPropagation(); } catch { /* noop */ }
    if (e.code !== "Escape") {
      prefs.cloak.key = e.code;
      savePrefs();
    }
    capturingKey = false;
    const keyBtn = $("#cloak-key");
    if (keyBtn) {
      keyBtn.classList.remove("capturing");
      keyBtn.blur();
    }
    if (document.activeElement && document.activeElement.blur) {
      try { document.activeElement.blur(); } catch { /* noop */ }
    }
    syncCloakUI();
    return;
  }
  const c = prefs.cloak;
  if (!c || !c.key) return;
  if (e.code !== c.key) return;
  /* Never hijack actual typing: a letter/number key bound as the panic key
     must not fire while you're typing in a field. Special keys (Esc,
     F-keys, …) always fire. */
  const t = e.target;
  const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  if (typing && e.key && e.key.length === 1) return;
  try { e.preventDefault(); } catch { /* noop */ }
  firePanic();
}, true);

$("#cloak-enabled").addEventListener("click", () => {
  if (cloaked) cloakOff();
  else cloakOn();
});

$("#cloak-key").addEventListener("click", () => {
  const keyBtn = $("#cloak-key");
  if (capturingKey) {
    capturingKey = false;
    keyBtn.classList.remove("capturing");
    keyBtn.blur();
    syncCloakUI();
    return;
  }
  capturingKey = true;
  keyBtn.textContent = "Press a key…";
  keyBtn.classList.add("capturing");
  keyBtn.blur();
  syncCloakUI();
});

$("#cloak-preset").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v !== "custom" && CLOAK_PRESETS[v]) {
    prefs.cloak.preset = v;
    prefs.cloak.title = CLOAK_PRESETS[v].title;
    // A previous custom URL takes precedence over every built-in icon.
    // Clear it when the user explicitly chooses a preset so the selected
    // preset's favicon appears both in the preview and the browser tab.
    prefs.cloak.icon = "";
  } else {
    prefs.cloak.preset = "custom";
  }
  savePrefs();
  syncCloakUI(true);
  refreshCloakLive();
});

$("#cloak-title").addEventListener("input", (e) => {
  prefs.cloak.title = e.target.value;
  prefs.cloak.preset = "custom";
  savePrefs();
  syncCloakUI();
});

$("#cloak-icon").addEventListener("input", (e) => {
  prefs.cloak.icon = e.target.value.trim();
  prefs.cloak.preset = "custom";
  savePrefs();
  syncCloakUI();
});

$("#cloak-url").addEventListener("input", (e) => {
  prefs.cloak.url = e.target.value.trim();
  savePrefs();
  syncCloakUI();
});

syncCloakUI(true);

/* ---------- Live ping to this website ---------- */
const PING_INTERVAL = 2500;
const PING_TIMEOUT = 6000;
let pingTimer = null;
let pingBusy = false;

function pingSupported() {
  return /^https?:$/.test(location.protocol);
}

function pingQuality(ms) {
  if (!navigator.onLine) return { label: "Offline", color: "#ffb4ae" };
  if (!isFinite(ms)) return { label: "Unavailable", color: "#ffb4ae" };
  if (ms < 30) return { label: "Excellent", color: "#b7f0c8" };
  if (ms < 80) return { label: "Good", color: "#b7f0c8" };
  if (ms < 150) return { label: "Fair", color: "#ffd479" };
  return { label: "Poor", color: "#ffb4ae" };
}

async function pingOnce() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT);
  const bust = (location.href.includes("?") ? "&" : "?") + "ping=" + Date.now() + Math.random().toString(36).slice(2, 7);
  const t0 = performance.now();
  try {
    await fetch(location.href + bust, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      mode: "same-origin",
      signal: ctrl.signal,
    });
    return performance.now() - t0;
  } finally {
    clearTimeout(timer);
  }
}

async function updatePing() {
  const value = $("#ping-value");
  const quality = $("#ping-quality");
  const dot = document.querySelector(".ping-live");
  if (!pingSupported()) {
    value.textContent = "--";
    quality.textContent = "Local file";
    quality.style.color = "#ffd479";
    if (dot) dot.classList.add("off");
    return;
  }
  if (pingBusy) return;
  pingBusy = true;
  try {
    const ms = await pingOnce();
    value.textContent = ms < 10 ? ms.toFixed(1) : Math.round(ms);
    const q = pingQuality(ms);
    quality.textContent = q.label;
    quality.style.color = q.color;
    if (dot) dot.classList.toggle("off", !navigator.onLine);
  } catch {
    value.textContent = "--";
    const q = pingQuality(NaN);
    quality.textContent = q.label;
    quality.style.color = q.color;
    if (dot) dot.classList.add("off");
  } finally {
    pingBusy = false;
  }
}

function startPingLoop() {
  stopPingLoop();
  try {
    $("#ping-host").textContent = new URL(location.href).host || location.href;
  } catch {
    $("#ping-host").textContent = location.href;
  }
  updatePing();
  pingTimer = setInterval(() => {
    if (document.visibilityState === "visible") updatePing();
  }, PING_INTERVAL);
}

function stopPingLoop() {
  clearInterval(pingTimer);
  pingTimer = null;
}

/* ---------- Battery + network readouts ---------- */
function renderNetInfo() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const online = navigator.onLine;
  const status = $("#net-status");
  status.textContent = online ? "Online" : "Offline";
  status.style.color = online ? "#b7f0c8" : "#ffb4ae";
  $("#net-type").textContent = conn && conn.effectiveType ? conn.effectiveType : "Unknown";
  $("#net-downlink").textContent =
    conn && typeof conn.downlink === "number" ? conn.downlink + " Mb/s" : "Not reported";
  $("#net-rtt").textContent = conn && typeof conn.rtt === "number" ? conn.rtt + " ms" : "Not reported";
  $("#net-page").textContent = location.href;
  $("#net-page").title = location.href;
}

function renderTtfb() {
  const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  const el = $("#net-ttfb");
  if (!nav || !isFinite(nav.responseStart) || !nav.responseStart) {
    el.textContent = "Not reported";
    return;
  }
  const ms = Math.round(nav.responseStart);
  el.textContent = ms + " ms";
}

function renderBattWidget(level, charging) {
  const pct = Math.round(level * 100);
  $("#batt-pct-widget").textContent = pct;
  $("#batt-state").textContent = charging
    ? pct >= 100
      ? "Fully charged"
      : "Charging"
    : pct <= 20
      ? "Low — " + pct + "% remaining"
      : "On battery";
  const meter = $("#batt-meter");
  $("#batt-fill-widget").style.width = pct + "%";
  meter.classList.toggle("charging", !!charging);
  meter.classList.toggle("mid", pct <= 50 && pct > 20);
  meter.classList.toggle("low", pct <= 20);
  meter.setAttribute("aria-label", "Battery " + pct + "%" + (charging ? ", charging" : ""));
}

async function initBattWidget() {
  try {
    if (!navigator.getBattery) throw new Error("unsupported");
    const batt = await navigator.getBattery();
    const update = () => renderBattWidget(batt.level, batt.charging);
    batt.addEventListener("levelchange", update);
    batt.addEventListener("chargingchange", update);
    update();
    return;
  } catch {
    /* no battery on this device */
  }
  $("#batt-pct-widget").textContent = "--";
  $("#batt-state").textContent = "No battery reported by this device";
  $("#batt-meter").classList.add("low");
}

window.addEventListener("online", () => {
  renderNetInfo();
  if (pingTimer) updatePing();
});
window.addEventListener("offline", () => {
  renderNetInfo();
  if (pingTimer) updatePing();
});
renderNetInfo();
renderTtfb();
initBattWidget();

/* ---------- Search caret ---------- */
function attachCustomCaret(field, input, caret) {
  const ruler = document.createElement("span");
  Object.assign(ruler.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "pre",
    top: "-9999px",
    left: "0",
  });
  document.body.appendChild(ruler);

  function syncRulerFont() {
    const cs = getComputedStyle(input);
    ruler.style.fontStyle = cs.fontStyle;
    ruler.style.fontWeight = cs.fontWeight;
    ruler.style.fontSize = cs.fontSize;
    ruler.style.fontFamily = cs.fontFamily;
    ruler.style.letterSpacing = cs.letterSpacing;
  }

  function placeCaret(restart = true) {
    const focused = document.activeElement === input;
    field.classList.toggle("focused", focused);
    if (!focused) return;

    ruler.textContent = input.value.slice(0, input.selectionStart);
    caret.style.left = input.offsetLeft + ruler.offsetWidth + "px";

    if (restart) {
      caret.style.animation = "none";
      void caret.offsetWidth;
      caret.style.animation = "";
    }
  }

  syncRulerFont();
  ["input", "keyup", "click", "select", "focus", "blur", "scroll"].forEach((evt) =>
    input.addEventListener(evt, () => placeCaret(evt !== "scroll"))
  );
  window.addEventListener("resize", () => placeCaret(false));
  return { sync: syncRulerFont, place: placeCaret };
}

const settingsCaret = attachCustomCaret($("#settings-search").closest(".search-field"), $("#settings-search"), $("#search-caret"));
const gamesCaret = attachCustomCaret($("#games-search-field"), $("#games-search"), $("#games-search-caret"));

$("#signout-btn").addEventListener("click", () => {
  clearSession();
  closeSettings(true);
  showAuth();
});

/* Drag any window by its titlebar (labels cover the search/url fields) */
function makeDraggable(win, bar) {
  let drag = null, raf = 0, px = 0, py = 0, ww = 0;
  const flush = () => {
    raf = 0;
    if (!drag) return;
    win.style.left = px + "px";
    win.style.top = py + "px";
  };
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, input, label")) return;
    if (win.classList.contains("max")) return;
    const r = win.getBoundingClientRect();
    win.style.left = r.left + "px";
    win.style.top = r.top + "px";
    win.style.transform = "none";
    ww = win.offsetWidth;
    drag = { x: e.clientX - r.left, y: e.clientY - r.top };
    try { bar.setPointerCapture(e.pointerId); } catch { /* mouse input */ }
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag) return;
    /* Cache the math and paint at most once per frame: multiple pointermove
       events per frame used to queue up style writes and trail the cursor. */
    px = Math.min(Math.max(e.clientX - drag.x, -ww + 80), innerWidth - 80);
    py = Math.min(Math.max(e.clientY - drag.y, 0), innerHeight - 60);
    if (!raf) raf = requestAnimationFrame(flush);
  });
  const end = () => {
    drag = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
}
makeDraggable(settingsWin, titlebar);

/* ---------- Proxy (Epoxy via Ultraviolet + BareMux, or local iframe) ---------- */
const UV_PREFIX = "/proxy/service/";
const UV_SW_URL = "/uv.sw.js?build=browsy-proxy-route-fix-20261010";
const UV_CDN = "https://cdn.jsdelivr.net/npm/@titaniumnetwork-dev/ultraviolet@3.2.10/dist";
const BAREMUX_CDN = "https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@2.1.9/dist/index.js";
const EPOXY_MJS = "https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-transport@3.0.1/dist/index.mjs";
const EPOXY_BAREMUX_FACTORY = `
const { default: EpoxyTransport } = await import("${EPOXY_MJS}");
const normalizeHeaders = (headers) => headers && typeof headers[Symbol.iterator] === "function"
  ? headers
  : new Headers(headers || {});
return [class BareMuxEpoxyTransport extends EpoxyTransport {
  request(remote, method, body, headers, signal) {
    return super.request(remote, method, body, normalizeHeaders(headers), signal);
  }
  connect(url, protocols, headers, onopen, onmessage, onclose, onerror) {
    return super.connect(url, protocols, normalizeHeaders(headers), onopen, onmessage, onclose, onerror);
  }
}, "EpoxyTransport (BareMux Headers adapter)"];
`; 
const WISP_DEFAULT = "wss://wisp.mercurywork.shop/";
const PROXY_UA_PROFILES = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  ps5: "Mozilla/5.0 (PlayStation; PlayStation 5/13.60) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
};
const SEARCH_ENGINES = {
  duckduckgo: (query) => "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query),
  google: (query) => "https://www.google.com/search?q=" + encodeURIComponent(query),
  brave: (query) => "https://search.brave.com/search?q=" + encodeURIComponent(query),
};

function proxyMode() {
  return prefs.proxy && prefs.proxy.mode === "epoxy" ? "epoxy" : "local";
}

function proxyWisp() {
  const w = prefs.proxy && String(prefs.proxy.wisp || "").trim();
  return w && /^wss?:\/\//.test(w) ? w : WISP_DEFAULT;
}

const loadedScripts = new Set();
function loadScript(src) {
  if (loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => { loadedScripts.add(src); resolve(); };
    s.onerror = () => reject(new Error("Couldn't load " + src));
    document.head.appendChild(s);
  });
}

let muxConn = null;
let uvWisp = "";

function withTimeout(promise, ms, label) {
  let t = null;
  const gate = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label + " timed out")), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), gate]);
}

function ensureUvConfig() {
  if (self.__uv$config) return;
  const codec = self.Ultraviolet && self.Ultraviolet.codec && self.Ultraviolet.codec.xor;
  if (!codec) throw new Error("Ultraviolet loaded without its URL codec.");
  self.__uv$config = {
    prefix: UV_PREFIX,
    encodeUrl: codec.encode,
    decodeUrl: codec.decode,
    handler: UV_CDN + "/uv.handler.js",
    bundle: UV_CDN + "/uv.bundle.js",
    config: "/proxy/uv.config.js",
    sw: "/proxy/uv.sw.js",
    client: UV_CDN + "/uv.client.js",
  };
}

/* Activation isn't control: an already-open tab only gets intercepted
   once the worker actually controls it. Wait for that moment. */
function waitControlled(scriptUrl) {
  const target = new URL(scriptUrl, location.href).href;
  if (navigator.serviceWorker.controller?.scriptURL === target) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      reject(new Error("The updated proxy service worker did not take control — reload the page once, then test again."));
    }, 12000);
    const onChange = () => {
      if (navigator.serviceWorker.controller?.scriptURL !== target) return;
      clearTimeout(t);
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    onChange();
  });
}

/* Wait for the proxy worker to activate, reporting exactly what it's stuck in. */
function waitSwActive(reg, scriptUrl) {
  const target = new URL(scriptUrl, location.href).href;
  return new Promise((resolve, reject) => {
    const worker = () => [reg.installing, reg.waiting, reg.active].find((w) => w && w.scriptURL === target);
    const state = () => {
      const w = worker();
      return w ? w.state : "waiting for update";
    };
    const t = setTimeout(() => {
      reg.removeEventListener("updatefound", onChange);
      reject(new Error("Updated proxy service worker didn't activate (stuck in '" + state() + "' for 20s)."));
    }, 20000);
    const onChange = () => {
      const w = worker();
      if (!w) return;
      w.addEventListener("statechange", onChange);
      if (w.state === "activated" && reg.active === w) {
        clearTimeout(t);
        reg.removeEventListener("updatefound", onChange);
        resolve();
      } else if (w.state === "redundant") {
        clearTimeout(t);
        reg.removeEventListener("updatefound", onChange);
        reject(new Error("Proxy service worker script crashed on install. Open DevTools (F12) → Console and send the red error line."));
      }
    };
    reg.addEventListener("updatefound", onChange);
    onChange();
  });
}

async function ensureProxyStack(onStep) {
  const step = (m) => { try { onStep && onStep(m); } catch { /* noop */ } };
  if (location.protocol === "file:" || location.origin === "null") {
    throw new Error("Epoxy cannot run from a file:// page. Keep the server running and open http://localhost:8000/ in your browser.");
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser doesn't support service workers, which Epoxy mode needs.");
  }
  if (!window.isSecureContext) {
    throw new Error("Epoxy mode needs the site served over http(s) — run python -m http.server, not file://.");
  }
  step("Loading proxy libraries…");
  try {
    if (!self.Ultraviolet) await withTimeout(loadScript(UV_CDN + "/uv.bundle.js"), 25000, "Library download");
    ensureUvConfig();
    if (!self.BareMux) await withTimeout(loadScript(BAREMUX_CDN), 25000, "Library download");
  } catch (err) {
    throw new Error("Couldn't download the proxy libraries — check your internet connection (" + (err && err.message ? err.message : err) + ").");
  }
  step("Configuring Epoxy transport…");
  const wisp = proxyWisp();
  console.log("[Epoxy] Using Wisp:", wisp);
  try {
    if (!muxConn) {
      console.log("[Epoxy] Creating BareMuxConnection...");
      muxConn = new self.BareMux.BareMuxConnection("/proxy/bare-mux-worker.js");
    }
    if (uvWisp !== wisp) {
      console.log("[Epoxy] Configuring epoxy-transport with BareMux header compatibility...");
      await withTimeout(muxConn.setManualTransport(EPOXY_BAREMUX_FACTORY, [{ wisp }]), 60000, "Epoxy transport setup");
      uvWisp = wisp;
      console.log("[Epoxy] Transport configured");
    }
  } catch (err) {
    console.error("[Epoxy] Transport setup failed:", err);
    throw new Error("Couldn't configure the Epoxy transport (" + (err && err.message ? err.message : err) + "). Check browser console for details.");
  }
  step("Installing proxy service…");
  const installWorker = (scriptUrl) =>
    withTimeout(
      navigator.serviceWorker.register(scriptUrl, { scope: "/", updateViaCache: "none" }),
      20000,
      "Service installation"
    ).then(async (reg) => {
      await waitSwActive(reg, scriptUrl);
      return reg;
    });
  try {
    await installWorker(UV_SW_URL);
  } catch (err) {
    throw new Error("Proxy service worker failed to install (" + (err && err.message ? err.message : err) + ").");
  }
  try {
    await waitControlled(UV_SW_URL);
  } catch {
    // A stale cached worker may be squatting the scope: evict everything
    // under /proxy/ and install a byte-fresh copy, then wait again.
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.filter((r) => String(r.scope || "").includes("/proxy/") || r.scope === "/").map((r) => r.unregister())
      );
      const freshWorkerUrl = UV_SW_URL + "&fresh=" + Date.now();
      await installWorker(freshWorkerUrl);
      await waitControlled(freshWorkerUrl);
    } catch {
      throw new Error("Page never came under proxy control — open DevTools (F12) → Application → Service Workers → Unregister, reload, and test again.");
    }
  }
  navigator.serviceWorker.controller?.postMessage({ type: "browsy-user-agent", userAgent: PROXY_UA_PROFILES[prefs.proxy.userAgent] || "" });
  step("Ready");
}

async function uvUrl(url) {
  await ensureProxyStack();
  return location.origin + self.__uv$config.prefix + self.__uv$config.encodeUrl(url);
}

function uvDecode(src) {
  try {
    const pfx = location.origin + UV_PREFIX;
    if (src.startsWith(pfx) && self.__uv$config) {
      return self.__uv$config.decodeUrl(src.slice(pfx.length));
    }
  } catch { /* not a proxy URL */ }
  return src;
}

function setProxyMode(mode) {
  if (mode !== "epoxy" && mode !== "local") return;
  prefs.proxy.mode = mode;
  savePrefs();
  syncProxyUI();
  // Immediately re-route whatever Browsy is showing — no restart needed.
  if (!browsyWin.hidden && !brFrame.hidden) {
    const real = browsyRealUrl();
    if (real) {
      if (mode === "epoxy") {
        uvUrl(real).then(
          (target) => { brFrame.src = target; },
          (err) => showBrError(real, err)
        );
      } else {
        hideBrError();
        brFrame.src = real;
      }
    }
  }
}

/* The real page URL no matter which mode rendered it. */
function browsyRealUrl() {
  try {
    const href = brFrame.contentWindow.location.href;
    if (!href || href === "about:blank") return normalizeBrowsyUrl(brUrl.value);
    return uvDecode(href);
  } catch {
    return normalizeBrowsyUrl(brUrl.value); // cross-origin direct page
  }
}

function hideBrError() {
  $("#br-error").hidden = true;
}

function showBrError(url, err) {
  brFrame.hidden = true;
  brStart.hidden = false;
  const msg = err && err.message ? err.message : String(err || "Unknown error");
  $("#br-error-title").textContent = "Couldn't load this page through Epoxy";
  $("#br-error-msg").textContent = msg + (url ? " — " + url : "");
  $("#br-error").hidden = false;
  try { toast("Epoxy error: " + msg.slice(0, 120)); } catch { /* noop */ }
}

function syncProxyUI() {
  const searchEngine = $("#proxy-search-engine");
  if (searchEngine && document.activeElement !== searchEngine) searchEngine.value = prefs.proxy.searchEngine;
  const userAgent = $("#proxy-user-agent");
  if (userAgent && document.activeElement !== userAgent) userAgent.value = prefs.proxy.userAgent;
  browsyWin.classList.toggle("ua-mobile", ["iphone", "ipad", "android"].includes(prefs.proxy.userAgent));
  navigator.serviceWorker?.controller?.postMessage({ type: "browsy-user-agent", userAgent: PROXY_UA_PROFILES[prefs.proxy.userAgent] || "" });
  const mode = proxyMode();
  document.querySelectorAll(".proxy-mode").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  const w = $("#proxy-wisp");
  if (w && document.activeElement !== w) w.value = proxyWisp();
  const st = $("#proxy-status");
  if (st) {
    st.textContent = mode === "epoxy"
      ? (uvWisp ? "Epoxy ready via " + uvWisp : "Epoxy mode — connects on next page load")
      : "Local iframe mode";
  }
}

/* ---------- Browsy browser ---------- */
const brFrame = $("#br-frame");
let brNavigationTimer = 0;
const brUrl = $("#br-url");
const brStart = $("#br-start");

function openBrowsy() {
  browsyWin.classList.toggle("ua-mobile", ["iphone", "ipad", "android"].includes(prefs.proxy.userAgent));
  // Already open -> clicking the dock icon minimizes it, like Settings
  if (!browsyWin.hidden) {
    closeBrowsy(false);
    return;
  }
  browsyWin.hidden = false;
  browsyWin.classList.remove("open");
  void browsyWin.offsetWidth;
  browsyWin.classList.add("open");
  browsyBtn.classList.add("running");
  focusWindow(browsyWin);
}

function closeBrowsy(quit = true) {
  browsyWin.hidden = true;
  if (quit) browsyBtn.classList.remove("running");
}

/* ---------- Games ---------- */
function openGames() {
  if (!gamesWin.hidden) {
    closeGames(false);
    return;
  }
  gamesWin.hidden = false;
  gamesWin.classList.remove("open");
  void gamesWin.offsetWidth;
  gamesWin.classList.add("open");
  gamesBtn.classList.add("running");
  focusWindow(gamesWin);
  if (playerGameId) {
    const g = GAMES.find((x) => x.id === playerGameId);
    if (g) showDetail(g.id);
  }
}

function closeGames(quit = true) {
  stopGame();
  gamesWin.hidden = true;
  if (quit) gamesBtn.classList.remove("running");
}

/* ---------- Drift private messaging ---------- */
let driftPollingTimer = 0;
let driftSelectedFriend = null;
let driftUsername = "";
let driftContactsCache = [];
let driftMyCloudAvatar = "";

function driftSession() {
  if (!cloudOn() || !currentUser) return null;
  const secureOrigin = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!secureOrigin) return null;
  const session = readSupaSession();
  if (!session || !session.token || !session.user || !session.user.id) return null;
  return String(session.user.email || "").trim().toLowerCase() === String(currentUser.email || "").trim().toLowerCase()
    ? session : null;
}

function driftSetStatus(text, error = false) {
  const status = $("#drift-status");
  status.textContent = text || "";
  status.classList.toggle("error", !!error);
}

function stopDriftPolling() {
  if (driftPollingTimer) clearInterval(driftPollingTimer);
  driftPollingTimer = 0;
}

function driftAvatarText(name) {
  return String(name || "D").trim().replace(/^@/, "").charAt(0).toUpperCase() || "D";
}

/* Handles look like iez#0001: base name + 4-digit tag. The pair is unique,
   so many people can share a base name but only one owns each full tag. */
function driftHandleOf(contact) {
  if (!contact) return "";
  if (contact.handle) return String(contact.handle);
  if (contact.username && contact.discriminator) return contact.username + "#" + contact.discriminator;
  if (contact.username) return String(contact.username);
  return "";
}

function driftBaseOf(handle) {
  return String(handle || "").replace(/^@/, "").split("#")[0].toLowerCase();
}

function driftClaimResultHandle(result) {
  const obj = Array.isArray(result) ? result[0] : result;
  if (!obj || typeof obj !== "object") return "";
  if (obj.handle) return String(obj.handle);
  if (obj.username && obj.discriminator) return obj.username + "#" + obj.discriminator;
  if (obj.username) return String(obj.username);
  return "";
}

function driftBaseFromAccount(session) {
  const id = String(session.user.id).replace(/[^a-f0-9-]/gi, "");
  const raw = String((currentUser && currentUser.name) || (session.user.email || "").split("@")[0] || "member").toLowerCase();
  let base = raw.replace(/[^a-z0-9_]/g, "").slice(0, 24);
  if (base.length < 3) base = "member_" + id.replace(/-/g, "").slice(0, 8);
  return base;
}

/* Cloud-only: Drift contacts/messages live in Supabase, never localStorage.
   Decorations render exactly like Settings: profile image plus the
   decoration artwork layered behind it. */
function driftPaintAvatar(el, username, email, imageUrl) {
  if (!el) return;
  el.replaceChildren();
  const me = String((currentUser && currentUser.email) || "").trim().toLowerCase();
  const decoration = email && email === me ? activeAvatarDecoration || "" : "";
  const art = decoration && AVATAR_DECORATIONS.find((item) => item.id === decoration && item.image);
  const pic = imageUrl || (email ? userPic(email) : "") || ((email && email === me) ? driftMyCloudAvatar : "");
  if (art || pic) {
    const img = document.createElement("img");
    img.className = "drift-pic";
    img.src = pic || AVATAR_DEFAULT;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    el.appendChild(img);
  } else {
    el.textContent = driftAvatarText(username);
  }
  if (art) {
    el.dataset.decoration = decoration;
    const artImg = document.createElement("img");
    artImg.className = "avatar-decoration-art";
    artImg.src = art.image;
    artImg.alt = "";
    artImg.setAttribute("aria-hidden", "true");
    el.appendChild(artImg);
    el.title = art.name + " equipped";
  } else {
    delete el.dataset.decoration;
    el.removeAttribute("title");
  }
}

function driftPaintMyAvatar() {
  const me = String((currentUser && currentUser.email) || "").trim().toLowerCase();
  driftPaintAvatar($("#drift-my-avatar"), driftUsername, me);
}

/* Cross-device avatars: mirror the local picture to the cloud row so friends
   see it on any device, and pull it back when this login has no local copy. */
async function driftSyncMyAvatar(session) {
  const me = String((currentUser && currentUser.email) || "").trim().toLowerCase();
  try {
    const rows = await supaRest("GET", "/rest/v1/drift_users?select=avatar_url&user_id=eq." + encodeURIComponent(session.user.id) + "&limit=1", undefined, session.token);
    driftMyCloudAvatar = (rows && rows[0] && rows[0].avatar_url) || "";
    const local = userPic(me);
    if (local && !driftMyCloudAvatar) {
      await supaRest("POST", "/rest/v1/rpc/drift_set_avatar", { p_url: local }, session.token);
      driftMyCloudAvatar = local;
    }
  } catch { /* avatar stays local-only */ }
}

async function driftPushAvatar(url) {
  const session = driftSession();
  if (!session) return;
  try {
    await supaRest("POST", "/rest/v1/rpc/drift_set_avatar", { p_url: url || "" }, session.token);
    driftMyCloudAvatar = url || "";
    if (!driftWin.hidden) driftPaintMyAvatar();
  } catch { /* avatar stays local-only */ }
}

function openDrift() {
  if (!driftWin.hidden) {
    closeDrift(false);
    return;
  }
  driftWin.hidden = false;
  driftWin.classList.remove("open");
  void driftWin.offsetWidth;
  driftWin.classList.add("open");
  driftBtn.classList.add("running");
  focusWindow(driftWin);
  loadDrift();
  stopDriftPolling();
  driftPollingTimer = setInterval(() => {
    if (driftWin.hidden || !driftSession()) return;
    loadDriftContacts(true);
    if (driftSelectedFriend) loadDriftMessages(true);
  }, 3000);
}

function closeDrift(quit = true) {
  driftWin.hidden = true;
  stopDriftPolling();
  if (quit) driftBtn.classList.remove("running");
}

async function driftEnsureUsername(session) {
  const base = driftBaseFromAccount(session);
  try {
    const claimed = await supaRest("POST", "/rest/v1/rpc/drift_claim_username", { p_base: base }, session.token);
    const handle = driftClaimResultHandle(claimed);
    if (handle) return handle;
  } catch (error) {
    const msg = String((error && error.message) || "");
    if (!/schema cache|function|not found|404|PGRST/i.test(msg)) throw error;
  }
  const path = "/rest/v1/drift_users?select=user_id,username&user_id=eq." + encodeURIComponent(session.user.id) + "&limit=1";
  let rows = await supaRest("GET", path, undefined, session.token);
  if (rows && rows.length) return driftHandleOf(rows[0]);
  rows = await supaRest("POST", "/rest/v1/drift_users?on_conflict=user_id", {
    user_id: session.user.id, username: base,
  }, session.token, "resolution=merge-duplicates,return=representation");
  if (rows && rows.length) return driftHandleOf(rows[0]);
  return base + "#0001";
}

async function loadDrift() {
  const session = driftSession();
  const cloudRequired = $("#drift-cloud-required");
  const usernameForm = $("#drift-username-form");
  const addForm = $("#drift-add-form");
  const chat = $("#drift-chat");
  cloudRequired.hidden = !!session;
  usernameForm.hidden = true;
  addForm.hidden = !session;
  if (!session) {
    if (currentUser) {
      try { await refreshMistWallet(); } catch { /* pic/deco fall back below */ }
      const me = String(currentUser.email || "").trim().toLowerCase();
      const display = String(currentUser.name || me.split("@")[0] || "User").slice(0, 24);
      $("#drift-my-name").textContent = display;
      driftPaintAvatar($("#drift-my-avatar"), display, me);
      if (!cloudOn()) driftSetStatus("");
      else {
        const secureOrigin = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
        if (!secureOrigin) driftSetStatus("Open over localhost or HTTPS to connect Drift.", true);
        else driftSetStatus("Sign in again to connect Drift.", true);
      }
    } else {
      $("#drift-my-name").textContent = "Sign in required";
      driftPaintAvatar($("#drift-my-avatar"), "D", "");
      driftSetStatus("");
    }
    $("#drift-friends").replaceChildren();
    $("#drift-friend-count").textContent = "";
    driftContactsCache = [];
    chat.hidden = true;
    driftSelectedFriend = null;
    stopDriftPolling();
    return;
  }
  cloudRequired.hidden = true;
  try {
    driftSetStatus("Connecting securely…");
    driftUsername = await driftEnsureUsername(session);
    $("#drift-my-name").textContent = driftUsername;
    await driftSyncMyAvatar(session);
    driftPaintMyAvatar();
    $("#drift-username").value = driftBaseOf(driftUsername);
    if (driftContactsCache.length) renderDriftContacts(driftContactsCache);
    await loadDriftContacts();
    const first = driftContactsCache.find((contact) => contact.status === "accepted");
    if (first && !driftSelectedFriend) {
      await openDriftConversation(first.friend_user_id, driftHandleOf(first), first.avatar);
    }
    driftSetStatus("");
  } catch (error) {
    driftSetStatus("Could not connect. Check the Drift database setup.", true);
    const me = String((currentUser && currentUser.email) || "").trim().toLowerCase();
    const display = String((currentUser && currentUser.name) || me.split("@")[0] || "User").slice(0, 24);
    $("#drift-my-name").textContent = display;
    driftPaintAvatar($("#drift-my-avatar"), display, me);
    $("#drift-username").value = driftBaseFromAccount(session);
    usernameForm.hidden = false;
  }
}

async function loadDriftContacts(quiet = false) {
  const session = driftSession();
  if (!session) return;
  try {
    const contacts = await supaRest("POST", "/rest/v1/rpc/drift_contacts", {}, session.token);
    driftContactsCache = Array.isArray(contacts) ? contacts : [];
    renderDriftContacts(driftContactsCache);
    if (driftSelectedFriend) {
      const stillFriend = contacts.some((item) => item.friend_user_id === driftSelectedFriend.id && item.status === "accepted");
      if (!stillFriend) {
        driftSelectedFriend = null;
        $("#drift-chat").hidden = true;
      }
    }
    if (!quiet) driftSetStatus("");
  } catch (error) {
    if (!quiet) driftSetStatus(String(error.message || "Could not load friends."), true);
  }
}

function renderDriftContacts(contacts) {
  const list = $("#drift-friends");
  list.replaceChildren();
  const session = driftSession();
  const myId = session && session.user.id;
  const acceptedCount = contacts.filter((item) => item.status === "accepted").length;
  $("#drift-friend-count").textContent = acceptedCount ? String(acceptedCount) : "";
  if (!contacts.length) {
    const note = document.createElement("div");
    note.className = "drift-sidebar-status";
    note.textContent = "No friends yet. Add someone by username.";
    list.appendChild(note);
    return;
  }
  contacts.forEach((contact) => {
    const handle = driftHandleOf(contact);
    const incoming = contact.status === "pending" && contact.requested_by !== myId;
    const row = contact.status === "accepted" ? document.createElement("button") : document.createElement("div");
    row.className = "drift-friend-row" + (driftSelectedFriend && driftSelectedFriend.id === contact.friend_user_id ? " active" : "");
    if (row.tagName === "BUTTON") row.type = "button";
    const avatar = document.createElement("span");
    avatar.className = "drift-avatar";
    avatar.setAttribute("aria-hidden", "true");
    driftPaintAvatar(avatar, handle, null, contact.avatar);
    const meta = document.createElement("span");
    meta.className = "drift-friend-meta";
    const name = document.createElement("strong");
    name.textContent = handle;
    const state = document.createElement("span");
    state.textContent = contact.status === "accepted" ? "Open conversation" : incoming ? "Wants to chat" : "Request sent";
    meta.append(name, state);
    row.append(avatar, meta);
    if (contact.status === "pending" && incoming) {
      const actions = document.createElement("span");
      actions.className = "drift-request-actions";
      const accept = document.createElement("button");
      accept.type = "button";
      accept.textContent = "Accept";
      accept.dataset.driftRespond = "accept";
      accept.dataset.friendId = contact.friend_user_id;
      const decline = document.createElement("button");
      decline.type = "button";
      decline.textContent = "Ignore";
      decline.dataset.driftRespond = "decline";
      decline.dataset.friendId = contact.friend_user_id;
      actions.append(accept, decline);
      row.appendChild(actions);
    }
    row.dataset.friendId = contact.friend_user_id;
    row.dataset.username = handle;
    list.appendChild(row);
  });
}

async function openDriftConversation(friendId, username, avatar) {
  driftSelectedFriend = { id: friendId, username, avatar: avatar || "" };
  $("#drift-chat-name").textContent = username;
  driftPaintAvatar($("#drift-chat-avatar"), username, null, driftSelectedFriend.avatar);
  $("#drift-chat").hidden = false;
  renderDriftContacts(driftContactsCache);
  try { driftClosePops(); driftHideSuggest(); } catch { /* pickers optional */ }
  await loadDriftMessages();
  $("#drift-message").focus();
}

async function loadDriftMessages(quiet = false) {
  const session = driftSession();
  const friend = driftSelectedFriend;
  if (!session || !friend) return;
  try {
    const records = await supaRest("POST", "/rest/v1/rpc/drift_messages_with", {
      p_friend_user: friend.id, p_limit: 100,
    }, session.token);
    if (driftSelectedFriend?.id !== friend.id) return;
    renderDriftMessages(Array.isArray(records) ? records : [], session.user.id);
    const known = driftContactsCache.find((contact) => contact.friend_user_id === friend.id);
    const latest = known ? known.avatar || "" : "";
    if (latest !== (friend.avatar || "")) {
      friend.avatar = latest;
      driftSelectedFriend.avatar = latest;
      driftPaintAvatar($("#drift-chat-avatar"), friend.username, null, latest);
    }
  } catch (error) {
    if (!quiet) driftSetStatus(String(error.message || "Could not load messages."), true);
  }
}

function renderDriftMessages(records, myId) {
  const list = $("#drift-messages");
  list.replaceChildren();
  if (!records.length) {
    const note = document.createElement("div");
    note.className = "drift-day";
    note.textContent = "This is the start of your private conversation.";
    list.appendChild(note);
    return;
  }
  let previousDay = "";
  records.forEach((record) => {
    const date = new Date(record.created_at);
    const day = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    if (day !== previousDay) {
      const label = document.createElement("div");
      label.className = "drift-day";
      label.textContent = day;
      list.appendChild(label);
      previousDay = day;
    }
    const bubble = document.createElement("div");
    bubble.className = "drift-message" + (record.sender_id === myId ? " own" : "");
    const content = document.createElement("span");
    driftRenderContent(content, record.body);
    const time = document.createElement("time");
    time.dateTime = record.created_at;
    time.textContent = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    bubble.append(content, time);
    list.appendChild(bubble);
  });
  list.scrollTop = list.scrollHeight;
}

$("#drift-username-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const session = driftSession();
  const base = $("#drift-username").value.trim().toLowerCase();
  if (!session || !/^[a-z0-9_]{3,24}$/.test(base)) return;
  try {
    let handle = "";
    try {
      const claimed = await supaRest("POST", "/rest/v1/rpc/drift_claim_username", { p_base: base }, session.token);
      handle = driftClaimResultHandle(claimed);
    } catch (claimError) {
      const claimMsg = String((claimError && claimError.message) || "");
      if (!/schema cache|function|not found|404|PGRST/i.test(claimMsg)) throw claimError;
      await supaRest("POST", "/rest/v1/drift_users?on_conflict=user_id", {
        user_id: session.user.id, username: base,
      }, session.token, "resolution=merge-duplicates,return=representation");
      handle = base + "#0001";
    }
    driftUsername = handle;
    $("#drift-my-name").textContent = handle;
    driftPaintMyAvatar();
    $("#drift-username").value = driftBaseOf(handle);
    $("#drift-username-form").hidden = true;
    driftSetStatus("Username saved.");
  } catch (error) {
    driftSetStatus(/duplicate|unique|taken/i.test(String(error.message)) ? "That name is out of tags. Try another name." : String(error.message || "Could not save username."), true);
  }
});
$("#drift-add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const session = driftSession();
  const handle = $("#drift-friend-name").value.trim().replace(/^@/, "").toLowerCase();
  if (!session || !/^[a-z0-9_]{3,24}#[0-9]{4}$/.test(handle) || handle.endsWith("#0000")) {
    driftSetStatus("Enter the full tag, like iez#0001.", true);
    return;
  }
  try {
    await supaRest("POST", "/rest/v1/rpc/drift_request_friend", { p_username: handle }, session.token);
    $("#drift-friend-name").value = "";
    driftSetStatus("Friend request sent.");
    await loadDriftContacts(true);
  } catch (error) {
    const msg = String(error.message || "Could not send friend request.");
    driftSetStatus(/already|exists/i.test(msg) ? "A request or conversation with that person already exists." : /not found|full tag/i.test(msg) ? "No Drift user was found with that tag." : msg, true);
  }
});
$("#drift-friends").addEventListener("click", async (event) => {
  const action = event.target.closest("[data-drift-respond]");
  if (action) {
    const session = driftSession();
    if (!session) return;
    try {
      await supaRest("POST", "/rest/v1/rpc/drift_respond", {
        p_friend_user: action.dataset.friendId, p_accept: action.dataset.driftRespond === "accept",
      }, session.token);
      driftSetStatus(action.dataset.driftRespond === "accept" ? "Friend request accepted." : "Request ignored.");
      await loadDriftContacts(true);
    } catch (error) { driftSetStatus(String(error.message || "Could not update request."), true); }
    return;
  }
  const row = event.target.closest(".drift-friend-row[data-friend-id]");
  if (row && row.querySelector(".drift-friend-meta span")?.textContent === "Open conversation") {
    const known = driftContactsCache.find((contact) => contact.friend_user_id === row.dataset.friendId);
    openDriftConversation(row.dataset.friendId, row.dataset.username, known && known.avatar);
  }
});
/* ---------- Drift emoji, GIFs, and rich messages ---------- */
/* GIF key lives next to SUPABASE_CONFIG as KLIPY_API_KEY. */

function driftToneSuffix(parent) {
  const folder = String(parent || "").toLowerCase();
  if (folder.includes("medium dark")) return "medium_dark";
  if (folder.includes("medium light")) return "medium_light";
  if (folder.includes("medium")) return "medium";
  if (folder.includes("dark")) return "dark";
  if (folder.includes("light")) return "light";
  return folder.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 16);
}

const DRIFT_EMOJI = (() => {
  const list = [];
  const seen = new Set();
  const counts = {};
  const files = typeof DRIFT_EMOJI_FILES !== "undefined" && Array.isArray(DRIFT_EMOJI_FILES) ? DRIFT_EMOJI_FILES : [];
  const items = files.map((path) => {
    const parts = String(path).split("/");
    const file = parts.pop() || "";
    const code = file.replace(/\.png$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
    return { path: "images/Emojis/" + path, code, parent: parts.pop() || "", category: (parts[0] || "Emoji").replace(/_/g, " ").trim() || "Emoji" };
  });
  items.forEach((item) => { if (item.code.length >= 2) counts[item.code] = (counts[item.code] || 0) + 1; });
  items.forEach((item) => {
    if (item.code.length < 2) return;
    let code = item.code;
    if (counts[item.code] > 1) {
      const suffix = driftToneSuffix(item.parent);
      const stem = item.code.slice(0, Math.max(1, 32 - suffix.length - 4));
      code = stem + "_" + suffix;
      let n = 2;
      while (seen.has(code) && n < 100) code = (stem + "_" + suffix + "_" + n++).slice(0, 32);
      if (seen.has(code)) return;
    }
    if (seen.has(code)) return;
    seen.add(code);
    list.push({ code, src: item.src, category: item.category });
  });
  return list;
})();
const DRIFT_EMOJI_MAP = new Map(DRIFT_EMOJI.map((entry) => [entry.code, entry.src]));
const DRIFT_IMG_HOST_RE = /(^|\.)(klipy\.com|tenor\.com)$/i;

function driftHideSuggest() {
  $("#drift-suggest").hidden = true;
}

function driftClosePops() {
  $("#drift-emoji-pop").hidden = true;
  $("#drift-gif-pop").hidden = true;
  $("#drift-emoji-btn").classList.remove("active");
  $("#drift-gif-btn").classList.remove("active");
}

function driftInsertEmoji(code) {
  const box = $("#drift-message");
  const token = ":" + code + ":";
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? box.value.length;
  box.value = box.value.slice(0, start) + token + box.value.slice(end);
  box.focus();
  const pos = start + token.length;
  try { box.setSelectionRange(pos, pos); } catch { /* older browsers */ }
  driftHideSuggest();
  driftUpdateSuggest();
}

function driftUpdateSuggest() {
  const box = $("#drift-message");
  const bar = $("#drift-suggest");
  const caret = box.selectionStart ?? box.value.length;
  const match = box.value.slice(0, caret).match(/:([a-z0-9_]{1,30})$/i);
  if (!match) { bar.hidden = true; return; }
  const query = match[1].toLowerCase();
  const matches = DRIFT_EMOJI.filter((entry) => entry.code.includes(query))
    .sort((a, b) => ((a.code.startsWith(query) ? 0 : 1) - (b.code.startsWith(query) ? 0 : 1)) || (a.code < b.code ? -1 : 1))
    .slice(0, 8);
  if (!matches.length) { bar.hidden = true; return; }
  bar.replaceChildren();
  matches.forEach((entry, index) => {
    const pick = document.createElement("button");
    pick.type = "button";
    pick.dataset.code = entry.code;
    if (index === 0) pick.classList.add("sel");
    const img = document.createElement("img");
    img.src = entry.src;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = ":" + entry.code + ":";
    pick.append(img, label);
    pick.addEventListener("mousedown", (event) => {
      event.preventDefault();
      driftAcceptSuggest(entry.code, false);
    });
    bar.appendChild(pick);
  });
  bar.hidden = false;
}

function driftAcceptSuggest(code, send) {
  const box = $("#drift-message");
  const caret = box.selectionStart ?? box.value.length;
  const before = box.value.slice(0, caret).replace(/:([a-z0-9_]{1,30})$/i, ":" + code + ":");
  box.value = before + box.value.slice(caret);
  box.focus();
  driftHideSuggest();
  if (send) $("#drift-compose").requestSubmit();
}

function driftRenderEmojiGrid(filter) {
  const grid = $("#drift-emoji-grid");
  grid.replaceChildren();
  const query = String(filter || "").trim().toLowerCase().replace(/\s+/g, "_");
  let lastCategory = "";
  let shown = 0;
  DRIFT_EMOJI.forEach((entry) => {
    if (query && !entry.code.includes(query)) return;
    if (shown >= 300) return;
    if (!query && entry.category !== lastCategory) {
      lastCategory = entry.category;
      const head = document.createElement("div");
      head.className = "drift-emoji-cat";
      head.textContent = lastCategory;
      grid.appendChild(head);
    }
    const pick = document.createElement("button");
    pick.type = "button";
    pick.title = ":" + entry.code + ":";
    pick.setAttribute("aria-label", entry.code);
    const img = document.createElement("img");
    img.src = entry.src;
    img.alt = "";
    img.loading = "lazy";
    pick.appendChild(img);
    pick.addEventListener("click", () => driftInsertEmoji(entry.code));
    grid.appendChild(pick);
    shown += 1;
  });
  if (!shown) {
    const note = document.createElement("div");
    note.className = "drift-pop-note";
    note.textContent = "No emoji found.";
    grid.appendChild(note);
  }
}

async function driftKlipy(path, params) {
  if (!KLIPY_API_KEY) throw new Error("Add your free Klipy key (KLIPY_API_KEY in script.js, free at partner.klipy.com) to enable GIFs.");
  const url = new URL("https://api.klipy.com/v2/" + path);
  url.searchParams.set("key", KLIPY_API_KEY);
  url.searchParams.set("client_key", "haze");
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.error || data.message)) || ("HTTP " + res.status));
  return data;
}

function driftGifUrl(item) {
  const formats = item && item.media_formats;
  const pick = formats && (formats.tinygif || formats.gif || formats.nanogif || formats.gifpreview);
  return pick && typeof pick.url === "string" ? pick.url : "";
}

let driftGifTrending = null;
async function driftLoadGifs(query) {
  const grid = $("#drift-gif-grid");
  grid.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "drift-pop-note";
  loading.textContent = "Loading GIFs…";
  grid.appendChild(loading);
  try {
    let items = [];
    if (query) {
      const data = await driftKlipy("search", { q: query, limit: "20", media_filter: "gif,tinygif" });
      items = (data && data.results) || [];
    } else if (driftGifTrending) {
      items = driftGifTrending;
    } else {
      const data = await driftKlipy("featured", { limit: "20", media_filter: "gif,tinygif" });
      items = (data && data.results) || [];
      driftGifTrending = items;
    }
    grid.replaceChildren();
    let shown = 0;
    items.forEach((item) => {
      const url = driftGifUrl(item);
      if (!url) return;
      const pick = document.createElement("button");
      pick.type = "button";
      pick.title = (item && item.title) || "GIF";
      pick.setAttribute("aria-label", (item && item.title) || "GIF");
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      pick.appendChild(img);
      pick.addEventListener("click", () => {
        driftClosePops();
        sendDriftMessage(url);
      });
      grid.appendChild(pick);
      shown += 1;
    });
    if (!shown) {
      const note = document.createElement("div");
      note.className = "drift-pop-note";
      note.textContent = query ? "No GIFs found." : "No trending GIFs right now.";
      grid.appendChild(note);
    }
  } catch (error) {
    grid.replaceChildren();
    const note = document.createElement("div");
    note.className = "drift-pop-note";
    note.textContent = String(error.message || "Could not load GIFs.");
    grid.appendChild(note);
  }
}

let driftGifSearchTimer = 0;
$("#drift-emoji-btn").addEventListener("click", () => {
  const pop = $("#drift-emoji-pop");
  const opening = pop.hidden;
  driftClosePops();
  driftHideSuggest();
  if (opening) {
    $("#drift-emoji-search").value = "";
    driftRenderEmojiGrid("");
    pop.hidden = false;
    $("#drift-emoji-btn").classList.add("active");
    $("#drift-emoji-search").focus();
  } else {
    $("#drift-message").focus();
  }
});
$("#drift-gif-btn").addEventListener("click", () => {
  const pop = $("#drift-gif-pop");
  const opening = pop.hidden;
  driftClosePops();
  driftHideSuggest();
  if (opening) {
    $("#drift-gif-search").value = "";
    driftLoadGifs("");
    pop.hidden = false;
    $("#drift-gif-btn").classList.add("active");
    $("#drift-gif-search").focus();
  } else {
    $("#drift-message").focus();
  }
});
$("#drift-emoji-search").addEventListener("input", (event) => driftRenderEmojiGrid(event.target.value));
$("#drift-emoji-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const first = $("#drift-emoji-grid button");
    if (first) first.click();
  } else if (event.key === "Escape") {
    driftClosePops();
    $("#drift-message").focus();
  }
});
$("#drift-gif-search").addEventListener("input", (event) => {
  clearTimeout(driftGifSearchTimer);
  driftGifSearchTimer = setTimeout(() => driftLoadGifs(event.target.value.trim()), 350);
});
$("#drift-gif-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    clearTimeout(driftGifSearchTimer);
    driftLoadGifs(event.target.value.trim());
  } else if (event.key === "Escape") {
    driftClosePops();
    $("#drift-message").focus();
  }
});

function driftGifHost(url) {
  try { return new URL(url).hostname || ""; } catch { return ""; }
}

function driftRenderContent(bubble, body) {
  const text = String(body || "");
  const single = text.trim();
  if (/^https?:\/\/\S+$/i.test(single) && DRIFT_IMG_HOST_RE.test(driftGifHost(single))) {
    const gif = document.createElement("img");
    gif.className = "drift-gif";
    gif.src = single;
    gif.alt = "GIF";
    gif.loading = "lazy";
    bubble.appendChild(gif);
    return;
  }
  const pattern = /:([a-z0-9_]{2,32}):/g;
  let last = 0;
  let match;
  let found = false;
  while ((match = pattern.exec(text))) {
    const src = DRIFT_EMOJI_MAP.get(match[1].toLowerCase());
    if (!src) continue;
    found = true;
    bubble.append(document.createTextNode(text.slice(last, match.index)));
    const img = document.createElement("img");
    img.className = "drift-emoji";
    img.src = src;
    img.alt = match[0];
    img.title = match[0];
    bubble.appendChild(img);
    last = match.index + match[0].length;
  }
  bubble.append(document.createTextNode(found ? text.slice(last) : text));
}

async function sendDriftMessage(body) {
  const session = driftSession();
  const friend = driftSelectedFriend;
  const text = String(body || "").trim().slice(0, 4000);
  if (!session || !friend || !text) return false;
  const box = $("#drift-message");
  box.disabled = true;
  try {
    const [userLow, userHigh] = [session.user.id, friend.id].sort();
    await supaRest("POST", "/rest/v1/drift_messages", {
      user_low: userLow, user_high: userHigh, sender_id: session.user.id, body: text,
    }, session.token, "return=minimal");
    await loadDriftMessages(true);
    return true;
  } catch (error) {
    driftSetStatus(String(error.message || "Message could not be sent."), true);
    return false;
  } finally { box.disabled = false; }
}
$("#drift-compose").addEventListener("submit", async (event) => {
  event.preventDefault();
  const box = $("#drift-message");
  driftHideSuggest();
  driftClosePops();
  if (await sendDriftMessage(box.value)) box.value = "";
});
$("#drift-message").addEventListener("input", driftUpdateSuggest);
$("#drift-message").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    driftHideSuggest();
    driftClosePops();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    const bar = $("#drift-suggest");
    if (!bar.hidden) {
      const first = bar.querySelector("button");
      if (first && first.dataset.code) {
        event.preventDefault();
        driftAcceptSuggest(first.dataset.code, true);
        return;
      }
    }
    event.preventDefault();
    $("#drift-compose").requestSubmit();
  }
});
$("#drift-close").addEventListener("click", () => closeDrift(true));
$("#drift-min").addEventListener("click", () => closeDrift(false));
$("#drift-max").addEventListener("click", () => driftWin.classList.toggle("max"));
makeDraggable(driftWin, $("#drift-titlebar"));

const CONSOLE_META = {
  nes: { label: "NES", hue: 4 },
  "3ds": { label: "Nintendo 3DS", hue: 212 },
  html5: { label: "HTML5", hue: 145 },
};

const GAMES = [
  { id: "subway", title: "Subway Surfers", console: "html5", rating: "4.9", blurb: "Run, jump, dodge trains and collect coins in this endless runner", play: "Games/Subway Surfers/index.html", cover: "https://img.poki-cdn.com/cdn-cgi/image/q=78,scq=50,width=314,height=314,fit=cover,f=auto/1c920b9279c2bedec567c1b58129ae8f/subway-surfers-logo.png", hint: "Arrow keys or WASD: Left/Right to switch lanes, Up/Space to jump, Down to slide", wasd: true },
  { id: "stickman-hook", title: "Stickman Hook", console: "html5", blurb: "Swing from hook to hook and race through each level.", play: "Games/Stickman-Hook/index.html", cover: "Games/Stickman-Hook/unnamed.jpg", hint: "Click or tap to hook and release to swing" },
];

let gamesSort = "home";
const GAME_HISTORY_KEY = "game_history_v1";

function loadGameHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(GAME_HISTORY_KEY) || "{}");
    return history && typeof history === "object" && !Array.isArray(history) ? history : {};
  } catch { return {}; }
}

function recordGamePlayed(id) {
  const history = loadGameHistory();
  history[id] = Date.now();
  try { localStorage.setItem(GAME_HISTORY_KEY, JSON.stringify(history)); } catch { /* private mode */ }
  requestGameDataSync();
}

const GAME_DATA_LOCAL_PREFIX = "haze.game-data.v1:";
const GAME_SAVE_KEY_RE = /^(?:STICKMANHOOK_|Stickman_Hook_)/i;
let gameDataActiveEmail = "";
let gameDataSyncTimer = null;
let gameDataSyncRunning = null;
let gameDataSyncQueued = false;
let gameDataSyncQueuedEmail = "";
let gameDataFingerprint = "";

function accountGameDataKey(email) {
  return GAME_DATA_LOCAL_PREFIX + encodeURIComponent(String(email || "").trim().toLowerCase());
}

function readAccountGameData(email) {
  try {
    return normalizeGameData(JSON.parse(localStorage.getItem(accountGameDataKey(email)) || "null"));
  } catch { return null; }
}

function saveAccountGameData(email, data) {
  if (!email || !data) return;
  try { localStorage.setItem(accountGameDataKey(email), JSON.stringify(data)); } catch { /* cloud sync can still save it */ }
}

function normalizeGameData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    version: 1,
    history: data.history && typeof data.history === "object" ? data.history : {},
    favorites: Array.isArray(data.favorites) ? data.favorites.filter((id) => typeof id === "string") : [],
    favoriteUpdates: data.favoriteUpdates && typeof data.favoriteUpdates === "object" ? data.favoriteUpdates : {},
    reviews: data.reviews && typeof data.reviews === "object" ? data.reviews : {},
    saves: data.saves && typeof data.saves === "object" ? data.saves : {},
    preferences: data.preferences && typeof data.preferences === "object" ? data.preferences : {},
  };
}

function captureGameData(email) {
  const previous = readAccountGameData(email);
  const saves = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !GAME_SAVE_KEY_RE.test(key)) continue;
      const value = localStorage.getItem(key);
      if (value == null || value.length > 300000) continue;
      const old = previous && previous.saves[key];
      saves[key] = { value, updatedAt: old && old.value === value ? Number(old.updatedAt) || 0 : Date.now() };
    }
  } catch { /* storage may be unavailable */ }
  const preferences = {
    volume: gameVol(),
    wasd: isEmuOn(),
  };
  const favorites = loadLikes();
  const favoriteUpdates = { ...((previous && previous.favoriteUpdates) || {}) };
  const knownFavorites = new Set([
    ...((previous && previous.favorites) || []),
    ...favorites,
    ...Object.keys(favoriteUpdates),
  ]);
  knownFavorites.forEach((id) => {
    const isLiked = favorites.includes(id);
    const old = favoriteUpdates[id];
    if (!old || old.liked !== isLiked) favoriteUpdates[id] = { liked: isLiked, updatedAt: Date.now() };
  });
  const previousPrefs = previous && previous.preferences;
  preferences.updatedAt = previousPrefs &&
    previousPrefs.volume === preferences.volume &&
    previousPrefs.wasd === preferences.wasd
    ? Number(previousPrefs.updatedAt) || 0
    : Date.now();
  return normalizeGameData({
    version: 1,
    history: loadGameHistory(),
    favorites,
    favoriteUpdates,
    reviews: loadRevStore(),
    saves,
    preferences,
  });
}

function mergeGameData(first, second) {
  const a = normalizeGameData(first) || normalizeGameData({});
  const b = normalizeGameData(second) || normalizeGameData({});
  const history = { ...a.history };
  Object.entries(b.history).forEach(([id, ts]) => {
    history[id] = Math.max(Number(history[id]) || 0, Number(ts) || 0);
  });
  const reviews = {};
  [a.reviews, b.reviews].forEach((store) => {
    Object.entries(store).forEach(([gameId, entries]) => {
      if (!Array.isArray(entries)) return;
      const byUser = new Map((reviews[gameId] || []).map((entry) => [entry.userKey || String(entry.ts), entry]));
      entries.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        const key = entry.userKey || String(entry.ts);
        const current = byUser.get(key);
        if (!current || (Number(entry.ts) || 0) > (Number(current.ts) || 0)) byUser.set(key, entry);
      });
      reviews[gameId] = [...byUser.values()];
    });
  });
  const saves = { ...a.saves };
  Object.entries(b.saves).forEach(([key, record]) => {
    const old = saves[key];
    if (!old || (Number(record && record.updatedAt) || 0) > (Number(old.updatedAt) || 0)) saves[key] = record;
  });
  const aPrefs = a.preferences || {}, bPrefs = b.preferences || {};
  const preferences = (Number(bPrefs.updatedAt) || 0) > (Number(aPrefs.updatedAt) || 0) ? bPrefs : aPrefs;
  const favoriteUpdates = { ...a.favoriteUpdates };
  Object.entries(b.favoriteUpdates).forEach(([id, update]) => {
    const old = favoriteUpdates[id];
    if (!old || (Number(update && update.updatedAt) || 0) > (Number(old.updatedAt) || 0)) favoriteUpdates[id] = update;
  });
  const favorites = Object.keys(favoriteUpdates).length
    ? Object.entries(favoriteUpdates).filter(([, update]) => update && update.liked).map(([id]) => id)
    : [...new Set([...a.favorites, ...b.favorites])];
  return normalizeGameData({
    version: 1,
    history,
    favorites,
    favoriteUpdates,
    reviews,
    saves,
    preferences,
  });
}

function setGameDataStatus(text, state = "") {
  const el = $("#game-data-status");
  if (!el) return;
  el.replaceChildren();
  el.className = "game-data-status" + (state ? " " + state : "");
  if (text.startsWith("Saved")) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "game-data-saved-link";
    link.textContent = "Saved";
    link.setAttribute("aria-label", "View saved game data");
    link.addEventListener("click", showSavedGameData);
    el.append(link, document.createTextNode(text.slice("Saved".length)));
  } else {
    el.textContent = text;
  }
}

let savedGameDataOpener = null;

function showSavedGameData() {
  const email = String((currentUser && currentUser.email) || "").trim().toLowerCase();
  const data = captureGameData(email);
  const favorites = new Set(data.favorites);
  const list = $("#game-data-list");
  list.replaceChildren();
  let storedGameCount = 0;
  let saveItemCount = 0;

  GAMES.forEach((game) => {
    const gameSaves = Object.entries(data.saves).filter(([key]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const normalizedId = game.id.toLowerCase().replace(/[^a-z0-9]/g, "");
      return normalizedKey.includes(normalizedId) ||
        (game.id === "stickman-hook" && normalizedKey.includes("stickmanhook"));
    });
    const playedAt = Number(data.history[game.id]) || 0;
    const reviewCount = Array.isArray(data.reviews[game.id]) ? data.reviews[game.id].length : 0;
    const tags = [];
    if (favorites.has(game.id)) tags.push("Favorite");
    if (playedAt) tags.push("Recently played " + new Date(playedAt).toLocaleDateString());
    if (reviewCount) tags.push(reviewCount + (reviewCount === 1 ? " review" : " reviews"));
    if (gameSaves.length) tags.push(gameSaves.length + (gameSaves.length === 1 ? " save item" : " save items"));
    if (tags.length) storedGameCount++;
    saveItemCount += gameSaves.length;

    const entry = document.createElement("article");
    entry.className = "game-data-entry";
    entry.dataset.hasData = tags.length ? "true" : "false";
    const head = document.createElement("div");
    head.className = "game-data-entry-head";
    const identity = document.createElement("div");
    identity.className = "game-data-entry-identity";
    const cover = document.createElement("img");
    cover.className = "game-data-entry-cover";
    cover.alt = "";
    cover.loading = "lazy";
    cover.decoding = "async";
    cover.src = game.id === "subway"
      ? "Games/Subway Surfers/b3f5e1472e1bfbee1804c7e854546a08.png"
      : game.cover || "";
    const mark = document.createElement("span");
    mark.className = "game-data-entry-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = game.title.trim().charAt(0).toUpperCase();
    cover.addEventListener("error", () => cover.replaceWith(mark), { once: true });
    const title = document.createElement("strong");
    title.textContent = game.title;
    identity.append(cover, title);
    const state = document.createElement("span");
    state.className = "game-data-entry-state";
    state.classList.toggle("has-save", gameSaves.length > 0);
    state.textContent = gameSaves.length
      ? gameSaves.length + (gameSaves.length === 1 ? " save file" : " save files")
      : tags.length ? "Activity saved" : "No data yet";
    head.append(identity, state);
    entry.appendChild(head);

    if (tags.length) {
      const tagRow = document.createElement("div");
      tagRow.className = "game-data-tags";
      tags.forEach((label) => {
        const tag = document.createElement("span");
        tag.className = "game-data-tag";
        tag.textContent = label;
        tagRow.appendChild(tag);
      });
      entry.appendChild(tagRow);
    }

    if (gameSaves.length) {
      const saves = document.createElement("div");
      saves.className = "game-data-saves";
      gameSaves.forEach(([key, record]) => {
        const details = document.createElement("details");
        details.className = "game-data-save";
        const summary = document.createElement("summary");
        summary.textContent = key;
        const value = document.createElement("pre");
        try { value.textContent = JSON.stringify(JSON.parse(record.value), null, 2); }
        catch { value.textContent = record.value; }
        details.append(summary, value);
        saves.appendChild(details);
      });
      entry.appendChild(saves);
    }
    list.appendChild(entry);
  });

  const preferences = data.preferences || {};
  const prefsSummary = "Game settings · Volume " + (Number(preferences.volume) || 0) +
    "% · WASD " + (preferences.wasd ? "on" : "off");
  $("#game-data-summary-count").textContent = storedGameCount
    ? storedGameCount + (storedGameCount === 1 ? " game with saved data" : " games with saved data")
    : "No saved game data yet";
  $("#game-data-dialog-summary").textContent = saveItemCount
    ? saveItemCount + (saveItemCount === 1 ? " save file" : " save files") + " · " + prefsSummary
    : "Favorites, play history, reviews, and " + prefsSummary.toLowerCase();
  $("#game-data-list-count").textContent = GAMES.length + (GAMES.length === 1 ? " game" : " games");
  if (!GAMES.length) {
    const empty = document.createElement("div");
    empty.className = "game-data-empty";
    empty.textContent = "No games are available yet.";
    list.appendChild(empty);
  }
  savedGameDataOpener = document.activeElement;
  const modal = $("#game-data-modal");
  setGameDataFilter("all");
  document.body.appendChild(modal);
  modal.hidden = false;
  $("#game-data-modal-close").focus();
}

function setGameDataFilter(filter) {
  const entries = $$("#game-data-list .game-data-entry");
  let shown = 0;
  entries.forEach((entry) => {
    const visible = filter !== "saved" || entry.dataset.hasData === "true";
    entry.hidden = !visible;
    if (visible) shown++;
  });
  $$("[data-game-data-filter]").forEach((button) => {
    const active = button.dataset.gameDataFilter === filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  $("#game-data-list-count").textContent = filter === "saved"
    ? shown + (shown === 1 ? " game with data" : " games with data")
    : GAMES.length + (GAMES.length === 1 ? " game" : " games");
  let empty = $("#game-data-filter-empty");
  if (filter === "saved" && shown === 0) {
    if (!empty) {
      empty = document.createElement("div");
      empty.id = "game-data-filter-empty";
      empty.className = "game-data-empty";
      empty.textContent = "No games have saved activity yet.";
      $("#game-data-list").appendChild(empty);
    }
  } else if (empty) {
    empty.remove();
  }
}

function closeSavedGameData() {
  $("#game-data-modal").hidden = true;
  if (savedGameDataOpener && typeof savedGameDataOpener.focus === "function") savedGameDataOpener.focus();
  savedGameDataOpener = null;
}

$("#game-data-modal-close").addEventListener("click", closeSavedGameData);
document.querySelector("[data-game-data-close]").addEventListener("click", closeSavedGameData);
$$("[data-game-data-filter]").forEach((button) => {
  button.addEventListener("click", () => setGameDataFilter(button.dataset.gameDataFilter));
});

function applyGameData(data) {
  const safe = normalizeGameData(data);
  if (!safe) return;
  try {
    localStorage.setItem(GAME_HISTORY_KEY, JSON.stringify(safe.history));
    localStorage.setItem(LIKE_KEY, JSON.stringify(safe.favorites));
    localStorage.setItem(REV_KEY, JSON.stringify(safe.reviews));
    if (safe.preferences.volume != null) localStorage.setItem(GAME_VOL_KEY, String(safe.preferences.volume));
    if (safe.preferences.wasd != null) localStorage.setItem(EMU_KEY, safe.preferences.wasd ? "1" : "0");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && GAME_SAVE_KEY_RE.test(key) && !Object.hasOwn(safe.saves, key)) localStorage.removeItem(key);
    }
    Object.entries(safe.saves).forEach(([key, record]) => {
      if (GAME_SAVE_KEY_RE.test(key) && typeof record.value === "string") localStorage.setItem(key, record.value);
    });
  } catch { /* local copy is best effort; remote copy remains intact */ }
  likeCache = [...safe.favorites];
  revCache = safe.reviews;
  syncEmuUI();
  syncGameVolUI();
  renderGames();
}

function activateGameDataAccount(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  gameDataActiveEmail = normalizedEmail;
  gameDataFingerprint = "";
  const saved = readAccountGameData(normalizedEmail);
  if (saved) {
    applyGameData(saved);
    saveAccountGameData(normalizedEmail, mergeGameData(saved, captureGameData(normalizedEmail)));
  } else {
    saveAccountGameData(normalizedEmail, captureGameData(normalizedEmail));
  }
  if (cloudOn()) {
    setGameDataStatus("Syncing this account's game data…", "pending");
    syncGameDataToAccount(normalizedEmail);
  } else {
    setGameDataStatus("Saved to this account on this device. Cloud sync needs account setup.", "pending");
  }
}

function requestGameDataSync() {
  const email = String((currentUser && currentUser.email) || "").trim().toLowerCase();
  if (!email) return;
  const snapshot = captureGameData(email);
  saveAccountGameData(email, snapshot);
  const fingerprint = JSON.stringify(snapshot);
  if (fingerprint === gameDataFingerprint) return;
  gameDataFingerprint = fingerprint;
  if (!cloudOn()) {
    setGameDataStatus("Saved to this account on this device. Cloud sync needs account setup.", "pending");
    return;
  }
  setGameDataStatus("Saving game data to your account…", "pending");
  clearTimeout(gameDataSyncTimer);
  gameDataSyncTimer = setTimeout(() => syncGameDataToAccount(email), 500);
}

async function syncGameDataToAccount(email) {
  if (gameDataSyncRunning) {
    gameDataSyncQueued = true;
    gameDataSyncQueuedEmail = email;
    return gameDataSyncRunning;
  }
  const session = readSupaSession();
  if (!cloudOn() || !session || !session.user || !session.user.id || !session.token) {
    setGameDataStatus("Saved to this account on this device. Cloud sync needs account setup.", "pending");
    return;
  }
  gameDataSyncRunning = (async () => {
    try {
      const userId = session.user.id;
      const rows = await supaRest(
        "GET",
        "/rest/v1/game_data?user_id=eq." + encodeURIComponent(userId) + "&select=data",
        undefined,
        session.token
      );
      const remote = Array.isArray(rows) && rows[0] ? rows[0].data : null;
      if (String((currentUser && currentUser.email) || "").trim().toLowerCase() !== email) return;
      const merged = mergeGameData(remote, captureGameData(email));
      applyGameData(merged);
      saveAccountGameData(email, merged);
      await supaRest("POST", "/rest/v1/game_data", {
        user_id: userId,
        data: merged,
        updated_at: new Date().toISOString(),
      }, session.token, "resolution=merge-duplicates,return=minimal");
      gameDataFingerprint = JSON.stringify(merged);
      if (String((currentUser && currentUser.email) || "").trim().toLowerCase() === email) {
        setGameDataStatus("Saved to your account automatically.", "synced");
        if (JSON.stringify(captureGameData(email)) !== gameDataFingerprint) requestGameDataSync();
      }
    } catch (err) {
      if (String((currentUser && currentUser.email) || "").trim().toLowerCase() === email) {
        setGameDataStatus("Saved on this device. Account sync will retry when available.", "error");
      }
      console.warn("Game data sync failed:", err);
    }
  })();
  try { await gameDataSyncRunning; }
  finally {
    gameDataSyncRunning = null;
    if (gameDataSyncQueued) {
      gameDataSyncQueued = false;
      const queuedEmail = gameDataSyncQueuedEmail || email;
      gameDataSyncQueuedEmail = "";
      setTimeout(() => syncGameDataToAccount(queuedEmail), 0);
    }
  }
}

function clearActiveGameData() {
  try {
    localStorage.removeItem(GAME_HISTORY_KEY);
    localStorage.removeItem(LIKE_KEY);
    localStorage.removeItem(REV_KEY);
    localStorage.removeItem(REV_LAST_KEY);
    localStorage.removeItem(GAME_VOL_KEY);
    localStorage.removeItem(EMU_KEY);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && GAME_SAVE_KEY_RE.test(key)) localStorage.removeItem(key);
    }
  } catch { /* noop */ }
  likeCache = null;
  revCache = null;
  gameDataActiveEmail = "";
  gameDataFingerprint = "";
}

window.addEventListener("online", () => {
  if (currentUser && cloudOn()) syncGameDataToAccount(String(currentUser.email || "").toLowerCase());
});
window.addEventListener("pagehide", () => {
  if (currentUser && currentUser.email) {
    saveAccountGameData(currentUser.email, captureGameData(currentUser.email));
  }
});

function gamesQuery() {
  return $("#games-search").value.trim().toLowerCase();
}

function matchesQuery(g, q) {
  return !q || g.title.toLowerCase().includes(q) || g.blurb.toLowerCase().includes(q) || CONSOLE_META[g.console].label.toLowerCase().includes(q);
}

function sortGames(list) {
  const out = [...list];
  if (gamesSort === "favorites") return out.filter((game) => isGameLiked(game.id));
  if (gamesSort === "home") return out;
  const history = loadGameHistory();
  return out
    .filter((game) => Number(history[game.id]) > 0)
    .sort((a, b) => Number(history[b.id]) - Number(history[a.id]));
}

/* ---------- Keyboard Emulation (WASD -> arrows, off by default) ---------- */
const EMU_KEY = "subway_wasd_emu";
const EMU_MAP = { KeyW: "ArrowUp", KeyA: "ArrowLeft", KeyS: "ArrowDown", KeyD: "ArrowRight" };
const EMU_CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };

function isEmuOn() {
  try { return localStorage.getItem(EMU_KEY) === "1"; } catch { return false; }
}

function setEmu(on) {
  try { localStorage.setItem(EMU_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  syncEmuUI();
  requestGameDataSync();
}

function syncEmuUI() {
  const on = isEmuOn();
  const d = $("#detail-emu-toggle");
  if (d) d.setAttribute("aria-pressed", on ? "true" : "false");
  const p = $("#game-emu");
  if (p) {
    p.setAttribute("aria-pressed", on ? "true" : "false");
    p.textContent = on ? "WASD: On" : "WASD: Off";
  }
}

function forwardKeyToGame(type, arrow, src) {
  const frame = $("#game-frame");
  if (!frame) return;
  let win = null, doc = null;
  try { win = frame.contentWindow; doc = frame.contentDocument; } catch { return; }
  if (!win || !doc) return;
  const init = {
    key: arrow, code: arrow, bubbles: true, cancelable: true, composed: true,
    shiftKey: !!(src && src.shiftKey), ctrlKey: !!(src && src.ctrlKey),
    altKey: !!(src && src.altKey), metaKey: !!(src && src.metaKey),
    repeat: !!(src && src.repeat),
  };
  const fire = (target) => {
    let ev;
    try { ev = new KeyboardEvent(type, init); } catch { return; }
    try {
      Object.defineProperty(ev, "keyCode", { value: EMU_CODES[arrow] || 0 });
      Object.defineProperty(ev, "which", { value: EMU_CODES[arrow] || 0 });
    } catch { /* some browsers lock these */ }
    try { target.dispatchEvent(ev); } catch { /* game gone */ }
  };
  try {
    const t = (doc.activeElement && doc.activeElement !== doc.body) ? doc.activeElement : (doc.body || doc.documentElement);
    if (t) fire(t);
  } catch { /* noop */ }
  try { fire(win); } catch { /* noop */ }
}

function handleEmuKey(type, e) {
  if (!isEmuOn()) return false;
  const game = GAMES.find((item) => item.id === playerGameId);
  if (!game || game.wasd !== true || $("#games-player").hidden) return false;
  const arrow = EMU_MAP[e.code];
  if (!arrow) return false;
  // Don't hijack typing in real text fields outside the game frame.
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    // Inside the game iframe there are no text fields that matter; only
    // skip when the event came from the outer page's own inputs.
    try {
      const frame = $("#game-frame");
      if (!frame || t !== frame.contentDocument?.activeElement) {
        if (t.ownerDocument === document) return false;
      }
    } catch { if (t.ownerDocument === document) return false; }
  }
  try { e.preventDefault(); e.stopPropagation(); } catch { /* noop */ }
  forwardKeyToGame(type, arrow, e);
  return true;
}

// Parent page: catches keys when the outer page has focus.
window.addEventListener("keydown", (e) => { handleEmuKey("keydown", e); }, true);
window.addEventListener("keyup", (e) => { handleEmuKey("keyup", e); }, true);

// Same-origin game frame: catches keys when the game itself has focus
// (events there never bubble up to the parent window).
function hookEmuIntoFrame() {
  const frame = $("#game-frame");
  if (!frame) return;
  try {
    const win = frame.contentWindow;
    if (!win || win.__emuHooked) return;
    win.__emuHooked = true;
    win.addEventListener("keydown", (e) => { handleEmuKey("keydown", e); }, true);
    win.addEventListener("keyup", (e) => { handleEmuKey("keyup", e); }, true);
  } catch { /* cross-origin: parent listener is all we get */ }
}

/* ---------- Game volume (sent into the game frame via postMessage) ---------- */
const GAME_VOL_KEY = "subway_game_vol";
let lastGameVol = 100;

function gameVol() {
  try {
    const v = Number(localStorage.getItem(GAME_VOL_KEY));
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 100;
  } catch { return 100; }
}

function postGameVol() {
  const frame = $("#game-frame");
  if (!frame || !frame.contentWindow) return;
  try { frame.contentWindow.postMessage({ type: "game-volume", value: gameVol() / 100 }, "*"); } catch { /* not ready */ }
}

function syncGameVolUI() {
  const v = gameVol();
  if (v > 0) lastGameVol = v;
  const s = $("#game-vol");
  if (s) s.value = String(v);
}

function setGameVol(v) {
  v = Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
  if (v > 0) lastGameVol = v;
  try { localStorage.setItem(GAME_VOL_KEY, String(v)); } catch { /* private mode */ }
  syncGameVolUI();
  postGameVol();
  requestGameDataSync();
}

/* ---------- Player reviews (localStorage, spam/bot filtered) ---------- */
const REV_KEY = "game_reviews_v1";
const REV_LAST_KEY = "game_reviews_last_ts";
const REV_BANNED = [
  "free money", "click here", "buy followers", "make money fast", "earn $$$",
  "crypto giveaway", "double your", "viagra", "casino bonus", "check my channel",
  "subscribe to", "discord.gg", "t.me/", "whatsapp",
];
let revStars = 5;
let revFormShownAt = 0;

let revCache = null;
function loadRevStore() {
  if (revCache) return revCache;
  try {
    const raw = localStorage.getItem(REV_KEY);
    const o = raw ? JSON.parse(raw) : {};
    revCache = o && typeof o === "object" ? o : {};
  } catch { revCache = {}; }
  return revCache;
}

function saveRevStore(o) {
  revCache = o && typeof o === "object" ? o : {};
  try { localStorage.setItem(REV_KEY, JSON.stringify(revCache)); } catch { /* quota */ }
  requestGameDataSync();
}

function getReviews(gameId) {
  const all = loadRevStore();
  const list = Array.isArray(all[gameId]) ? all[gameId] : [];
  return [...list].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function gameRatingValue(g) {
  const base = parseFloat(g.rating);
  const list = getReviews(g.id);
  if (!list.length) return Number.isFinite(base) ? base : 5;
  const avg = list.reduce((s, r) => s + (Number(r.stars) || 5), 0) / list.length;
  return Math.round(avg * 10) / 10;
}

function gameRatingText(g) {
  return gameRatingValue(g).toFixed(1);
}

function checkReviewSpam({ text, gameId, userKey }) {
  const t = String(text || "").trim();
  if (t.length < 4) return { ok: false, reason: "Please write a little more (4+ characters)." };
  if (t.length > 500) return { ok: false, reason: "Keep it under 500 characters." };
  if (/https?:\/\/|www\.|discord\.gg|t\.me\/|\b[a-z0-9-]+\.(com|net|xyz|ru|io|gg)\b/i.test(t))
    return { ok: false, reason: "Links aren't allowed in reviews." };
  if (/(.)\1{5,}/.test(t)) return { ok: false, reason: "That looks like spam (repeated characters)." };
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 12 && letters.replace(/[A-Z]/g, "").length / letters.length < 0.2)
    return { ok: false, reason: "That looks like spam (all caps)." };
  const low = t.toLowerCase();
  if (REV_BANNED.some((p) => low.includes(p)))
    return { ok: false, reason: "That looks like spam — please keep it about the game." };
  const all = loadRevStore();
  const mine = (all[gameId] || []).filter((r) => r.userKey === userKey);
  if (mine.some((r) => r.text.trim().toLowerCase() === t.toLowerCase()))
    return { ok: false, reason: "You've already posted that review." };
  let last = 0;
  try { last = Number(localStorage.getItem(REV_LAST_KEY) || 0); } catch { last = 0; }
  if (Date.now() - last < 30000)
    return { ok: false, reason: "Slow down — wait a bit before posting again (anti-spam)." };
  if (Date.now() - revFormShownAt < 1200 && t.length > 120)
    return { ok: false, reason: "That was posted suspiciously fast — please try again (anti-bot)." };
  return { ok: true };
}

function escRev(s) { return String(s ?? ""); }

function renderRevStars() {
  const wrap = $("#rev-stars");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rev-star" + (i <= revStars ? " lit" : "");
    b.textContent = "\u2605";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", i === revStars ? "true" : "false");
    b.setAttribute("aria-label", i + (i === 1 ? " star" : " stars"));
    b.dataset.stars = String(i);
    b.addEventListener("click", () => { revStars = i; renderRevStars(); });
    wrap.appendChild(b);
  }
}

function renderReviews() {
  const g = GAMES.find((x) => x.id === detailGameId);
  const listEl = $("#rev-list");
  if (!g || !listEl) return;
  const list = getReviews(g.id);
  const avg = gameRatingText(g);
  $("#rev-avg").textContent = avg;
  $("#detail-rating").textContent = avg;
  $("#rev-sub").textContent = list.length
    ? "based on " + list.length + (list.length === 1 ? " review" : " reviews") + " · updates live"
    : "no player reviews yet — be the first";
  $("#rev-count").textContent = list.length ? list.length + (list.length === 1 ? " review" : " reviews") : "";
  listEl.innerHTML = "";
  if (!list.length) {
    const d = document.createElement("div");
    d.className = "rev-empty";
    d.textContent = "No reviews yet. Play it, then tell everyone what you thought.";
    listEl.appendChild(d);
    return;
  }
  const me = currentUser ? (currentUser.email || currentUser.name || "") : "";
  list.forEach((r) => {
    const item = document.createElement("div");
    item.className = "rev-item";
    const top = document.createElement("div");
    top.className = "rev-item-top";
    const pic = document.createElement("img");
    pic.className = "rev-avatar";
    pic.alt = "";
    pic.loading = "lazy";
    pic.src = (r.userKey && userPic(r.userKey)) || AVATAR_DEFAULT;
    const who = document.createElement("strong");
    who.textContent = r.user;
    const stars = document.createElement("span");
    stars.className = "game-stars";
    stars.textContent = "\u2605".repeat(Math.max(1, Math.min(5, Number(r.stars) || 5)));
    const when = document.createElement("time");
    try { when.textContent = new Date(r.ts).toLocaleDateString(); } catch { when.textContent = ""; }
    top.append(pic, who, stars, when);
    const body = document.createElement("p");
    body.textContent = escRev(r.text);
    item.append(top, body);
    if (me && r.userKey && r.userKey === me) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "rev-del";
      del.textContent = "Delete";
      del.addEventListener("click", () => {
        const all = loadRevStore();
        all[g.id] = (all[g.id] || []).filter((x) => x.ts !== r.ts || x.userKey !== r.userKey);
        saveRevStore(all);
        renderReviews();
        renderGames();
      });
      item.appendChild(del);
    }
    listEl.appendChild(item);
  });
}

function submitReview(e) {
  if (e) e.preventDefault();
  const g = GAMES.find((x) => x.id === detailGameId);
  if (!g) return;
  const msg = $("#rev-msg");
  const ta = $("#rev-text");
  const text = ta.value.trim();
  const user = currentUser ? (currentUser.name || currentUser.email || "Player") : "Player";
  const userKey = currentUser ? (currentUser.email || currentUser.name || "guest") : "guest";
  const chk = checkReviewSpam({ text, gameId: g.id, userKey });
  if (!chk.ok) {
    msg.textContent = chk.reason;
    msg.className = "rev-msg err";
    return;
  }
  const all = loadRevStore();
  const arr = Array.isArray(all[g.id]) ? all[g.id] : [];
  const now = Date.now();
  const existing = arr.findIndex((r) => r.userKey === userKey);
  const rec = { user, userKey, stars: revStars, text, ts: now };
  if (existing >= 0) arr[existing] = rec;
  else arr.push(rec);
  all[g.id] = arr;
  saveRevStore(all);
  try { localStorage.setItem(REV_LAST_KEY, String(now)); } catch { /* noop */ }
  ta.value = "";
  updateRevCount();
  msg.textContent = existing >= 0 ? "Review updated — rating recalculated." : "Review posted — rating recalculated.";
  msg.className = "rev-msg ok";
  renderReviews();
  renderGames();
}

function buildGameCard(g) {
  const meta = CONSOLE_META[g.console];
  const card = document.createElement("article");
  card.className = "game-card";
  card.dataset.id = g.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", g.title + " — view details");
  const letter = (g.title.trim()[0] || "?").toUpperCase();
  const liked = isGameLiked(g.id);
  card.innerHTML =
    '<span class="game-cover">' +
    '<span class="cover-fallback" style="--hue:' + meta.hue + '"><b>' + letter + "</b><span>" + meta.label.toUpperCase() + "</span></span>" +
    (g.cover
      ? '<img src="' + g.cover + '" alt="" loading="lazy" decoding="async" onload="this.classList.remove(\'broken\')" onerror="this.classList.add(\'broken\')">'
      : "") +
    '<button type="button" class="game-play" aria-label="Play ' + g.title.replace(/"/g, "") + ' now"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg><span>Play</span></button>' +
    '<button type="button" class="game-like' + (liked ? " liked" : "") + '" aria-pressed="' + (liked ? "true" : "false") + '" aria-label="' + (liked ? "Remove from favorites: " : "Add to favorites: ") + g.title.replace(/"/g, "") + '">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg></button>' +
    "</span>" +
    '<span class="game-meta"><span class="game-name"></span>' +
    '<span class="game-description"></span>' +
    '<span class="game-sub"><span class="game-rating"><span class="game-stars">★</span><span class="game-rating-value"></span></span><span class="game-platform"></span></span></span>';
  card.querySelector(".game-name").textContent = g.title;
  card.querySelector(".game-description").textContent = g.blurb;
  card.querySelector(".game-rating-value").textContent = gameRatingText(g);
  card.querySelector(".game-platform").textContent = meta.label;
  return card;
}

/* Liked games (local-only, one tap on the card's heart) */
const LIKE_KEY = "game_likes_v1";
let likeCache = null;

function loadLikes() {
  if (likeCache) return likeCache;
  try {
    const raw = localStorage.getItem(LIKE_KEY);
    const a = raw ? JSON.parse(raw) : [];
    likeCache = Array.isArray(a) ? a : [];
  } catch { likeCache = []; }
  return likeCache;
}

function isGameLiked(id) {
  try { return loadLikes().includes(id); } catch { return false; }
}

function toggleGameLike(id) {
  const likes = loadLikes();
  const on = !likes.includes(id);
  likeCache = on ? [...likes, id] : likes.filter((x) => x !== id);
  try { localStorage.setItem(LIKE_KEY, JSON.stringify(likeCache)); } catch { /* private mode */ }
  requestGameDataSync();
  document.querySelectorAll('.game-card[data-id="' + id + '"] .game-like').forEach((b) => {
    b.classList.toggle("liked", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    const game = GAMES.find((item) => item.id === id);
    b.setAttribute("aria-label", (on ? "Remove from favorites: " : "Add to favorites: ") + (game ? game.title : "game"));
    if (on) {
      b.classList.remove("pop");
      void b.offsetWidth;
      b.classList.add("pop");
    }
  });
  if (gamesSort === "favorites") renderGames();
  return on;
}

function renderGames(animate = false) {
  const scroll = $("#games-scroll");
  const q = gamesQuery();
  const list = sortGames(GAMES.filter((g) => matchesQuery(g, q)));

  scroll.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "games-grid";
  list.forEach((g) => grid.appendChild(buildGameCard(g)));

  const shown = list.length;
  if (shown) {
    scroll.appendChild(grid);
  } else {
    const empty = document.createElement("div");
    empty.className = "games-empty";
    const title = document.createElement("strong");
    title.textContent = q
      ? "No games match your search"
      : gamesSort === "favorites" ? "No favorites yet"
      : gamesSort === "recent" ? "No recently played games yet"
      : "No games available";
    const hint = document.createElement("span");
    hint.textContent = q
      ? "Try another title or search term."
      : gamesSort === "favorites" ? "Like a game and it will show up here."
      : gamesSort === "recent" ? "Games you launch will show up here."
      : "Games will appear here when available.";
    empty.append(title, hint);
    scroll.appendChild(empty);
  }
  $("#games-scroll").hidden = false;
  $("#games-count").textContent = q
    ? shown + (shown === 1 ? " result" : " results") + ' for "' + $("#games-search").value.trim() + '"'
    : gamesSort === "favorites"
      ? shown + (shown === 1 ? " favorite" : " favorites")
      : shown + (shown === 1 ? " game" : " games");
  if (animate && motionAllowed()) {
    const content = scroll.firstElementChild;
    if (content && typeof content.animate === "function") {
      content.animate(
        [{ opacity: 0, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 190, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    }
  }
}

function ytCommand(func, args) {
  const f = $("#detail-trailer");
  if (!f || f.hidden || !f.contentWindow) return;
  f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: args || [] }), "https://www.youtube-nocookie.com");
}

let detailGameId = null;
let playerGameId = null;
let playLoadTimer = null;

function showGamesView(which) {
  $("#games-lib").hidden = which !== "lib";
  $("#games-detail").hidden = which !== "detail";
  $("#games-player").hidden = which !== "player";
}

function showDetail(id) {
  const g = GAMES.find((x) => x.id === id);
  if (!g) return;
  $("#emu-card").hidden = g.wasd !== true;
  detailGameId = id;
  const meta = CONSOLE_META[g.console];
  stopMedia();
  $("#detail-title").textContent = g.title;
  $("#detail-letter").textContent = (g.title.trim()[0] || "?").toUpperCase();
  $("#detail-console").textContent = meta.label.toUpperCase();
  $("#detail-fallback").style.setProperty("--hue", meta.hue);
  const cover = $("#detail-cover");
  if (g.cover) {
    cover.hidden = false;
    cover.removeAttribute("src");
    cover.onerror = () => { cover.hidden = true; };
    cover.src = g.cover;
  } else {
    cover.hidden = true;
  }
  $("#detail-bigplay").hidden = false;
  $("#detail-rating").textContent = gameRatingText(g);
  $("#detail-type").textContent = g.trailer ? "Official trailer" : "Playable in browser";
  $("#detail-blurb").textContent = g.blurb;
  $("#detail-hint").textContent = g.hint;
  revFormShownAt = Date.now();
  const rm = $("#rev-msg");
  if (rm) { rm.textContent = ""; rm.className = "rev-msg"; }
  const ta = $("#rev-text");
  if (ta) { ta.value = ""; updateRevCount(); }
  renderRevStars();
  renderReviews();
  syncEmuUI();
  showGamesView("detail");
}

function startTrailer() {
  const g = GAMES.find((x) => x.id === detailGameId);
  if (!g || !g.trailer) return;
  const f = $("#detail-trailer");
  f.hidden = false;
  if (!f.getAttribute("src")) f.src = g.play;
  $("#detail-bigplay").hidden = true;
}

function stopMedia() {
  $("#detail-trailer").removeAttribute("src");
  $("#detail-trailer").hidden = true;
}

function detailPlay() {
  const g = GAMES.find((x) => x.id === detailGameId);
  if (!g) return;
  if (g.trailer) startTrailer();
  else playGame(g.id);
}

function beginGameLoad(g) {
  const frame = $("#game-frame");
  $("#player-loading").classList.remove("done");
  $("#player-fallback").hidden = true;
  clearTimeout(playLoadTimer);
  playLoadTimer = setTimeout(() => {
    if (!$("#player-loading").classList.contains("done")) $("#player-fallback").hidden = false;
  }, 30000);
  frame.src = g.play;
}

function playGame(id) {
  const g = GAMES.find((x) => x.id === id);
  if (!g) return;
  $("#game-emu").hidden = g.wasd !== true;
  recordGamePlayed(id);
  playerGameId = id;
  $("#game-title").textContent = g.title;
  $("#game-external").href = g.play;
  showGamesView("player");
  beginGameLoad(g);
}

/* Reload the running game from scratch */
function refreshGame() {
  const g = GAMES.find((x) => x.id === playerGameId);
  if (!g) return;
  const frame = $("#game-frame");
  frame.src = "about:blank";
  setTimeout(() => {
    if (playerGameId === g.id) beginGameLoad(g);
  }, 60);
}

function stopGame() {
  clearTimeout(playLoadTimer);
  $("#player-fallback").hidden = true;
  const frame = $("#game-frame");
  frame.src = "about:blank";
  playerGameId = null;
  stopMedia();
  $("#detail-bigplay").hidden = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderGames();
  showGamesView("lib");
}

document.querySelectorAll(".games-sort-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (gamesSort === btn.dataset.sort) return;
    gamesSort = btn.dataset.sort;
    document.querySelectorAll(".games-sort-btn").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderGames(true);
  })
);

function updateRevCount() {
  const ta = $("#rev-text"), n = $("#rev-count-num");
  if (!ta || !n) return;
  n.textContent = ta.value.length + " / 500";
}

let gamesSearchT = null;
$("#games-search").addEventListener("input", () => {
  clearTimeout(gamesSearchT);
  gamesSearchT = setTimeout(renderGames, 120);
});
$("#games-scroll").addEventListener("click", (e) => {
  const like = e.target.closest(".game-like");
  if (like) {
    e.stopPropagation();
    const card = like.closest(".game-card");
    if (card) toggleGameLike(card.dataset.id);
    return;
  }
  const play = e.target.closest(".game-play");
  if (play) {
    e.stopPropagation();
    const card = play.closest(".game-card");
    if (card) playGame(card.dataset.id);
    return;
  }
  const card = e.target.closest(".game-card");
  if (card) showDetail(card.dataset.id);
});
$("#games-scroll").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (e.target.closest(".game-like") || e.target.closest(".game-play")) return;
  const card = e.target.closest(".game-card");
  if (card) { e.preventDefault(); showDetail(card.dataset.id); }
});
$("#rev-text").addEventListener("input", updateRevCount);
$("#detail-back").addEventListener("click", () => showGamesView("lib"));
$("#detail-bigplay").addEventListener("click", detailPlay);
$("#game-back").addEventListener("click", () => stopGame());
$("#game-frame").addEventListener("load", () => {
  const src = $("#game-frame").getAttribute("src");
  if (!src || src === "about:blank") return; // the reset page, not the game
  $("#player-loading").classList.add("done");
  $("#player-fallback").hidden = true;
  clearTimeout(playLoadTimer);
  hookEmuIntoFrame();
  syncEmuUI();
  syncGameVolUI();
  postGameVol();
  setTimeout(postGameVol, 2000);
  // keyboard controls work right away, without clicking the game first
  try { $("#game-frame").focus(); $("#game-frame").contentWindow.focus(); } catch { /* cross-origin */ }
});
$("#game-fallback-back").addEventListener("click", () => stopGame());
$("#game-refresh").addEventListener("click", refreshGame);
$("#game-home").addEventListener("click", () => stopGame());
$("#detail-emu-toggle").addEventListener("click", () => setEmu(!isEmuOn()));
$("#game-emu").addEventListener("click", () => setEmu(!isEmuOn()));
$("#game-vol").addEventListener("change", (e) => setGameVol(e.target.value));
$("#rev-form").addEventListener("submit", submitReview);
syncEmuUI();
syncGameVolUI();
renderGames();
setInterval(() => {
  if (currentUser && playerGameId) requestGameDataSync();
}, 20000);

$("#gm-close").addEventListener("click", () => closeGames(true));
$("#gm-min").addEventListener("click", () => {
  stopGame();
  gamesWin.hidden = true;
});
$("#gm-max").addEventListener("click", () => gamesWin.classList.toggle("max"));
makeDraggable(gamesWin, $("#games-titlebar"));

function normalizeBrowsyUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return "";
  // A search box should accept phrases and single words as searches. Keep
  // localhost, IP literals, and dotted hostnames as direct navigation.
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(url);
  const isIpAddress = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(url) || /^\[[0-9a-f:]+\](?::\d+)?(?:[/?#]|$)/i.test(url);
  const hasDomain = /^(?:[^/?#]+\.)+[^/?#]+(?::\d+)?(?:[/?#]|$)/i.test(url);
  if (!hasScheme && !isLoopback && !isIpAddress && !hasDomain) {
    return (SEARCH_ENGINES[prefs.proxy.searchEngine] || SEARCH_ENGINES.duckduckgo)(url);
  }
  // "localhost:3000" looks like scheme "localhost:" to the regex — treat
  // loopback host:port as schemeless instead.
  if (!hasScheme || isLoopback) return "https://" + url;
  return url;
}

async function browsyGo(raw) {
  const url = normalizeBrowsyUrl(raw);
  if (!url) return;
  hideBrError();
  clearTimeout(brNavigationTimer);
  if (proxyMode() === "epoxy") {
    brUrl.value = url;
    brStart.hidden = true;
    brFrame.hidden = false;
    brFrame.removeAttribute("src");
    toast("Loading via Epoxy…");
    try {
      brFrame.src = await uvUrl(url);
      brNavigationTimer = setTimeout(() => {
        showBrError(url, new Error("The site did not finish loading within 30 seconds. The site or Wisp relay may be slow; retry, or choose another Wisp server in Settings."));
      }, 30000);
    } catch (err) {
      showBrError(url, err);
    }
    return;
  }
  brUrl.value = url;
  brStart.hidden = true;
  brFrame.hidden = false;
  brFrame.src = url;
  brNavigationTimer = setTimeout(() => showBrError(url, new Error("The site did not finish loading within 30 seconds.")), 30000);
}

function browsyHome() {
  clearTimeout(brNavigationTimer);
  brFrame.removeAttribute("src");
  brFrame.hidden = true;
  brStart.hidden = false;
  brUrl.value = "";
  brUrl.focus();
}

brUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") browsyGo(brUrl.value);
});
brFrame.addEventListener("load", () => {
  clearTimeout(brNavigationTimer);
  try {
    const frameWindow = brFrame.contentWindow;
    const frameDocument = brFrame.contentDocument;
    const href = frameWindow.location.href;
    if (!href || href === "about:blank") return;
    // Epoxy pages are same-origin proxy URLs — show the real address.
    brUrl.value = uvDecode(href);
    if (frameDocument && !frameDocument.__browsyNavigationBound) {
      frameDocument.__browsyNavigationBound = true;
      frameDocument.addEventListener("click", (event) => {
        const link = event.target instanceof frameWindow.Element ? event.target.closest("a[href]") : null;
        if (!link || link.target !== "_blank") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        frameWindow.location.href = browsyFrameTarget(link.href, frameWindow);
      }, true);
      frameWindow.open = (url) => {
        if (url && url !== "about:blank") frameWindow.location.href = browsyFrameTarget(url, frameWindow);
        return null;
      };
      const ua = PROXY_UA_PROFILES[prefs.proxy.userAgent];
      if (ua) Object.defineProperty(frameWindow.navigator, "userAgent", { configurable: true, get: () => ua });
    }
  } catch {
    /* cross-origin page, keep the typed URL */
  }
});

function browsyFrameTarget(raw, frameWindow) {
  const target = new URL(String(raw), frameWindow.location.href);
  if (proxyMode() === "epoxy" && /^https?:$/.test(target.protocol)) {
    if (target.origin === location.origin && target.pathname.startsWith(UV_PREFIX)) return target.href;
    return location.origin + UV_PREFIX + self.__uv$config.encodeUrl(target.href);
  }
  return target.href;
}
$("#br-error-retry").addEventListener("click", () => {
  const raw = brUrl.value || "";
  hideBrError();
  if (raw) browsyGo(raw);
});
$("#br-error-direct").addEventListener("click", () => {
  const raw = brUrl.value || "";
  hideBrError();
  clearTimeout(brNavigationTimer);
  if (proxyMode() === "epoxy") {
    prefs.proxy.mode = "local";
    savePrefs();
    syncProxyUI();
  }
  if (raw) browsyGo(raw);
});
$("#br-back").addEventListener("click", () => {
  try { brFrame.contentWindow.history.back(); } catch { /* nothing to go back to */ }
});
$("#br-fwd").addEventListener("click", () => {
  try { brFrame.contentWindow.history.forward(); } catch { /* nothing ahead */ }
});
$("#br-reload").addEventListener("click", () => {
  if (brFrame.hidden) return;
  try { brFrame.contentWindow.location.reload(); }
  catch { brFrame.src = brFrame.src; }
});
$("#br-home").addEventListener("click", browsyHome);
document.querySelectorAll(".proxy-mode").forEach((b) =>
  b.addEventListener("click", () => setProxyMode(b.dataset.mode))
);
$("#proxy-search-engine").addEventListener("change", (e) => {
  prefs.proxy.searchEngine = ["duckduckgo", "google", "brave"].includes(e.target.value) ? e.target.value : "duckduckgo";
  savePrefs();
});
$("#proxy-user-agent").addEventListener("change", (e) => {
  prefs.proxy.userAgent = ["default", "iphone", "ipad", "android", "ps5"].includes(e.target.value) ? e.target.value : "default";
  savePrefs();
  syncProxyUI();
  const current = !browsyWin.hidden && !brFrame.hidden ? browsyRealUrl() : "";
  if (current && proxyMode() === "epoxy") browsyGo(current);
});
$("#proxy-wisp").addEventListener("change", (e) => {
  let v = String(e.target.value || "").trim();
  if (v && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) v = "wss://" + v;
  prefs.proxy.wisp = /^wss?:\/\//.test(v) ? v : WISP_DEFAULT;
  savePrefs();
  syncProxyUI();
});
$("#proxy-test").addEventListener("click", async () => {
  const st = $("#proxy-status");
  const btn = $("#proxy-test");
  btn.disabled = true;
  const say = (m) => { if (st) st.textContent = m; };
  say("Testing Epoxy… (loading transport, reaching Wisp)");
  try {
    await ensureProxyStack(say);
    say("Loading example.com through Epoxy…");
    const target = location.origin + self.__uv$config.prefix + self.__uv$config.encodeUrl("https://example.com/");
    console.log("[Epoxy Test] Target:", target);
    const res = await withTimeout(fetch(target, { method: "GET", redirect: "follow" }), 45000, "Test page load");
    console.log("[Epoxy Test] Response:", res.status, res.statusText, res.url);
    if (res.status === 404 && res.url.startsWith(location.origin + "/proxy/service/")) {
      throw new Error("Request wasn't intercepted (local server answered 404) — reload the page once, then test again.");
    }
    const text = await res.text();
    console.log("[Epoxy Test] Body length:", text.length, "preview:", text.slice(0, 300));
    if (!res.ok) {
      throw new Error("example.com answered " + res.status + " — " + text.slice(0, 500));
    }
    say("Epoxy is working — example.com loaded (" + text.length + " bytes) via " + uvWisp);
    toast("Epoxy test passed");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err || "Unknown error");
    console.error("[Epoxy Test] Error:", err);
    say("Epoxy test failed: " + msg);
    toast("Epoxy test failed");
  } finally {
    btn.disabled = false;
  }
});
$("#br-external").addEventListener("click", () => {
  const url = normalizeBrowsyUrl(brUrl.value);
  if (!url) return;
  window.open(url, "_blank", "noopener");
});
document.querySelectorAll(".quick-tiles .tile").forEach((t) =>
  t.addEventListener("click", () => browsyGo(t.dataset.url))
);
$("#br-close").addEventListener("click", () => closeBrowsy(true));
$("#br-min").addEventListener("click", () => (browsyWin.hidden = true));
$("#br-max").addEventListener("click", () => browsyWin.classList.toggle("max"));

makeDraggable(browsyWin, $("#browsy-titlebar"));

/* ---------- Spotlight ---------- */
const SPOT_ALIASES = { browser: "Browsy", web: "Browsy", logout: "Log out", signout: "Log out", power: "Log out" };
let spotSel = 0;

function spotApps() {
  return [...dock.querySelectorAll(".app")].map((btn) => ({
    name: btn.dataset.app,
    btn,
  }));
}

function openSpotlight() {
  if (desktop.hidden || !spot.hidden) return;
  spot.hidden = false;
  spot.classList.remove("show");
  void spot.offsetWidth;
  if (motionAllowed()) spot.classList.add("show");
  spotInput.value = "";
  renderSpot("");
  spotInput.focus();
  placeSpotCaret(true);
}

function closeSpotlight() {
  if (spot.hidden) return;
  spot.hidden = true;
  spotInput.blur();
}

function toggleSpotlight() {
  if (spot.hidden) openSpotlight();
  else closeSpotlight();
}

function renderSpot(query) {
  const q = query.trim().toLowerCase();
  spotResults.innerHTML = "";
  spotSel = 0;
  if (!q) return;
  const apps = spotApps().filter(({ name }) => {
    if (name.toLowerCase().includes(q)) return true;
    const alias = SPOT_ALIASES[q];
    return alias ? name === alias : false;
  });
  if (!apps.length) {
    const empty = document.createElement("div");
    empty.className = "spot-empty";
    empty.textContent = `No results for "${query.trim()}"`;
    spotResults.appendChild(empty);
    return;
  }
  apps.forEach(({ name, btn }, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "spot-row" + (i === 0 ? " sel" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === 0));
    row.dataset.app = name;

    const label = document.createElement("span");
    label.textContent = name;

    const hint = document.createElement("span");
    hint.className = "spot-hint";
    hint.textContent = name === "Log out" ? "Action" : "Application";

    row.append(label, hint);
    row.addEventListener("click", () => {
      closeSpotlight();
      btn.click();
    });
    row.addEventListener("mousemove", () => spotHighlight(i));
    spotResults.appendChild(row);
  });
}

function spotHighlight(i) {
  const rows = [...spotResults.querySelectorAll(".spot-row")];
  if (!rows.length) return;
  const next = (i + rows.length) % rows.length;
  if (next === spotSel && rows[next].classList.contains("sel")) return;
  spotSel = next;
  rows.forEach((row, j) => {
    row.classList.toggle("sel", j === spotSel);
    row.setAttribute("aria-selected", String(j === spotSel));
  });
  rows[spotSel].scrollIntoView({ block: "nearest" });
}

function spotLaunchSel() {
  const rows = [...spotResults.querySelectorAll(".spot-row")];
  const row = rows[spotSel];
  if (!row) return;
  const btn = dock.querySelector(`[data-app="${row.dataset.app}"]`);
  closeSpotlight();
  if (btn) btn.click();
}

spotInput.addEventListener("input", () => { renderSpot(spotInput.value); placeSpotCaret(true); });
["keyup", "click", "select", "focus", "blur", "scroll"].forEach((evt) =>
  spotInput.addEventListener(evt, () => placeSpotCaret(evt !== "scroll"))
);
window.addEventListener("resize", () => placeSpotCaret(false));

spotInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    spotHighlight(spotSel + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    spotHighlight(spotSel - 1);
  } else if (e.key === "Enter") {
    spotLaunchSel();
  }
});
spot.addEventListener("pointerdown", (e) => {
  if (e.target === spot) closeSpotlight();
});
$("#spot-btn").addEventListener("click", toggleSpotlight);
$("#spot-paste").addEventListener("click", async () => {
  spotInput.focus();
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      spotInput.value = text;
      renderSpot(text);
      placeSpotCaret(true);
    } else {
      toast("Clipboard is empty");
    }
  } catch {
    toast("Clipboard blocked — press Ctrl+V instead");
  }
});
$("#spot-settings").addEventListener("click", () => {
  closeSpotlight();
  openSettings();
});
$("#spot-power").addEventListener("click", () => {
  closeSpotlight();
  clearSession();
  showAuth();
});
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
function isTypingTarget(el) {
  return !!el && (TYPING_TAGS.has(el.tagName) || el.isContentEditable);
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") {
    e.preventDefault();
    toggleSpotlight();
  } else if (
    e.key === "Tab" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !isTypingTarget(e.target) &&
    !desktop.hidden
  ) {
    e.preventDefault();
    toggleSpotlight();
  }
});

/* ---------- Indexy project runner ---------- */
const ixFrame = $("#ix-frame");
const ixEmpty = $("#ix-empty");
const ixList = $("#ix-list");
const ixCount = $("#ix-count");
const ixStatus = $("#ix-status");
const ixFileInput = $("#ix-file-input");
const ixFolderInput = $("#ix-folder-input");
const ixBackBtn = $("#ix-back");
const ixEditor = $("#ix-editor");
const ixEditName = $("#ix-edit-name");
const ixDirty = $("#ix-dirty");
const ixGutter = $("#ix-gutter");
const ixTextarea = $("#ix-textarea");
const ixImgview = $("#ix-imgview");
const ixImg = $("#ix-img");
const ixFiles = new Map();

let ixHist = [];
let ixHistIdx = -1;
let ixActiveKey = null;
let ixEditingKey = null;
let ixLastBuild = null;

const IX_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
const IX_MAX_BYTES = 5 * 1024 * 1024;

function openIndexy() {
  // Already open -> clicking the dock icon minimizes it, like other apps
  if (!indexyWin.hidden) {
    closeIndexy(false);
    return;
  }
  indexyWin.hidden = false;
  indexyWin.classList.remove("open");
  void indexyWin.offsetWidth;
  indexyWin.classList.add("open");
  indexyBtn.classList.add("running");
  focusWindow(indexyWin);
}

function closeIndexy(quit = true) {
  indexyWin.hidden = true;
  if (quit) indexyBtn.classList.remove("running");
}

function ixExt(name) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function ixFmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function ixKeyFor(file) {
  return (file.webkitRelativePath || file.name).toLowerCase();
}

function ixFindEntry(ref) {
  const clean = ref.split(/[?#]/)[0].trim().replace(/^\.\/|^\//, "");
  if (!clean || /^(https?:|data:|blob:)/i.test(clean)) return null;
  const lower = clean.toLowerCase();
  if (ixFiles.has(lower)) return ixFiles.get(lower);
  const base = lower.split("/").pop();
  for (const entry of ixFiles.values()) {
    if (entry.base === base) return entry;
  }
  return null;
}

function ixFindHtml() {
  for (const entry of ixFiles.values()) {
    if (entry.base === "index.html") return entry;
  }
  for (const entry of ixFiles.values()) {
    if (entry.ext === "html" || entry.ext === "htm") return entry;
  }
  return null;
}

function ixRenderList() {
  ixList.innerHTML = "";
  const entries = [...ixFiles.values()];
  ixCount.textContent = entries.length;
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "ix-list-empty";
    li.textContent = "No files yet — open some to begin.";
    ixList.appendChild(li);
    return;
  }
  const htmlEntry = ixFindHtml();
  for (const entry of entries) {
    const li = document.createElement("li");
    if (entry === htmlEntry) li.classList.add("entry-html");
    if (entry.key === ixActiveKey) li.classList.add("active");
    if (entry.text !== entry.orig) li.classList.add("edited");
    li.title = entry.name;
    li.addEventListener("click", () => ixOpenFile(entry.key));

    const badge = document.createElement("span");
    badge.className = "ix-ext";
    badge.textContent = entry.ext || "file";

    const name = document.createElement("span");
    name.className = "ix-name";
    name.textContent = entry.name;

    const size = document.createElement("span");
    size.className = "ix-size";
    size.textContent = ixFmtSize(entry.size);

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "ix-remove";
    rm.setAttribute("aria-label", "Remove " + entry.name);
    rm.textContent = "×";
    rm.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ixRemoveFile(entry.key);
    });

    li.append(badge, name, size, rm);
    ixList.appendChild(li);
  }
}

function ixShowMain(which) {
  ixEmpty.hidden = which !== "empty";
  ixFrame.hidden = which !== "preview";
  ixEditor.hidden = which !== "editor";
  ixImgview.hidden = which !== "image";
}

function ixShowEmpty(status) {
  ixFrame.removeAttribute("srcdoc");
  ixEditingKey = null;
  ixActiveKey = null;
  ixShowMain("empty");
  if (status) ixStatus.textContent = status;
  ixRenderList();
}

/* Clicking a sidebar file opens it: pages preview, images view, code edits */
function ixOpenFile(key) {
  const entry = ixFiles.get(key);
  if (!entry) return;
  if (entry.ext === "html" || entry.ext === "htm") {
    ixNavigate({ kind: "preview", key });
  } else if (entry.dataUrl) {
    ixNavigate({ kind: "image", key });
  } else {
    ixNavigate({ kind: "edit", key });
  }
}

function ixNavigate(view) {
  const last = ixHist[ixHistIdx];
  if (!last || last.kind !== view.kind || last.key !== view.key) {
    ixHist = ixHist.slice(0, ixHistIdx + 1);
    ixHist.push(view);
    ixHistIdx = ixHist.length - 1;
  }
  ixShowView(view);
}

function ixBack() {
  if (ixHistIdx <= 0) return;
  ixHistIdx -= 1;
  ixShowView(ixHist[ixHistIdx]);
}

function ixSyncBack() {
  ixBackBtn.disabled = ixHistIdx <= 0;
}

function ixShowView(view) {
  ixActiveKey = view.key || null;
  if (view.kind === "preview") {
    const entry = ixFiles.get(view.key);
    if (entry) {
      ixEditingKey = null;
      ixBuild(entry);
    } else {
      ixShowEmpty("No project loaded");
    }
  } else if (view.kind === "edit") {
    const entry = ixFiles.get(view.key);
    if (entry) ixOpenEditor(entry);
    else ixShowEmpty("No project loaded");
  } else if (view.kind === "image") {
    const entry = ixFiles.get(view.key);
    if (entry && entry.dataUrl) {
      ixEditingKey = null;
      ixImg.src = entry.dataUrl;
      ixShowMain("image");
      ixStatus.textContent = entry.name;
    } else {
      ixShowEmpty("No project loaded");
    }
  } else {
    ixEditingKey = null;
    ixShowEmpty(ixFiles.size ? "Pick a file to view" : "No project loaded");
  }
  ixRenderList();
  ixSyncBack();
}

function ixOpenEditor(entry) {
  ixEditingKey = entry.key;
  ixEditName.textContent = entry.name;
  if (ixTextarea.value !== entry.text) ixTextarea.value = entry.text;
  ixSyncEditor(entry);
  ixShowMain("editor");
  ixStatus.textContent = entry.name;
}

function ixSyncEditor(entry) {
  entry = entry || ixFiles.get(ixEditingKey);
  if (!entry) return;
  ixDirty.hidden = entry.text === entry.orig;
  const lines = ixTextarea.value.split("\n").length;
  let nums = "";
  for (let i = 1; i <= lines; i++) nums += i + "\n";
  ixGutter.textContent = nums;
  ixGutter.scrollTop = ixTextarea.scrollTop;
}

function ixRemoveFile(key) {
  const wasActive = key === ixActiveKey;
  ixFiles.delete(key);
  ixHist = ixHist.filter((v) => v.key !== key);
  if (ixEditingKey === key) ixEditingKey = null;
  if (ixHistIdx >= ixHist.length) ixHistIdx = ixHist.length - 1;
  if (!ixFiles.size) {
    ixHist = [];
    ixHistIdx = -1;
    ixShowEmpty("No project loaded");
  } else if (wasActive) {
    if (ixHistIdx >= 0) ixShowView(ixHist[ixHistIdx]);
    else ixShowEmpty("No project loaded");
  } else {
    ixRenderList();
  }
  ixSyncBack();
}

function ixDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function ixSave() {
  const editing = ixEditingKey && ixFiles.get(ixEditingKey);
  if (editing) {
    const fname = editing.name.split("/").pop();
    ixDownload(fname, editing.text, "text/plain");
    editing.orig = editing.text;
    ixSyncEditor(editing);
    ixRenderList();
    toast("Saved " + fname);
    return;
  }
  if (ixLastBuild && !ixFrame.hidden) {
    ixDownload(ixLastBuild.name, ixLastBuild.html, "text/html");
    toast("Saved " + ixLastBuild.name);
    return;
  }
  toast("Nothing to save yet");
}

const IX_ROUTER = `<script>
document.addEventListener("click", function (e) {
  var a = e.target && e.target.closest ? e.target.closest("a[data-ix-page]") : null;
  if (!a) return;
  e.preventDefault();
  parent.postMessage({ type: "ix-navigate", page: a.getAttribute("data-ix-page") }, "*");
});
<\/script>`;

function ixRun() {
  const htmlEntry = ixFindHtml();
  if (!htmlEntry) {
    toast("Pick an index.html to run");
    ixStatus.textContent = "Waiting for index.html…";
    return;
  }
  ixBuild(htmlEntry);
}

function ixBuild(htmlEntry) {
  let html = htmlEntry.text;

  // Inline local stylesheets: <link href="style.css"> -> <style>…</style>
  html = html.replace(/<link\b[^>]*href=(["'])([^"']+)\1[^>]*>/gi, (tag, _q, href) => {
    if (!/\.css([?#]|$)/i.test(href)) return tag;
    const entry = ixFindEntry(href);
    if (!entry) return tag;
    return "<style>\n" + entry.text + "\n</style>";
  });

  // Inline local scripts: <script src="script.js"></script> -> <script>…</script>
  html = html.replace(
    /<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>\s*<\/script\s*>/gi,
    (tag, _q, src) => {
      const entry = ixFindEntry(src);
      if (!entry) return tag;
      return "<script>\n" + entry.text.replace(/<\/script/gi, "<\\/script") + "\n</script>";
    }
  );

  // Inline local images as data URLs so the preview is self-contained
  html = html.replace(/(\bsrc\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, src, post) => {
    const entry = ixFindEntry(src);
    if (!entry || !entry.dataUrl) return m;
    return pre + entry.dataUrl + post;
  });

  // Route local page links back to the parent so multi-page folders work:
  // <a href="about.html"> becomes a postMessage the parent answers by
  // rebuilding the preview from the matching loaded file
  html = html.replace(/<a\b([^>]*?)\bhref=(["'])([^"']+)\2([^>]*)>/gi, (tag, pre, _q, href, post) => {
    if (/^(https?:|data:|blob:|mailto:|tel:|#)/i.test(href)) return tag;
    if (/target\s*=\s*["']?_blank["']?/i.test(tag)) return tag;
    if (!/\.html?([?#]|$)/i.test(href.split(/[?#]/)[0])) return tag;
    const entry = ixFindEntry(href);
    if (!entry || entry === htmlEntry) return tag;
    return `<a${pre}href="${href}" data-ix-page="${entry.key}"${post}>`;
  });

  if (/<\/body\s*>/i.test(html)) html = html.replace(/<\/body\s*>/i, IX_ROUTER + "</body>");
  else html += IX_ROUTER;

  ixFrame.srcdoc = html;
  ixLastBuild = { name: htmlEntry.name, html };
  ixEditingKey = null;
  ixShowMain("preview");
  const assets = ixFiles.size - 1;
  ixStatus.textContent =
    htmlEntry.name + (assets > 0 ? ` + ${assets} asset${assets === 1 ? "" : "s"}` : " (solo)");
}

window.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "ix-navigate") return;
  if (e.source !== ixFrame.contentWindow) return;
  const entry = ixFiles.get(String(e.data.page).toLowerCase());
  if (entry) ixNavigate({ kind: "preview", key: entry.key });
});

function ixReadFile(file) {
  return new Promise((resolve) => {
    if (file.size > IX_MAX_BYTES) {
      resolve({ skipped: true, reason: "over 5 MB" });
      return;
    }
    const ext = ixExt(file.name);
    if (IX_IMAGE_EXTS.has(ext) && ext !== "svg") {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: String(reader.result || "") });
      reader.onerror = () => resolve({ skipped: true, reason: "unreadable" });
      reader.readAsDataURL(file);
      return;
    }
    file
      .text()
      .then((text) => resolve({ text }))
      .catch(() => resolve({ skipped: true, reason: "unreadable" }));
  });
}

async function ixAddFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const out = await ixReadFile(file);
    if (out.skipped || (out.text === undefined && !out.dataUrl)) {
      skipped++;
      continue;
    }
    const name = file.webkitRelativePath || file.name;
    ixFiles.set(ixKeyFor(file), {
      key: ixKeyFor(file),
      name,
      base: name.toLowerCase().split("/").pop(),
      ext: ixExt(file.name),
      size: file.size,
      text: out.text || "",
      orig: out.text || "",
      dataUrl: out.dataUrl || "",
    });
    added++;
  }
  ixRenderList();
  const home = ixFindHtml();
  if (home) {
    ixNavigate({ kind: "preview", key: home.key });
  } else if (added) {
    ixStatus.textContent = `${added} file${added === 1 ? "" : "s"} loaded — add an index.html to run`;
  }
  if (skipped) toast(`${skipped} file${skipped === 1 ? "" : "s"} skipped`);
}

function ixClear() {
  ixFiles.clear();
  ixHist = [];
  ixHistIdx = -1;
  ixEditingKey = null;
  ixLastBuild = null;
  ixTextarea.value = "";
  ixFileInput.value = "";
  ixFolderInput.value = "";
  ixShowEmpty("No project loaded");
  ixSyncBack();
}

$("#ix-open-files").addEventListener("click", () => ixFileInput.click());
$("#ix-empty-open").addEventListener("click", () => ixFileInput.click());
$("#ix-open-folder").addEventListener("click", () => ixFolderInput.click());
$("#ix-run").addEventListener("click", () => {
  const home = ixFindHtml();
  if (home) ixNavigate({ kind: "preview", key: home.key });
  else ixRun();
});
ixBackBtn.addEventListener("click", ixBack);

ixTextarea.addEventListener("input", () => {
  const entry = ixFiles.get(ixEditingKey);
  if (!entry) return;
  entry.text = ixTextarea.value;
  ixSyncEditor(entry);
  ixRenderList();
});
ixTextarea.addEventListener("scroll", () => {
  ixGutter.scrollTop = ixTextarea.scrollTop;
});
ixTextarea.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = ixTextarea.selectionStart;
    const t = ixTextarea.selectionEnd;
    const v = ixTextarea.value;
    ixTextarea.value = v.slice(0, s) + "  " + v.slice(t);
    ixTextarea.selectionStart = ixTextarea.selectionEnd = s + 2;
    ixTextarea.dispatchEvent(new Event("input"));
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "s") {
    if (!indexyWin.hidden && indexyWin.contains(document.activeElement)) {
      e.preventDefault();
      ixSave();
    }
  }
});
$("#ix-clear").addEventListener("click", ixClear);
ixFileInput.addEventListener("change", () => {
  ixAddFiles(ixFileInput.files);
  ixFileInput.value = "";
});
ixFolderInput.addEventListener("change", () => {
  ixAddFiles(ixFolderInput.files);
  ixFolderInput.value = "";
});
$("#ix-close").addEventListener("click", () => closeIndexy(true));
$("#ix-min").addEventListener("click", () => (indexyWin.hidden = true));
$("#ix-max").addEventListener("click", () => indexyWin.classList.toggle("max"));

indexyWin.addEventListener("dragover", (e) => e.preventDefault());
indexyWin.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files.length) ixAddFiles(e.dataTransfer.files);
});

ixRenderList();
makeDraggable(indexyWin, $("#indexy-titlebar"));

/* ---------- Menu bar clock ---------- */
const clockEl = $("#clock");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tickClock() {
  if (!clockEl) return;
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  let suffix = "";
  if (prefs.clock24) {
    h = String(h).padStart(2, "0");
  } else {
    suffix = h >= 12 ? " PM" : " AM";
    h = (h % 12) || 12;
  }
  clockEl.textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}  ${h}:${m}${suffix}`;
  tickDeskClock(d);
}

/* ---------- Desktop clock widget (upper-left) ---------- */
const deskTimeEl = $("#desk-time");
const deskDateEl = $("#desk-date");

function tickDeskClock(d) {
  if (!deskTimeEl || !deskDateEl) return;
  d = d || new Date();
  try {
    deskTimeEl.textContent = d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: prefs.clock24 ? false : undefined,
    });
    deskDateEl.textContent = d.toLocaleDateString([], {
      weekday: prefs.deskDateFormat === "short" ? "short" : "long",
      month: prefs.deskDateFormat === "short" ? "short" : "long",
      day: "numeric",
    });
  } catch {
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    if (prefs.clock24) h = String(h).padStart(2, "0");
    else h = (h % 12) || 12;
    deskTimeEl.textContent = `${h}:${m}`;
    const weekday = prefs.deskDateFormat === "short" ? DAYS[d.getDay()] : d.toLocaleDateString([], { weekday: "long" });
    const month = prefs.deskDateFormat === "short" ? MONTHS[d.getMonth()] : d.toLocaleDateString([], { month: "long" });
    deskDateEl.textContent = `${weekday}, ${month} ${d.getDate()}`;
  }
}
setInterval(tickClock, 10000);

/* ---------- Battery (100% on devices without a battery) ---------- */
const battFill = $("#batt-fill");
const battPct = $("#batt-pct");

function renderBatt(pct, charging) {
  battPct.textContent = pct + "%";
  battFill.style.width = pct + "%";
  battFill.style.background = !charging && pct <= 20 ? "#ff5f57" : "#fff";
}

async function initBattery() {
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      const update = () => renderBatt(Math.round(b.level * 100), b.charging);
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
      update();
      return;
    }
  } catch {
    /* fall through to 100% */
  }
  renderBatt(100, false);
}

/* =========================================================
   Store: community wallpaper backend (likes, uploads, reports)
   ---------------------------------------------------------
   TWO MODES, same features:
   - Offline (default, zero setup): everything is stored in
     this browser's localStorage. Images persist; videos are
     kept for the session only.
   - Cloud (optional, free): create a free Supabase project,
     follow SUPABASE-SETUP.md, then paste your keys into
     SUPABASE_CONFIG below. Likes/uploads/reports are then
     shared across every device and user.
   ========================================================= */

// Paste your free Supabase keys here to go from offline to cloud.
// Leave both empty ("") to stay in offline demo mode.
// NOTE: only the publishable key goes here. The sb_secret_ key must NEVER
// appear in this file — it bypasses all database security rules.
const SUPABASE_CONFIG = { url: "https://ynahfyalawhirzvgnraz.supabase.co", anonKey: "sb_publishable_CAgnvw-0fby_JgqMn75xaw_5AmQqXuM" };
const KLIPY_API_KEY = ""; // Free GIF key: sign up at partner.klipy.com, API Keys page, paste it here.

// Admin access: the account with this email OR this username is an admin.
const ADMIN_EMAILS = ["iez123@proton.me"];
const ADMIN_USERS = ["iez123"];

const cloudOn = () =>
  !!SUPABASE_CONFIG.url && !!SUPABASE_CONFIG.anonKey &&
  /^https?:\/\//.test(SUPABASE_CONFIG.url);

function isAdminUser(u) {
  if (!u) return false;
  const email = String(u.email || "").trim().toLowerCase();
  const name = String(u.name || u.email || "").trim().toLowerCase();
  return ADMIN_EMAILS.includes(email) || ADMIN_USERS.includes(name);
}

/* ---------- Supabase REST helpers (no SDK needed) ---------- */
const supaBase = () => SUPABASE_CONFIG.url.replace(/\/$/, "");

function supaHeaders(token) {
  return {
    apikey: SUPABASE_CONFIG.anonKey,
    Authorization: "Bearer " + (token || SUPABASE_CONFIG.anonKey),
    "Content-Type": "application/json",
  };
}

async function supaAuth(path, body) {
  const res = await fetch(supaBase() + "/auth/v1" + path, {
    method: "POST",
    headers: supaHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.error_description || data.error || "HTTP " + res.status);
  return data;
}

async function supaRest(method, path, body, token, prefer) {
  const headers = supaHeaders(token);
  if (prefer) headers.Prefer = prefer;
  else if (method === "POST" || method === "PATCH") headers.Prefer = "return=representation";
  const res = await fetch(supaBase() + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.message || data.msg)) || "HTTP " + res.status);
  return data;
}

function persistSupaSession(authData) {
  const session = authData.session || authData;
  const payload = JSON.stringify({
    token: session.access_token,
    user: session.user || authData.user,
  });
  const remember = $("#remember").checked;
  (remember ? localStorage : sessionStorage).setItem("glass.supa.session", payload);
}

function readSupaSession() {
  try {
    return JSON.parse(
      localStorage.getItem("glass.supa.session") || sessionStorage.getItem("glass.supa.session")
    ) || null;
  } catch {
    return null;
  }
}

async function registerProfile() {
  const s = readSupaSession();
  if (!s || !s.user) return;
  try {
    await supaRest("POST", "/rest/v1/profiles", { id: s.user.id, email: s.user.email }, s.token, "resolution=merge-duplicates,return=representation");
  } catch {
    /* profiles table optional — likes/uploads still work */
  }
  try {
    await driftEnsureUsername(s);
  } catch {
    /* Drift is optional until its database setup is applied. */
  }
}

async function cloudSignup(key, password) {
  try {
    const data = await supaAuth("/signup", { email: key, password });
    if (!data.session) {
      setMessage("Check your inbox to confirm your email, then log in.");
      return;
    }
    persistSupaSession(data);
    await registerProfile();
    showHome({ name: key.split("@")[0], email: key }, { kind: "new", sound: true });
  } catch (err) {
    const msg = String((err && err.message) || "signup failed");
    setMessage(/already|registered|exists|duplicate/i.test(msg)
      ? "An account with this email already exists. Log in instead."
      : "Could not create the account: " + msg);
    markInvalid($("#email"));
  }
}

async function cloudLogin(key, password) {
  try {
    const data = await supaAuth("/token?grant_type=password", { email: key, password });
    persistSupaSession(data);
    await registerProfile();
    const email = (data.user && data.user.email) || key;
    showHome({ name: email.split("@")[0], email }, { kind: "back", sound: true });
  } catch (err) {
    const msg = String((err && err.message) || "login failed");
    setMessage(/invalid|incorrect|credentials|not found/i.test(msg)
      ? "Email or password is incorrect."
      : "Could not log in: " + msg);
    markInvalid($("#password"));
  }
}

/* ---------- Store data backends (same interface, offline or cloud) ----------
   Item: { id, name, author, authorEmail, kind: 'image'|'video'|'gradient',
           url, css, builtinWall, likes: [emails], status: 'live'|'pending',
           reports: [{ by, reason, at }], createdAt, builtin }
------------------------------------------------------------------------ */
const STORE_ITEMS_KEY = "glass.store.items";
const STORE_LIKES_KEY = "glass.store.likes";
const STORE_HIDDEN_KEY = "glass.store.hidden";

function loadHidden() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_HIDDEN_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* Built-in seeds with per-browser likes applied and admin-hidden ones filtered out */
function seedItems() {
  const hidden = new Set(loadHidden());
  const likeMap = loadLikeMap();
  return builtinStoreSeeds()
    .filter((s) => !hidden.has(s.id))
    .map((s) => ({ ...s, likes: likeMap[s.id] || [] }));
}

async function hideSeed(id) {
  const hidden = loadHidden();
  if (!hidden.includes(id)) hidden.push(id);
  localStorage.setItem(STORE_HIDDEN_KEY, JSON.stringify(hidden));
}

const newStoreId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function builtinStoreSeeds() {
  const grads = BUILTIN_WALLS.filter((w) => w.css).map((w) => ({
    id: "seed-" + w.id, name: w.name, author: "System", authorEmail: "",
    kind: "gradient", url: "", css: w.css, builtinWall: w.id,
    likes: [], status: "live", reports: [], createdAt: 0, builtin: true,
  }));
  return [
    { id: "seed-default", name: "Original Loop", author: "System", authorEmail: "", kind: "video", url: "wallpaper.mp4", css: "", builtinWall: "default", likes: [], status: "live", reports: [], createdAt: 0, builtin: true },
    ...grads,
  ];
}

function loadCommunity() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_ITEMS_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function loadLikeMap() {
  try {
    return JSON.parse(localStorage.getItem(STORE_LIKES_KEY)) || {};
  } catch {
    return {};
  }
}

/* In-memory only: uploaded videos can't fit in localStorage, so in offline
   mode they live until the page is reloaded. Cloud mode keeps them forever. */
let memoryItems = [];

const LocalStore = {
  async items() {
    return [...seedItems(), ...loadCommunity(), ...memoryItems];
  },
  async upload(item) {
    if (item.kind === "video" && item.sessionOnly) {
      memoryItems.push(item);
    } else {
      const list = loadCommunity();
      list.push(item);
      localStorage.setItem(STORE_ITEMS_KEY, JSON.stringify(list));
    }
    return item;
  },
  async toggleLike(id, email) {
    const map = loadLikeMap();
    const arr = map[id] || [];
    const i = arr.indexOf(email);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(email);
    map[id] = arr;
    localStorage.setItem(STORE_LIKES_KEY, JSON.stringify(map));
    // Mirror onto community items so counts survive re-render without the map
    const apply = (list) => list.forEach((it) => { if (it.id === id) it.likes = [...arr]; });
    apply(memoryItems);
    try {
      const list = loadCommunity();
      apply(list);
      localStorage.setItem(STORE_ITEMS_KEY, JSON.stringify(list));
    } catch { /* quota — map already saved */ }
    return arr;
  },
  async report(id, by, reason) {
    const apply = (list) => list.forEach((it) => {
      if (it.id === id) it.reports = [...(it.reports || []), { by, reason, at: Date.now() }];
    });
    apply(memoryItems);
    const list = loadCommunity();
    apply(list);
    localStorage.setItem(STORE_ITEMS_KEY, JSON.stringify(list));
  },
  async setStatus(id, status) {
    const apply = (list) => list.forEach((it) => { if (it.id === id) it.status = status; });
    apply(memoryItems);
    const list = loadCommunity();
    apply(list);
    localStorage.setItem(STORE_ITEMS_KEY, JSON.stringify(list));
  },
  async remove(id) {
    memoryItems = memoryItems.filter((it) => it.id !== id);
    localStorage.setItem(STORE_ITEMS_KEY, JSON.stringify(loadCommunity().filter((it) => it.id !== id)));
    const map = loadLikeMap();
    delete map[id];
    localStorage.setItem(STORE_LIKES_KEY, JSON.stringify(map));
  },
  async dismissReports(id) {
    const apply = (list) => list.forEach((it) => { if (it.id === id) it.reports = []; });
    apply(memoryItems);
    const list = loadCommunity();
    apply(list);
    localStorage.setItem(STORE_ITEMS_KEY, JSON.stringify(list));
  },
};

const toStoreItem = (row, likes, reports) => ({
  id: row.id, name: row.name, author: row.author, authorEmail: row.author_email || "",
  kind: row.kind, url: row.url || "", css: "", builtinWall: "",
  likes: likes.filter((l) => l.wallpaper_id === row.id).map((l) => l.user_email),
  status: row.status, reports: reports.filter((r) => r.wallpaper_id === row.id),
  createdAt: row.created_at ? Date.parse(row.created_at) : 0, builtin: false,
});

const CloudStore = {
  token() {
    const s = readSupaSession();
    return (s && s.token) || null;
  },
  async items() {
    const [rows, likes, reports] = await Promise.all([
      supaRest("GET", "/rest/v1/wallpapers?select=*&order=created_at.desc", undefined, this.token()),
      supaRest("GET", "/rest/v1/likes?select=wallpaper_id,user_email", undefined, this.token()),
      isAdminUser(currentUser)
        ? supaRest("GET", "/rest/v1/reports?select=*&order=created_at.desc", undefined, this.token())
        : Promise.resolve([]),
    ]);
    const seeds = seedItems();
    return [...seeds, ...(rows || []).map((r) => toStoreItem(r, likes || [], reports || []))];
  },
  async uploadFile(itemId, file, token) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "wallpaper";
    const path = itemId + "/" + Date.now() + "-" + safe;
    const res = await fetch(supaBase() + "/storage/v1/object/wallpapers/" + path, {
      method: "POST",
      headers: {
        apikey: SUPABASE_CONFIG.anonKey,
        Authorization: "Bearer " + token,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    });
    if (!res.ok) throw new Error("file upload failed (HTTP " + res.status + ")");
    return supaBase() + "/storage/v1/object/public/wallpapers/" + path;
  },
  async upload(item, file) {
    const token = this.token();
    if (!token) throw new Error("not signed in");
    const url = await this.uploadFile(item.id, file, token);
    const rows = await supaRest("POST", "/rest/v1/wallpapers", {
      id: item.id, name: item.name, author: item.author, author_email: item.authorEmail,
      kind: item.kind, url, status: item.status,
    }, token);
    return toStoreItem(rows[0], [], []);
  },
  async toggleLike(id, email) {
    const token = this.token();
    if (!token) throw new Error("not signed in");
    if (String(id).startsWith("seed-")) return LocalStore.toggleLike(id, email);
    const existing = await supaRest("GET", "/rest/v1/likes?wallpaper_id=eq." + encodeURIComponent(id) + "&user_email=eq." + encodeURIComponent(email) + "&select=wallpaper_id", undefined, token);
    if (existing && existing.length) {
      await supaRest("DELETE", "/rest/v1/likes?wallpaper_id=eq." + encodeURIComponent(id) + "&user_email=eq." + encodeURIComponent(email), undefined, token);
    } else {
      await supaRest("POST", "/rest/v1/likes", { wallpaper_id: id, user_email: email }, token);
    }
  },
  async report(id, by, reason) {
    const token = this.token();
    if (!token) throw new Error("not signed in");
    if (String(id).startsWith("seed-")) return LocalStore.report(id, by, reason);
    await supaRest("POST", "/rest/v1/reports", { wallpaper_id: id, reporter_email: by, reason }, token);
  },
  async setStatus(id, status) {
    await supaRest("PATCH", "/rest/v1/wallpapers?id=eq." + encodeURIComponent(id), { status }, this.token());
  },
  async remove(id) {
    await supaRest("DELETE", "/rest/v1/wallpapers?id=eq." + encodeURIComponent(id), undefined, this.token());
  },
  async dismissReports(id) {
    await supaRest("DELETE", "/rest/v1/reports?wallpaper_id=eq." + encodeURIComponent(id), undefined, this.token());
  },
};

const backend = () => (cloudOn() ? CloudStore : LocalStore);

/* ---------- Mist wallets and avatar decorations ---------- */
let mistWallet = { balance: 0, owned: [], active: null };
let mistMembers = [];

function normalizeMistWallet(row) {
  const owned = Array.isArray(row && (row.owned_decorations || row.owned))
    ? (row.owned_decorations || row.owned).filter((id) => AVATAR_DECORATIONS.some((d) => d.id === id))
    : [];
  const active = row && (row.active_decoration || row.activeDecoration || row.active);
  return {
    balance: Math.max(0, Math.floor(Number(row && row.balance) || 0)),
    owned: [...new Set(owned)],
    active: owned.includes(active) ? active : null,
  };
}

function localMistWallet(email) {
  const users = loadUsers();
  const user = users[String(email || "").trim().toLowerCase()];
  return normalizeMistWallet(user && user.mistWallet);
}

function saveLocalMistWallet(email, wallet) {
  const key = String(email || "").trim().toLowerCase();
  const users = loadUsers();
  if (!key || !users[key]) throw new Error("That member is not registered in this browser.");
  users[key].mistWallet = {
    balance: wallet.balance,
    owned: [...wallet.owned],
    active: wallet.active,
  };
  saveUsers(users);
}

const CloudMist = {
  token() {
    const session = readSupaSession();
    return session && session.token;
  },
  async wallet() {
    const session = readSupaSession();
    const id = session && session.user && session.user.id;
    if (!id || !this.token()) throw new Error("Sign in to use Mist.");
    const rows = await supaRest("GET", "/rest/v1/mist_wallets?user_id=eq." + encodeURIComponent(id) + "&select=balance,owned_decorations,active_decoration", undefined, this.token());
    return normalizeMistWallet(rows && rows[0]);
  },
  async members() {
    const [profiles, wallets] = await Promise.all([
      supaRest("GET", "/rest/v1/profiles?select=id,email&order=email.asc", undefined, this.token()),
      supaRest("GET", "/rest/v1/mist_wallets?select=user_id,balance", undefined, this.token()),
    ]);
    const balances = new Map((wallets || []).map((wallet) => [wallet.user_id, Number(wallet.balance) || 0]));
    const members = (profiles || []).filter((p) => p.email).map((p) => ({
      id: p.id, email: String(p.email).toLowerCase(), name: String(p.email).split("@")[0], balance: balances.get(p.id) || 0,
    }));
    const session = readSupaSession();
    const own = session && session.user;
    if (own && own.email && !members.some((m) => m.id === own.id)) {
      members.unshift({ id: own.id, email: own.email.toLowerCase(), name: own.email.split("@")[0], balance: balances.get(own.id) || 0 });
    }
    return members;
  },
  async queueGift(userId, giftType, amount) {
    return supaRest("POST", "/rest/v1/rpc/admin_queue_mist_gift", {
      p_target_user_id: userId, p_gift_type: giftType, p_amount: amount || null,
    }, this.token());
  },
  async claimGifts() {
    return (await supaRest("POST", "/rest/v1/rpc/claim_mist_gifts", {}, this.token())) || [];
  },
  async purchase(id) {
    return supaRest("POST", "/rest/v1/rpc/purchase_avatar_decoration", { p_decoration_id: id }, this.token());
  },
  async equip(id) {
    return supaRest("POST", "/rest/v1/rpc/equip_avatar_decoration", { p_decoration_id: id }, this.token());
  },
  async unequip() {
    return supaRest("POST", "/rest/v1/rpc/unequip_avatar_decoration", {}, this.token());
  },
};

async function refreshMistWallet() {
  try {
    mistWallet = cloudOn() ? await CloudMist.wallet() : localMistWallet(currentUser && currentUser.email);
    activeAvatarDecoration = mistWallet.active;
    const balance = $("#st-mist-balance");
    if (balance) balance.textContent = mistWallet.balance.toLocaleString();
    const help = $("#st-mist-help");
    if (help) help.hidden = true;
    if (storeView === "decorations") renderAvatarDecorations();
    return mistWallet;
  } catch (err) {
    const balance = $("#st-mist-balance");
    if (balance) balance.textContent = "—";
    throw err;
  }
}

function queueLocalMistGift(email, giftType, amount) {
  const key = String(email || "").trim().toLowerCase();
  const users = loadUsers();
  const user = users[key];
  if (!key || !user) throw new Error("That member is not registered in this browser.");
  if (!Array.isArray(user.pendingMistGifts)) user.pendingMistGifts = [];
  user.pendingMistGifts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    gift_type: giftType,
    amount: giftType === "mist" ? amount : null,
    sender_email: String(currentUser && currentUser.email || "Admin"),
    sender_name: String(currentUser && (currentUser.name || currentUser.email) || "Admin"),
    created_at: new Date().toISOString(),
  });
  saveUsers(users);
}

async function claimLoginMistGifts() {
  const email = String(currentUser && currentUser.email || "").trim().toLowerCase();
  if (!email) return;
  let gifts = [];
  if (cloudOn()) {
    gifts = await CloudMist.claimGifts();
  } else {
    const users = loadUsers();
    const user = users[email];
    if (!user || !Array.isArray(user.pendingMistGifts) || !user.pendingMistGifts.length) return;
    gifts = user.pendingMistGifts;
    const wallet = normalizeMistWallet(user.mistWallet);
    gifts.forEach((gift) => {
      if (gift.gift_type === "mist") wallet.balance += Math.max(0, Math.floor(Number(gift.amount) || 0));
      if (gift.gift_type === "blossom" && !wallet.owned.includes("blossom")) wallet.owned.push("blossom");
    });
    user.mistWallet = { balance: wallet.balance, owned: wallet.owned, active: wallet.active };
    user.pendingMistGifts = [];
    saveUsers(users);
  }
  if (!Array.isArray(gifts) || !gifts.length) return;
  try { await refreshMistWallet(); } catch { /* notification should still be delivered */ }
  applyAvatar();
  gifts.forEach((gift, index) => {
    const sender = gift.sender_name || gift.sender_email || "the Haze team";
    const detail = gift.gift_type === "blossom"
      ? "You received Blossom from " + sender + "."
      : "You received " + Number(gift.amount || 0).toLocaleString() + " Mist from " + sender + ".";
    setTimeout(() => {
      if (!desktop.hidden && String(currentUser && currentUser.email || "").toLowerCase() === email) {
        showHazeNotif("Gift received", detail);
      }
    }, 5600 * (index + 1));
  });
}

async function loadMistMembers() {
  mistMembers = cloudOn()
    ? await CloudMist.members()
    : Object.entries(loadUsers()).map(([email, user]) => ({
      id: email, email, name: user.name || email.split("@")[0], balance: localMistWallet(email).balance,
    })).sort((a, b) => a.email.localeCompare(b.email));
  const select = $("#st-mist-member");
  select.innerHTML = "";
  mistMembers.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.email + " · " + member.balance.toLocaleString() + " Mist";
    option.dataset.email = member.email;
    select.appendChild(option);
  });
  const mine = String(currentUser && currentUser.email || "").toLowerCase();
  if (mistMembers.some((member) => member.email === mine)) select.value = mistMembers.find((member) => member.email === mine).id;
  if (!mistMembers.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No registered members found";
    select.appendChild(option);
  }
}

function renderAvatarDecorations() {
  const grid = $("#st-decoration-grid");
  if (!grid) return;
  grid.replaceChildren();
  const owned = new Set(mistWallet.owned);
  AVATAR_DECORATIONS.forEach((decoration) => {
    const card = document.createElement("article");
    card.className = "decoration-card";
    const preview = document.createElement("div");
    preview.className = "deco-preview deco-" + decoration.id;
    const avatarImage = document.createElement("img");
    avatarImage.className = "deco-avatar-preview";
    avatarImage.src = (currentUser && userPic(currentUser.email)) || AVATAR_DEFAULT;
    avatarImage.alt = "Your profile picture";
    const decorationImage = document.createElement("img");
    decorationImage.className = "deco-art-preview";
    decorationImage.src = decoration.image;
    decorationImage.alt = "";
    decorationImage.setAttribute("aria-hidden", "true");
    preview.append(avatarImage, decorationImage);
    const copy = document.createElement("div");
    copy.className = "deco-copy";
    const title = document.createElement("h3");
    title.textContent = decoration.name;
    const desc = document.createElement("p");
    desc.textContent = decoration.description;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "store-btn" + (owned.has(decoration.id) ? "" : " primary");
    if (owned.has(decoration.id)) {
      const equipped = mistWallet.active === decoration.id || activeAvatarDecoration === decoration.id;
      action.textContent = equipped ? "Enabled" : "Use decoration";
      if (equipped) action.classList.add("deco-equipped");
    } else {
      action.textContent = decoration.cost.toLocaleString() + " Mist";
      action.disabled = mistWallet.balance < decoration.cost;
    }
    action.addEventListener("click", async () => {
      action.disabled = true;
      try {
        if (owned.has(decoration.id)) {
          const wasEquipped = mistWallet.active === decoration.id || activeAvatarDecoration === decoration.id;
          if (wasEquipped) {
            if (cloudOn()) await CloudMist.unequip();
            else {
              mistWallet.active = null;
              saveLocalMistWallet(currentUser.email, mistWallet);
            }
            toast(decoration.name + " disabled");
          } else {
            if (cloudOn()) await CloudMist.equip(decoration.id);
            else {
              mistWallet.active = decoration.id;
              saveLocalMistWallet(currentUser.email, mistWallet);
            }
            toast(decoration.name + " equipped");
          }
        } else if (cloudOn()) {
          await CloudMist.purchase(decoration.id);
          toast(decoration.name + " added to your collection");
        } else {
          if (mistWallet.balance < decoration.cost) throw new Error("You need more Mist for this decoration.");
          mistWallet.balance -= decoration.cost;
          mistWallet.owned.push(decoration.id);
          mistWallet.active = decoration.id;
          saveLocalMistWallet(currentUser.email, mistWallet);
          toast(decoration.name + " purchased and equipped");
        }
        await refreshMistWallet();
        applyAvatar();
      } catch (err) {
        toast("Could not update decoration: " + (err.message || "try again"));
        action.disabled = false;
      }
    });
    copy.append(title, desc, action);
    card.append(preview, copy);
    grid.appendChild(card);
  });
  $("#st-decoration-empty").hidden = AVATAR_DECORATIONS.length > 0;
}

async function creditMistToMember() {
  const button = $("#st-mist-credit");
  const status = $("#st-mist-status");
  const member = mistMembers.find((item) => item.id === $("#st-mist-member").value);
  const giftType = $("#st-gift-type").value;
  const amount = Number($("#st-mist-amount").value);
  if (!member) { status.textContent = "Choose a registered member first."; return; }
  if (giftType === "mist" && (!Number.isInteger(amount) || amount < 1 || amount > 100000)) {
    status.textContent = "Enter an amount from 1 to 100,000.";
    return;
  }
  button.disabled = true;
  status.textContent = "Sending gift…";
  try {
    if (cloudOn()) await CloudMist.queueGift(member.id, giftType, giftType === "mist" ? amount : null);
    else queueLocalMistGift(member.email, giftType, giftType === "mist" ? amount : null);
    status.textContent = "Gift queued for " + member.email + ". They’ll receive it the next time they sign in.";
  } catch (err) {
    status.textContent = "Could not send gift: " + (err.message || "try again");
  } finally {
    button.disabled = false;
  }
}

/* ---------- Store UI ---------- */
let storeView = "appearance";
let storeItems = [];
let storeQuery = "";
let pendingUploadFile = null;
let uploadBusy = false;
let reportTarget = null;
let nsfwModelPromise = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

/* Client-side safety scan (nsfwjs, free, runs fully in the browser).
   Returns { porn, sexy } scores, or { error: true } when the scanner
   can't run (offline / CDN blocked) — then a human admin decides. */
async function scanImage(dataUrl, onStatus) {
  onStatus("Scanning image for inappropriate content…");
  try {
    if (!nsfwModelPromise) {
      nsfwModelPromise = (async () => {
        if (typeof nsfwjs === "undefined") {
          onStatus("Loading safety scanner (first upload only)…");
          await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/dist/tf.min.js");
          await loadScript("https://cdn.jsdelivr.net/npm/nsfwjs@2.4.2/dist/nsfwjs.min.js");
        }
        return nsfwjs.load();
      })();
    }
    const model = await nsfwModelPromise;
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const preds = await model.classify(img);
    const score = (...names) => preds.reduce(
      (m, p) => names.some((n) => String(p.className).toLowerCase().includes(n)) ? Math.max(m, p.probability) : m, 0);
    return { porn: score("porn", "hentai"), sexy: score("sexy") };
  } catch {
    nsfwModelPromise = null;
    return { error: true };
  }
}

function openStore() {
  if (!storeWin.hidden) {
    closeStore(false);
    return;
  }
  storeWin.hidden = false;
  storeWin.classList.remove("open");
  void storeWin.offsetWidth;
  storeWin.classList.add("open");
  storeBtn.classList.add("running");
  focusWindow(storeWin);
  const admin = isAdminUser(currentUser);
  document.querySelector(".store-nav.admin-only").hidden = !admin;
  $("#st-up-submit").textContent = admin ? "Publish now" : "Upload for review";
  switchStoreView("appearance");
  refreshStore();
}

function closeStore(quit = true) {
  storeWin.hidden = true;
  closeReportModal();
  if (quit) storeBtn.classList.remove("running");
}

function switchStoreView(name) {
  if (!$("#st-view-" + name)) name = "appearance";
  storeView = name;
  document.querySelectorAll(".store-nav").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  ["appearance", "favorites", "decorations", "upload", "admin"].forEach((v) => {
    $("#st-view-" + v).hidden = v !== name;
  });
  $("#st-toolbar").hidden = !["appearance", "favorites"].includes(name);
  const labels = { appearance: "Wallpapers & icon packs", favorites: "Community favorites", decorations: "Avatar decorations", upload: "Share a wallpaper", admin: "Shop admin" };
  $("#st-status").textContent = labels[name];
  if (name === "decorations") {
    refreshMistWallet().then(() => renderAvatarDecorations()).catch(() => {
      $("#st-mist-help").hidden = false;
    });
  } else if (name === "admin") {
    $("#st-mist-credit").disabled = true;
    $("#st-mist-status").textContent = "Loading registered members…";
    loadMistMembers().then(() => {
      $("#st-mist-credit").disabled = mistMembers.length === 0;
      $("#st-mist-status").textContent = mistMembers.length ? "Choose a member and gift to queue it for their next sign in." : "No registered members were found.";
    }).catch((err) => {
      $("#st-mist-status").textContent = cloudOn()
        ? "Update Supabase with supabase-setup.sql to enable member wallets and gifts."
        : (err.message || "Could not load members.");
    });
  }
}

async function refreshStore() {
  try {
    storeItems = await backend().items();
  } catch (err) {
    console.error(err);
    toast("Could not load the Shop: " + (err.message || "network error"));
    storeItems = [];
  }
  renderStore();
}

const likeCount = (it) => (it.likes || []).length;
const likedByMe = (it) => currentUser && (it.likes || []).includes(currentUser.email);
const canSee = (it) => it.status === "live" || isAdminUser(currentUser) || (currentUser && it.authorEmail === currentUser.email);

function storeThumb(it) {
  if (it.kind === "video" && it.url) {
    return '<video src="' + esc(it.url) + '" muted playsinline preload="metadata"></video>';
  }
  if (it.kind === "image" && it.url) {
    return '<img src="' + esc(it.url) + '" alt="" loading="lazy">';
  }
  if (it.kind === "gradient" && it.css) {
    return '<div style="position:absolute;inset:0;background:' + esc(it.css) + '"></div>';
  }
  return "";
}

const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9Z"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>';
const ICON_FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l.9 13h9.2l.9-13"/></svg>';

function buildStoreCard(it) {
  const admin = isAdminUser(currentUser);
  const liked = likedByMe(it);
  const downloaded = isDownloaded(it);
  const card = document.createElement("article");
  card.className = "store-card";
  card.dataset.id = it.id;
  card.innerHTML =
    '<div class="store-thumb">' + storeThumb(it) +
    '<span class="store-kind">' + (it.kind === "video" ? "VIDEO" : it.kind === "gradient" ? "THEME" : "IMAGE") + "</span>" +
    (it.status !== "live" ? '<span class="store-pending-flag">PENDING</span>' : "") +
    "</div>" +
    '<div class="store-meta"><div class="store-name"></div>' +
    '<div class="store-sub"></div>' +
    '<div class="store-actions">' +
    (downloaded
      ? '<button type="button" class="store-btn primary" data-act="apply">Apply</button>'
      : '<button type="button" class="store-btn primary" data-act="install">Download</button>') +
    '<button type="button" class="like-btn' + (liked ? " liked" : "") + '" data-act="like" aria-label="Like">' + ICON_HEART + "<span>" + likeCount(it) + "</span></button>" +
    (it.url ? '<a class="icon-btn" data-act="download" href="' + esc(it.url) + '" download target="_blank" rel="noopener" aria-label="Download file" title="Download file">' + ICON_DOWNLOAD + "</a>" : "") +
    (it.builtin ? "" : '<button type="button" class="icon-btn" data-act="report" aria-label="Report" title="Report">' + ICON_FLAG + "</button>") +
    (admin ? '<button type="button" class="icon-btn danger" data-act="remove" aria-label="Remove" title="Remove">' + ICON_TRASH + "</button>" : "") +
    "</div></div>";
  card.querySelector(".store-name").textContent = it.name;
  const sub = card.querySelector(".store-sub");
  const ava = document.createElement("span");
  ava.className = "store-ava";
  ava.setAttribute("aria-hidden", "true");
  ava.textContent = ((it.author || "?").trim().charAt(0) || "?").toUpperCase();
  const author = document.createElement("span");
  author.className = "store-author";
  author.textContent = it.author || "unknown";
  sub.append(ava, author);
  return card;
}

function renderStore() {
  const q = storeQuery.trim().toLowerCase();
  const match = (it) => !q || it.name.toLowerCase().includes(q) || (it.author || "").toLowerCase().includes(q);
  const visible = storeItems.filter((it) => canSee(it) && match(it));
  const live = visible.filter((it) => it.status === "live");

  $("#st-status").textContent = storeView === "appearance"
    ? live.length + (live.length === 1 ? " wallpaper" : " wallpapers")
    : ({ favorites: "Community favorites", decorations: "Avatar decorations", upload: "Share a wallpaper", admin: "Shop admin" }[storeView] || "Shop");

  const grid = $("#st-grid");
  grid.innerHTML = "";
  const communityItems = live.filter((it) => !it.builtin && it.kind !== "gradient");
  const includedItems = live.filter((it) => it.builtin && it.kind !== "gradient");
  const solidColorItems = live.filter((it) => it.kind === "gradient");
  const buildSection = (title, items) => {
    if (!items.length) return;
    const wrap = document.createElement("div");
    wrap.className = "store-section";
    const head = document.createElement("div");
    head.className = "store-section-head";
    const h3 = document.createElement("h3");
    h3.textContent = title;
    const count = document.createElement("span");
    count.textContent = items.length + (items.length === 1 ? " item" : " items");
    head.append(h3, count);
    const g = document.createElement("div");
    g.className = "store-grid";
    items.forEach((it) => g.appendChild(buildStoreCard(it)));
    wrap.append(head, g);
    grid.appendChild(wrap);
  };
  buildSection("Community", communityItems);
  buildSection("Included", includedItems);
  buildSection("Solid colors", solidColorItems);
  $("#st-empty").hidden = live.length > 0;

  const favs = live.filter((it) => likeCount(it) > 0).sort((a, b) => likeCount(b) - likeCount(a) || b.createdAt - a.createdAt);
  const favGrid = $("#st-grid-fav");
  favGrid.innerHTML = "";
  favs.forEach((it) => favGrid.appendChild(buildStoreCard(it)));
  $("#st-empty-fav").hidden = favs.length > 0;
  $("#st-fav-count").textContent = favs.length ? favs.length + (favs.length === 1 ? " item" : " items") : "";

  if (storeView === "admin") renderAdmin();
}

/* Already on this device? Built-ins always are; community items are once downloaded. */
function isDownloaded(it) {
  return !!it.builtinWall || walls.some((w) => w.storeId === it.id);
}

/* Copy a community item into the local library (Settings → Appearance).
   Returns the local wall id, or null when it can't be stored. */
function ensureLocalCopy(it) {
  if (it.builtinWall || !it.url) return it.builtinWall || null;
  const existing = walls.find((x) => x.storeId === it.id);
  if (existing) return existing.id;
  const w = it.kind === "video"
    ? { id: "c" + it.id, name: it.name, video: it.url, storeId: it.id }
    : { id: "c" + it.id, name: it.name, data: it.url, storeId: it.id };
  walls.push(w);
  if (!saveWalls()) {
    walls.pop();
    return null;
  }
  return w.id;
}

function installStoreItem(it) {
  if (!ensureLocalCopy(it)) {
    toast("Not enough storage to download this wallpaper");
    return;
  }
  renderWalls();
  refreshStore();
  toast("Downloaded — find it in Settings → Appearance");
}

function applyStoreItem(it) {
  const id = it.builtinWall || ensureLocalCopy(it);
  if (!id) {
    toast(it.url ? "Download it first, then apply" : "This wallpaper has no file attached");
    return;
  }
  prefs.wall = id;
  savePrefs();
  applyWallpaper();
  renderWalls();
  toast("Wallpaper applied");
}

async function onStoreGridClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  if (btn.tagName === "A") return; // download link — let the browser handle it
  const card = e.target.closest("[data-id]");
  if (!card) return;
  const it = storeItems.find((x) => x.id === card.dataset.id);
  if (!it) return;
  const act = btn.dataset.act;

  if (act === "install") {
    installStoreItem(it);
    return;
  }
  if (act === "apply") {
    applyStoreItem(it);
    return;
  }
  if (act === "like") {
    try {
      await backend().toggleLike(it.id, currentUser.email);
      await refreshStore();
    } catch (err) {
      toast("Could not save your like: " + (err.message || "network error"));
    }
    return;
  }
  if (act === "report") {
    reportTarget = it;
    $("#st-report-name").textContent = '"' + it.name + '" by ' + (it.author || "unknown");
    $("#st-report-modal").hidden = false;
    return;
  }
  if (act === "remove") {
    if (!isAdminUser(currentUser)) return;
    if (!window.confirm('Remove "' + it.name + '" from the Shop?')) return;
    try {
      if (it.builtin) {
        await hideSeed(it.id);
        toast("Built-in hidden — restore it anytime in Admin");
      } else {
        await backend().remove(it.id);
        toast("Wallpaper removed");
      }
      await refreshStore();
    } catch (err) {
      toast("Could not remove it: " + (err.message || "network error"));
    }
  }
}

function closeReportModal() {
  $("#st-report-modal").hidden = true;
  reportTarget = null;
}

/* ---------- Admin queue ---------- */
function queueThumb(it) {
  if (it.kind === "video" && it.url) return '<video src="' + esc(it.url) + '" muted playsinline preload="metadata"></video>';
  if (it.kind === "image" && it.url) return '<img src="' + esc(it.url) + '" alt="" loading="lazy">';
  if (it.kind === "gradient" && it.css) return '<div style="width:96px;height:60px;border-radius:8px;flex:none;background:' + esc(it.css) + '"></div>';
  return "";
}

function renderAdmin() {
  const pending = storeItems.filter((it) => it.status === "pending" && !it.builtin);
  const reported = storeItems.filter((it) => (it.reports || []).length > 0);
  $("#st-pending-count").textContent = pending.length;
  $("#st-reports-count").textContent = reported.reduce((n, it) => n + it.reports.length, 0);

  const pq = $("#st-pending");
  pq.innerHTML = "";
  const hidden = loadHidden();
  if (hidden.length) {
    const restoreRow = document.createElement("div");
    restoreRow.className = "queue-row";
    restoreRow.innerHTML =
      '<div class="queue-info"><strong>Hidden built-ins (' + hidden.length + ')</strong>' +
      "<span>Removed from the gallery by an admin</span></div>" +
      '<div class="queue-actions"><button type="button" class="store-btn" data-admin-act="restore">Restore</button></div>';
    pq.appendChild(restoreRow);
  }
  if (!pending.length && !hidden.length) pq.innerHTML = '<div class="store-queue-empty">Nothing waiting — new uploads will show up here.</div>';
  pending.forEach((it) => {
    const row = document.createElement("div");
    row.className = "queue-row";
    row.dataset.id = it.id;
    row.innerHTML = queueThumb(it) +
      '<div class="queue-info"><strong></strong><span></span></div>' +
      '<div class="queue-actions">' +
      '<button type="button" class="store-btn primary" data-admin-act="approve">Approve</button>' +
      '<button type="button" class="store-btn danger" data-admin-act="reject">Reject</button>' +
      "</div>";
    row.querySelector("strong").textContent = it.name;
    row.querySelector("span").textContent = "by " + (it.author || "unknown") + " · " + it.kind;
    pq.appendChild(row);
  });

  const rq = $("#st-reports");
  rq.innerHTML = reported.length ? "" : '<div class="store-queue-empty">No reports. Nice community.</div>';
  reported.forEach((it) => {
    const reasons = it.reports.map((r) => r.reason + " — " + (r.by || "anonymous")).join(" · ");
    const row = document.createElement("div");
    row.className = "queue-row";
    row.dataset.id = it.id;
    row.innerHTML = queueThumb(it) +
      '<div class="queue-info"><strong></strong><span class="rep-reason"></span><span></span></div>' +
      '<div class="queue-actions">' +
      '<button type="button" class="store-btn" data-admin-act="dismiss">Dismiss</button>' +
      '<button type="button" class="store-btn danger" data-admin-act="remove">Remove</button>' +
      "</div>";
    const [title, reasonEl, metaEl] = row.querySelectorAll("strong, span");
    title.textContent = it.name + " (" + it.reports.length + ")";
    reasonEl.textContent = reasons;
    metaEl.textContent = "by " + (it.author || "unknown") + " · ♥ " + likeCount(it);
    rq.appendChild(row);
  });
}

$("#st-mist-credit").addEventListener("click", creditMistToMember);
$("#st-gift-type").addEventListener("change", (event) => {
  $("#st-gift-amount-field").hidden = event.target.value !== "mist";
});

async function onAdminQueueClick(e) {
  const btn = e.target.closest("[data-admin-act]");
  if (!btn) return;
  const act = btn.dataset.adminAct;
  if (act === "restore") {
    localStorage.removeItem(STORE_HIDDEN_KEY);
    toast("Built-in wallpapers restored");
    await refreshStore();
    return;
  }
  const row = e.target.closest("[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  try {
    if (act === "approve") {
      await backend().setStatus(id, "live");
      toast("Wallpaper approved");
    } else if (act === "reject") {
      await backend().remove(id);
      toast("Upload rejected and removed");
    } else if (act === "dismiss") {
      await backend().dismissReports(id);
      toast("Reports dismissed");
    } else if (act === "remove") {
      if (!window.confirm("Remove this wallpaper from the Shop?")) return;
      await backend().remove(id);
      toast("Wallpaper removed");
    }
    await refreshStore();
  } catch (err) {
    toast("Admin action failed: " + (err.message || "network error"));
  }
}

/* ---------- Upload ---------- */
function setUploadPreview(file) {
  const prev = $("#st-up-preview");
  const img = $("#st-up-img");
  const vid = $("#st-up-video");
  if (!file) {
    prev.hidden = true;
    img.hidden = true;
    vid.hidden = true;
    img.removeAttribute("src");
    vid.removeAttribute("src");
    return;
  }
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video/");
  img.hidden = isVideo;
  vid.hidden = !isVideo;
  if (isVideo) vid.src = url;
  else img.src = url;
  $("#st-up-filename").textContent = file.name;
  $("#st-up-filesize").textContent = file.type + " · " + (file.size / 1048576).toFixed(1) + " MB";
  prev.hidden = false;
}

function resetUploadForm() {
  pendingUploadFile = null;
  $("#st-up-file").value = "";
  $("#st-up-name").value = "";
  setUploadPreview(null);
  const scan = $("#st-up-scan");
  scan.hidden = true;
  scan.className = "store-scan";
  scan.textContent = "";
}

function scanNote(text, cls) {
  const scan = $("#st-up-scan");
  scan.hidden = false;
  scan.className = "store-scan" + (cls ? " " + cls : "");
  scan.textContent = text;
}

async function submitUpload() {
  if (uploadBusy) return;
  const file = pendingUploadFile;
  if (!file) {
    toast("Choose an image or video first");
    return;
  }
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    toast("Only images and videos can be wallpapers");
    return;
  }
  const admin = isAdminUser(currentUser);
  const name = ($("#st-up-name").value.trim() || file.name.replace(/\.[^.]+$/, "")).slice(0, 60);
  const me = currentUser || { name: "Guest", email: "" };
  uploadBusy = true;
  $("#st-up-submit").disabled = true;
  try {
    let item;
    if (file.type.startsWith("image/")) {
      const dataUrl = await shrinkImage(file); // same pipeline as Settings wallpapers
      const scan = await scanImage(dataUrl, (t) => scanNote(t));
      if (!scan.error && scan.porn >= 0.55) {
        scanNote("Blocked: this image was flagged as inappropriate and was not uploaded.", "bad");
        toast("Upload blocked by the safety scan");
        return;
      }
      const status = admin ? "live" : "pending";
      item = {
        id: newStoreId(), name, author: me.name || me.email, authorEmail: me.email,
        kind: "image", url: dataUrl, css: "", builtinWall: "",
        likes: [], status, reports: [], createdAt: Date.now(), builtin: false,
      };
      if (!scan.error) scanNote(scan.sexy >= 0.55 ? "Scan passed with a caution flag — sent for admin review." : "Scan passed ✓" + (admin ? " — publishing." : " — sent for admin review."), "ok");
      else scanNote("Scanner unavailable (offline?) — sent for admin review.");
      await backend().upload(item, file);
    } else {
      if (file.size > 40 * 1048576) {
        toast("Videos must be under 40 MB");
        return;
      }
      const status = admin ? "live" : "pending";
      item = {
        id: newStoreId(), name, author: me.name || me.email, authorEmail: me.email,
        kind: "video", url: "", css: "", builtinWall: "",
        likes: [], status, reports: [], createdAt: Date.now(), builtin: false,
      };
      if (cloudOn()) {
        scanNote("Uploading video to the cloud…");
        const saved = await backend().upload(item, file);
        item = saved;
      } else {
        item.url = URL.createObjectURL(file);
        item.sessionOnly = true;
        await backend().upload(item, file);
        scanNote("Videos can't be auto-scanned, and offline videos last until reload — an admin will review it.", "");
      }
    }
    toast(admin && item.status === "live" ? "Wallpaper published" : "Uploaded — waiting for admin review");
    resetUploadForm();
    await refreshStore();
  } catch (err) {
    console.error(err);
    const msg = String((err && err.message) || "upload failed");
    toast(/quota|storage/i.test(msg) ? "Browser storage is full — connect the free cloud (SUPABASE-SETUP.md) for unlimited uploads." : "Upload failed: " + msg);
  } finally {
    uploadBusy = false;
    $("#st-up-submit").disabled = false;
  }
}

/* ---------- Store wiring ---------- */
$("#st-close").addEventListener("click", () => closeStore(true));
$("#st-min").addEventListener("click", () => { storeWin.hidden = true; });
$("#st-max").addEventListener("click", () => storeWin.classList.toggle("max"));
makeDraggable(storeWin, $("#store-titlebar"));

document.querySelectorAll(".store-nav").forEach((btn) =>
  btn.addEventListener("click", () => switchStoreView(btn.dataset.view))
);

$("#st-search").addEventListener("input", (e) => {
  storeQuery = e.target.value;
  renderStore();
});
attachCustomCaret($("#st-search-field"), $("#st-search"), $("#st-search-caret"));

$("#st-grid").addEventListener("click", onStoreGridClick);
$("#st-grid-fav").addEventListener("click", onStoreGridClick);
$("#st-pending").addEventListener("click", (e) => onAdminQueueClick(e));
$("#st-reports").addEventListener("click", (e) => onAdminQueueClick(e));

$("#st-report-cancel").addEventListener("click", closeReportModal);
$("#st-report-send").addEventListener("click", async () => {
  if (!reportTarget) return closeReportModal();
  try {
    await backend().report(reportTarget.id, currentUser.email, $("#st-report-reason").value);
    toast("Thanks — an admin will review this wallpaper");
  } catch (err) {
    toast("Could not send the report: " + (err.message || "network error"));
  }
  closeReportModal();
  refreshStore();
});

const stUpDrop = $("#st-up-drop");
const stUpInput = $("#st-up-file");
stUpDrop.addEventListener("click", () => stUpInput.click());
stUpDrop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    stUpInput.click();
  }
});
stUpInput.addEventListener("change", () => {
  if (stUpInput.files.length) {
    pendingUploadFile = stUpInput.files[0];
    setUploadPreview(pendingUploadFile);
  }
  stUpInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  stUpDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    stUpDrop.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((evt) =>
  stUpDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    stUpDrop.classList.remove("drag");
  })
);
stUpDrop.addEventListener("drop", (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) {
    pendingUploadFile = e.dataTransfer.files[0];
    setUploadPreview(pendingUploadFile);
  }
});
$("#st-up-submit").addEventListener("click", submitUpload);

/* ---------- Boot: restore an existing session ---------- */
(function init() {
  applyPrefs();
  applyWallpaper();
  renderWalls();
  restoreDockOrder();
  tickClock();
  initBattery();
  const session = readSession();
  let user = session && session.email ? loadUsers()[session.email] : null;
  if (!user && session && session.email && cloudOn()) {
    user = { name: String(session.email).split("@")[0], email: session.email };
  }
  if (user) {
    stayOn = true;
    showHome({ name: user.name, email: session.email }, { kind: "return" });
  } else {
    setMode("login", false);
  }
})();
