/**
 * after.hours — film pool (static; data in localStorage per join code on this device)
 * Production: run `npm run build` with TMDB_API_KEY set (Netlify env).
 */
const TMDB_KEY = "";

const LEGACY_KEY = "ah_state";
const LAST_HOST_KEY = "ah_last_host_code";
const JOIN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

let currentRoomSlug = null;
let state = freshState();

function freshState() {
  return {
    pool: [],
    winner: null,
    eventDt: null,
    ytUrl: "",
    myPick: null,
    roomName: "",
    joinCode: "",
  };
}

const $ = (id) => document.getElementById(id);
let cdInterval = null;

function normalizeJoinCode(s) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 12);
}

function roomStorageKey(code) {
  return "ah_room_" + normalizeJoinCode(code).toLowerCase();
}

function generateJoinCode(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += JOIN_ALPHABET[bytes[i] % JOIN_ALPHABET.length];
  }
  return out;
}

function assignJoinCodeForSave() {
  if (state.joinCode) {
    const slug = normalizeJoinCode(state.joinCode);
    if (!currentRoomSlug) currentRoomSlug = slug;
    return slug;
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = generateJoinCode(6);
    const slug = normalizeJoinCode(candidate);
    const taken = localStorage.getItem(roomStorageKey(slug));
    if (!taken) {
      state.joinCode = slug;
      currentRoomSlug = slug;
      return slug;
    }
  }
  const slug = normalizeJoinCode(generateJoinCode(10));
  state.joinCode = slug;
  currentRoomSlug = slug;
  return slug;
}

function getLastHostCode() {
  try {
    return localStorage.getItem(LAST_HOST_KEY);
  } catch {
    return null;
  }
}

function setLastHostCode(code) {
  try {
    localStorage.setItem(LAST_HOST_KEY, normalizeJoinCode(code));
  } catch {
    /* ignore */
  }
}

function ensurePickUids() {
  let dirty = false;
  state.pool = state.pool.map((p) => {
    if (p.uid) return p;
    dirty = true;
    const uid =
      "p-" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36));
    return { ...p, uid };
  });
  if (state.winner && !state.winner.uid) {
    const m = state.pool.find(
      (x) =>
        x.id === state.winner.id &&
        x.title === state.winner.title &&
        x.addedBy === state.winner.addedBy
    );
    if (m) state.winner = { ...state.winner, uid: m.uid };
  }
  if (dirty) save();
}

function loadRoomIntoState(code) {
  const slug = normalizeJoinCode(code);
  const key = roomStorageKey(slug);
  let raw = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  if (!raw) {
    try {
      const leg = localStorage.getItem(LEGACY_KEY);
      const oldBucket = localStorage.getItem("ah_room_afterhours");
      if (slug.toLowerCase() === "afterhours" && (oldBucket || leg)) {
        raw = oldBucket || leg;
        localStorage.setItem(key, raw);
      }
    } catch {
      /* ignore */
    }
  }
  const base = freshState();
  if (!raw) {
    state = { ...base };
    return;
  }
  try {
    const o = JSON.parse(raw);
    state = { ...base, ...o };
    if (!state.roomName && o.screeningName) state.roomName = o.screeningName;
    if (!state.joinCode) state.joinCode = normalizeJoinCode(slug);
    ensurePickUids();
  } catch {
    state = { ...base };
  }
}

function save() {
  if (!currentRoomSlug) return;
  try {
    localStorage.setItem(roomStorageKey(currentRoomSlug), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function renderCountdown() {
  const el = $("cd-display");
  if (!state.eventDt) {
    el.innerHTML = '<p class="cd-no-date">date tbd — check back soon</p>';
    return;
  }
  function tick() {
    const diff = new Date(state.eventDt).getTime() - Date.now();
    if (diff <= 0) {
      el.innerHTML =
        '<p class="cd-no-date" style="color:#c8a96e;">tonight is the night</p>';
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const sec = Math.floor((diff % 60000) / 1000);
    el.innerHTML = `<div class="cd-digits">
      <div class="cd-unit"><span class="cd-num">${pad(d)}</span><span class="cd-sub">days</span></div>
      <span class="cd-sep">:</span>
      <div class="cd-unit"><span class="cd-num">${pad(h)}</span><span class="cd-sub">hrs</span></div>
      <span class="cd-sep">:</span>
      <div class="cd-unit"><span class="cd-num">${pad(m)}</span><span class="cd-sub">min</span></div>
      <span class="cd-sep">:</span>
      <div class="cd-unit"><span class="cd-num">${pad(sec)}</span><span class="cd-sub">sec</span></div>
    </div>`;
  }
  tick();
  if (cdInterval) clearInterval(cdInterval);
  cdInterval = setInterval(tick, 1000);
}

function renderRoomTitle() {
  const el = $("room-title-line");
  if (!el) return;
  const name = (state.roomName || "").trim();
  if (!name) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = name;
}

function renderMainStats() {
  $("film-count-stat").textContent = state.pool.length;
  renderRoomTitle();
  const rb = $("room-badge");
  if (rb && state.joinCode) {
    rb.textContent = "code · " + state.joinCode;
    rb.title = "Join code: " + state.joinCode;
  }
  if (state.myPick) {
    $("add-section").style.display = "none";
    $("my-pick-section").style.display = "flex";
    const f = state.myPick;
    const p = f.poster ? `https://image.tmdb.org/t/p/w92${f.poster}` : null;
    $("my-pick-inner").innerHTML = `${p ? `<img class="my-poster" src="${p}" alt="">` : '<div class="my-poster-ph"></div>'}
      <div><div class="my-title">${escapeHtml(f.title)}</div><div class="my-year">${escapeHtml(f.year)}</div><div class="my-by">submitted by ${escapeHtml(f.addedBy)}</div></div>`;
  } else {
    $("add-section").style.display = "flex";
    $("my-pick-section").style.display = "none";
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function renderAdminPool() {
  const list = $("admin-pool-list");
  if (!list) return;
  $("admin-pool-count").textContent = state.pool.length;
  $("admin-draw-btn").disabled = state.pool.length < 2;
  if (!state.pool.length) {
    list.innerHTML = '<p class="pool-empty-msg">no films yet</p>';
    return;
  }
  list.innerHTML = "";
  state.pool.forEach((f, i) => {
    const p = f.poster ? `https://image.tmdb.org/t/p/w92${f.poster}` : null;
    const row = document.createElement("div");
    row.className = "pool-row";
    row.innerHTML = `${p ? `<img class="pool-row-poster" src="${p}" alt="">` : '<div class="pool-row-poster"></div>'}
      <div style="flex:1;min-width:0;"><div class="pool-row-title">${escapeHtml(f.title)} ${f.year ? "(" + escapeHtml(f.year) + ")" : ""}</div><div class="pool-row-by">by ${escapeHtml(f.addedBy)}</div></div>
      <button type="button" class="del-btn" data-i="${i}">remove</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.i, 10);
      const removed = state.pool[i];
      state.pool.splice(i, 1);
      if (
        state.winner &&
        removed &&
        (state.winner.uid ? state.winner.uid === removed.uid : state.winner.id === removed.id)
      ) {
        state.winner = null;
      }
      save();
      renderAdminPool();
      renderWinner();
    });
  });
}

function renderWinner() {
  const el = $("winner-display");
  if (!el) return;
  if (!state.winner) {
    el.innerHTML = "";
    return;
  }
  const f = state.winner;
  const p = f.poster ? `https://image.tmdb.org/t/p/w92${f.poster}` : null;
  el.innerHTML = `<div class="winner-row">${p ? `<img class="pool-row-poster" src="${p}" alt="">` : ""}
    <div style="flex:1;min-width:0;"><div class="winner-label">drawn film</div><div class="winner-title">${escapeHtml(f.title)}</div><div class="winner-year">${escapeHtml(f.year)}</div></div>
  </div>`;
}

function ytIdFromUrl(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function openVideoModal() {
  const modal = $("video-modal");
  modal.classList.add("open");
  const ytId = ytIdFromUrl(state.ytUrl);
  if (ytId) {
    $("no-video-ph").style.display = "none";
    const f = $("yt-frame");
    f.style.display = "block";
    f.src = `https://www.youtube.com/embed/${ytId}?autoplay=1`;
  } else {
    $("no-video-ph").style.display = "flex";
    $("yt-frame").style.display = "none";
  }
}

function shareJoinUrl(code) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("code", normalizeJoinCode(code));
    return u.toString();
  } catch {
    return "";
  }
}

function populateHostForm() {
  $("room-name-input").value = state.roomName || "";
  $("event-dt").value = state.eventDt || "";
  $("yt-url-input").value = state.ytUrl || "";
}

function renderHostJoinPanel() {
  const panel = $("host-join-panel");
  const display = $("join-code-display");
  const shareInput = $("share-url-input");
  if (!panel || !display) return;
  if (state.joinCode) {
    panel.hidden = false;
    display.textContent = state.joinCode;
    if (shareInput) shareInput.value = shareJoinUrl(state.joinCode);
  } else {
    panel.hidden = true;
    display.textContent = "";
    if (shareInput) shareInput.value = "";
  }
}

function enterSite() {
  const code = normalizeJoinCode($("code-input").value);
  if (code.length < 6) {
    $("err-msg").textContent = "enter the 6-character join code";
    $("code-input").focus();
    return;
  }
  let raw = null;
  try {
    raw = localStorage.getItem(roomStorageKey(code));
  } catch {
    /* ignore */
  }
  if (!raw) {
    $("err-msg").textContent = "no room with that code on this device";
    $("code-input").value = "";
    $("code-input").focus();
    return;
  }
  $("err-msg").textContent = "";
  loadRoomIntoState(code);
  currentRoomSlug = normalizeJoinCode(code);
  if (!state.joinCode) state.joinCode = currentRoomSlug;
  showScreen("main-screen");
  renderCountdown();
  renderMainStats();
  openVideoModal();
}

function openHostAdmin() {
  const last = getLastHostCode();
  const lastNorm = last ? normalizeJoinCode(last) : "";
  if (
    lastNorm &&
    (() => {
      try {
        return !!localStorage.getItem(roomStorageKey(lastNorm));
      } catch {
        return false;
      }
    })()
  ) {
    currentRoomSlug = lastNorm;
    loadRoomIntoState(currentRoomSlug);
  } else {
    currentRoomSlug = null;
    state = freshState();
  }
  populateHostForm();
  renderHostJoinPanel();
  showScreen("host-screen");
  renderAdminPool();
  renderWinner();
}

let tapCount = 0;
let tapTimer = null;

function resetAdminTaps() {
  tapCount = 0;
  for (let i = 0; i < 5; i++) {
    const d = $("d" + i);
    if (d) d.classList.remove("lit");
  }
}

async function copyText(text) {
  const t = String(text || "");
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
    toast("copied");
  } catch {
    toast("copy failed");
  }
}

async function doSearch() {
  const q = $("film-search").value.trim();
  if (!q) return;
  if (!TMDB_KEY) {
    $("results-list").innerHTML =
      '<p class="searching-msg">set TMDB_API_KEY in Netlify, run build, redeploy</p>';
    return;
  }
  const list = $("results-list");
  list.innerHTML = '<p class="searching-msg">searching...</p>';
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(TMDB_KEY)}&query=${encodeURIComponent(q)}`
    );
    const data = await res.json();
    renderResults(data.results ? data.results.slice(0, 5) : []);
  } catch {
    list.innerHTML = '<p class="searching-msg">search failed</p>';
  }
}

function renderResults(films) {
  const list = $("results-list");
  if (!films.length) {
    list.innerHTML = '<p class="searching-msg">no results</p>';
    return;
  }
  list.innerHTML = "";
  films.forEach((f) => {
    const year = f.release_date ? f.release_date.slice(0, 4) : "";
    const p = f.poster_path ? `https://image.tmdb.org/t/p/w92${f.poster_path}` : null;
    const div = document.createElement("div");
    div.className = "result-item";
    div.innerHTML = `${p ? `<img class="result-poster" src="${p}" alt="">` : '<div class="result-poster-ph"></div>'}
      <div style="flex:1;min-width:0;"><div class="result-title">${escapeHtml(f.title)}</div><div class="result-year">${escapeHtml(year)}</div></div>
      <span class="result-add">+ add</span>`;
    div.addEventListener("click", () => addFilm(f));
    list.appendChild(div);
  });
}

function addFilm(f) {
  const name = $("name-input").value.trim() || "anon";
  const uid =
    "p-" +
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const pick = {
    uid,
    id: f.id,
    title: f.title,
    year: f.release_date ? f.release_date.slice(0, 4) : "",
    poster: f.poster_path,
    addedBy: name,
  };
  state.pool.push(pick);
  state.myPick = pick;
  save();
  $("results-list").innerHTML = "";
  $("film-search").value = "";
  renderMainStats();
  toast(`"${f.title}" added`);
}

function applyCodeFromQuery() {
  try {
    const c = new URLSearchParams(location.search).get("code");
    if (c) $("code-input").value = c.trim().toUpperCase();
  } catch {
    /* ignore */
  }
}

function bindEvents() {
  $("skip-btn").addEventListener("click", () => {
    $("video-modal").classList.remove("open");
    $("yt-frame").src = "";
  });

  $("enter-btn").addEventListener("click", enterSite);
  $("code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") enterSite();
  });

  $("logo-tap").addEventListener("click", () => {
    tapCount++;
    const dot = $("d" + (tapCount - 1));
    if (dot) dot.classList.add("lit");
    clearTimeout(tapTimer);
    if (tapCount >= 5) {
      resetAdminTaps();
      openHostAdmin();
      return;
    }
    tapTimer = setTimeout(resetAdminTaps, 2000);
  });

  $("back-btn").addEventListener("click", () => {
    showScreen("entry-screen");
    resetAdminTaps();
    $("err-msg").textContent = "";
  });

  $("save-settings").addEventListener("click", () => {
    const roomName = $("room-name-input").value.trim();
    if (!roomName) {
      toast("add a room name");
      $("room-name-input").focus();
      return;
    }
    const dt = $("event-dt").value;
    if (!dt) {
      toast("pick date and time");
      $("event-dt").focus();
      return;
    }
    assignJoinCodeForSave();
    state.roomName = roomName;
    state.eventDt = dt;
    state.ytUrl = $("yt-url-input").value.trim();
    save();
    setLastHostCode(currentRoomSlug);
    renderHostJoinPanel();
    renderCountdown();
    toast("room saved — share the join code");
    if ($("main-screen").classList.contains("active")) {
      renderMainStats();
    }
  });

  const startNew = $("start-new-room");
  if (startNew) {
    startNew.addEventListener("click", () => {
      currentRoomSlug = null;
      state = freshState();
      populateHostForm();
      renderHostJoinPanel();
      renderAdminPool();
      renderWinner();
      toast("new screening — name, date, then save");
    });
  }

  const copyCode = $("copy-code-btn");
  if (copyCode) copyCode.addEventListener("click", () => copyText(state.joinCode));
  const copyShare = $("copy-share-btn");
  if (copyShare)
    copyShare.addEventListener("click", () => copyText($("share-url-input").value));

  $("search-btn").addEventListener("click", doSearch);
  $("film-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  $("admin-draw-btn").addEventListener("click", () => {
    if (state.pool.length < 2) return;
    let flashes = 0;
    const total = 16 + Math.floor(Math.random() * 8);
    const btn = $("admin-draw-btn");
    btn.disabled = true;
    const iv = setInterval(() => {
      state.winner = state.pool[Math.floor(Math.random() * state.pool.length)];
      renderWinner();
      flashes++;
      if (flashes >= total) {
        clearInterval(iv);
        save();
        toast(`drawn: ${state.winner.title}`);
        btn.disabled = false;
      }
    }, 80);
  });

  $("admin-clear-btn").addEventListener("click", () => {
    state.pool = [];
    state.winner = null;
    state.myPick = null;
    save();
    renderAdminPool();
    renderWinner();
    toast("pool cleared");
  });
}

bindEvents();
applyCodeFromQuery();
renderCountdown();
