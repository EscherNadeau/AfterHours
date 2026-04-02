/**
 * after.hours — film pool: local (localStorage) or cloud (Supabase + blind submissions).
 * Production: `npm run build` with TMDB_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (Netlify).
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const TMDB_KEY = "";
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

const LEGACY_KEY = "ah_state";
const LAST_HOST_KEY = "ah_last_host_code";
const JOIN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BACKLOG_MAX = 5;
const PICK_META_PREFIX = "ah_pickmeta_";
const HOST_SECRET_PREFIX = "ah_host_";
const PENDING_JOIN_KEY = "ah_pending_join_code";

const sb =
  String(SUPABASE_URL || "").trim() && String(SUPABASE_ANON_KEY || "").trim()
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

function isCloudMode() {
  return !!sb;
}

const DEV_FILMS = [
  { id: -101, title: "After Hours", release_date: "1985-09-13", poster_path: null },
  { id: -102, title: "Blade Runner", release_date: "1982-06-25", poster_path: null },
  { id: -103, title: "Saint Maud", release_date: "2020-10-09", poster_path: null },
  { id: -104, title: "The Nice Guys", release_date: "2016-05-20", poster_path: null },
  { id: -105, title: "Perfect Blue", release_date: "1998-02-28", poster_path: null },
  { id: -106, title: "Columbus", release_date: "2017-08-04", poster_path: null },
  { id: -107, title: "Punch-Drunk Love", release_date: "2002-11-01", poster_path: null },
  { id: -108, title: "Toni Erdmann", release_date: "2016-07-14", poster_path: null },
];

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
    roomId: null,
    roomPublic: null,
    myBacklog: [],
    awaitingRepick: false,
    pickFinal: false,
    devPresenterIndex: 0,
    devNoShowSlots: [],
  };
}

function devModeOn() {
  try {
    return new URLSearchParams(location.search).get("dev") === "1";
  } catch {
    return false;
  }
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

function pickMetaKey(roomId) {
  return PICK_META_PREFIX + roomId;
}

function hostSecretStorageKey(code) {
  return HOST_SECRET_PREFIX + normalizeJoinCode(code).toLowerCase();
}

function getHostSecretForCode(code) {
  try {
    return localStorage.getItem(hostSecretStorageKey(code));
  } catch {
    return null;
  }
}

function setHostSecretForCode(code, secret) {
  try {
    localStorage.setItem(hostSecretStorageKey(code), String(secret).trim());
  } catch {
    /* ignore */
  }
}

function getPickMeta(roomId) {
  if (!roomId) return { pickFinal: false, awaitingRepick: false };
  try {
    const raw = localStorage.getItem(pickMetaKey(roomId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      pickFinal: !!o.pickFinal,
      awaitingRepick: !!o.awaitingRepick,
    };
  } catch {
    return null;
  }
}

function setPickMeta(roomId, meta) {
  if (!roomId) return;
  try {
    localStorage.setItem(pickMetaKey(roomId), JSON.stringify(meta));
  } catch {
    /* ignore */
  }
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

function applyBuildMode() {
  document.querySelectorAll(".cloud-only").forEach((el) => {
    el.hidden = !isCloudMode();
  });
  document.querySelectorAll(".local-only").forEach((el) => {
    el.hidden = isCloudMode();
  });
  document.querySelectorAll(".cloud-field").forEach((el) => {
    el.hidden = !isCloudMode();
  });
  const auth = $("auth-block");
  if (auth) auth.hidden = !isCloudMode();
  const hint = $("offline-hint");
  if (hint) {
    hint.hidden = isCloudMode();
    hint.textContent = isCloudMode()
      ? ""
      : "Running without Supabase: picks stay on this device only. Set SUPABASE_URL and SUPABASE_ANON_KEY for the club sync.";
  }
  const pch = $("pick-cloud-hint");
  if (pch) pch.hidden = !isCloudMode();
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
    if (!Array.isArray(state.myBacklog)) state.myBacklog = [];
    if (typeof state.awaitingRepick !== "boolean") state.awaitingRepick = false;
    if (typeof state.pickFinal !== "boolean") state.pickFinal = false;
    if (typeof state.devPresenterIndex !== "number") state.devPresenterIndex = 0;
    if (!Array.isArray(state.devNoShowSlots)) state.devNoShowSlots = [];
    ensurePickUids();
  } catch {
    state = { ...base };
  }
}

function save() {
  if (!currentRoomSlug || isCloudMode()) return;
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
  const mainOut = $("main-sign-out-btn");
  if (mainOut) mainOut.hidden = !(isCloudMode() && id === "main-screen");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** For <input type="datetime-local"> from an ISO instant. */
function isoToDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 16);
}

function rpcFirstRow(data) {
  if (data == null) return null;
  return Array.isArray(data) ? data[0] ?? null : data;
}

function fmtLocalRange(openIso, closeIso) {
  if (!openIso || !closeIso) return "Submission times not set.";
  const a = new Date(openIso);
  const b = new Date(closeIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "Submission times not set.";
  const opt = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return `Open ${a.toLocaleString(undefined, opt) } → close ${b.toLocaleString(undefined, opt)}`;
}

function renderSubmissionWindowLine() {
  const el = $("submission-window-line");
  if (!el) return;
  if (!isCloudMode() || !state.roomPublic) {
    el.textContent = "—";
    return;
  }
  const rp = state.roomPublic;
  el.textContent = fmtLocalRange(rp.submissions_open_at, rp.submissions_close_at);
}

function submissionsWindowStatus(now, openAt, closeAt) {
  const t = now.getTime();
  const o = new Date(openAt).getTime();
  const c = new Date(closeAt).getTime();
  if (Number.isNaN(o) || Number.isNaN(c)) return "unknown";
  if (t < o) return "before_open";
  if (t > c) return "closed";
  return "open";
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

function backlogUl() {
  return isCloudMode() ? $("backlog-list-cloud") : $("backlog-list");
}

function renderPoolPeek() {
  const ul = $("pool-peek-list");
  if (!ul) return;
  if (!state.pool.length) {
    ul.innerHTML =
      '<li class="board-placeholder">No films in the pool on this device yet.</li>';
    return;
  }
  ul.innerHTML = state.pool
    .map(
      (p) =>
        `<li>${escapeHtml(p.title)}${p.year ? " (" + escapeHtml(p.year) + ")" : ""}<span class="board-by">by ${escapeHtml(p.addedBy)}</span></li>`
    )
    .join("");
}

function renderBacklog() {
  const ul = backlogUl();
  if (!ul) return;
  if (!state.myBacklog.length) {
    ul.innerHTML =
      '<li class="board-placeholder">Nothing saved yet — use “next week” on a search result.</li>';
    return;
  }
  ul.innerHTML = state.myBacklog
    .map(
      (b) =>
        `<li>${escapeHtml(b.title)}${b.year ? " (" + escapeHtml(b.year) + ")" : ""}</li>`
    )
    .join("");
}

function syncPickMetaFromServerRow() {
  if (!isCloudMode() || !state.roomId) return;
  const meta = getPickMeta(state.roomId);
  if (meta) {
    state.pickFinal = meta.pickFinal;
    state.awaitingRepick = meta.awaitingRepick;
    return;
  }
  if (state.myPick) {
    state.pickFinal = true;
    state.awaitingRepick = false;
    setPickMeta(state.roomId, { pickFinal: true, awaitingRepick: false });
  } else {
    state.pickFinal = false;
    state.awaitingRepick = false;
  }
}

function renderPickStatusAndActions() {
  const status = $("pick-status-line");
  const actions = $("my-pick-actions");
  if (!status || !actions) return;
  if (!state.myPick) {
    status.hidden = true;
    status.textContent = "";
    actions.innerHTML = "";
    return;
  }

  if (isCloudMode() && state.roomPublic) {
    const st = submissionsWindowStatus(
      new Date(),
      state.roomPublic.submissions_open_at,
      state.roomPublic.submissions_close_at
    );
    if (st === "before_open") {
      status.hidden = false;
      status.textContent = "Submissions are not open yet.";
      actions.innerHTML = "";
      return;
    }
    if (st === "closed") {
      status.hidden = false;
      status.textContent = "Submission window closed.";
      actions.innerHTML = "";
      return;
    }
  }

  if (state.pickFinal) {
    status.hidden = false;
    status.textContent = "Locked in for this week — ask the host if something went wrong.";
    actions.innerHTML = "";
    return;
  }
  status.hidden = false;
  status.textContent = "You can still change this once if you have a better idea.";
  actions.innerHTML =
    '<button type="button" class="btn-text" id="change-pick-btn">change my pick (one time)</button>';
  const btn = $("change-pick-btn");
  if (btn) btn.addEventListener("click", beginChangePick);
}

function renderMainStats() {
  const filmCount = $("film-count-stat");
  if (filmCount) filmCount.textContent = state.pool.length;
  renderRoomTitle();
  const devP = $("dev-panel");
  if (devP) devP.hidden = !devModeOn() || isCloudMode();
  renderDevLadder();
  if (!isCloudMode()) renderPoolPeek();
  renderBacklog();
  renderSubmissionWindowLine();
  const rb = $("room-badge");
  if (rb && state.joinCode) {
    rb.textContent = "code · " + state.joinCode;
    rb.title = "Join code: " + state.joinCode;
  }
  const repickBanner = $("repick-banner");
  if (repickBanner) repickBanner.hidden = !(state.awaitingRepick && !state.myPick);

  if (state.awaitingRepick && !state.myPick) {
    $("add-section").style.display = "flex";
    $("my-pick-section").style.display = "none";
  } else if (state.myPick) {
    $("add-section").style.display = "none";
    $("my-pick-section").style.display = "flex";
    const f = state.myPick;
    const p = f.poster ? `https://image.tmdb.org/t/p/w92${f.poster}` : null;
    $("my-pick-inner").innerHTML = `${p ? `<img class="my-poster" src="${p}" alt="">` : '<div class="my-poster-ph"></div>'}
      <div><div class="my-title">${escapeHtml(f.title)}</div><div class="my-year">${escapeHtml(f.year)}</div><div class="my-by">submitted by ${escapeHtml(f.addedBy)}</div></div>`;
    renderPickStatusAndActions();
  } else {
    $("add-section").style.display = "flex";
    $("my-pick-section").style.display = "none";
    renderPickStatusAndActions();
  }
}

function renderDevLadder() {
  const wrap = $("dev-ladder-wrap");
  const list = $("dev-ladder");
  const line = $("dev-active-line");
  const slotSpan = $("dev-active-slot");
  if (!wrap || !list || !line || !slotSpan) return;
  if (!devModeOn() || isCloudMode() || state.pool.length < 1) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const top = state.pool.slice(0, 3);
  let html = "";
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const skipped = state.devNoShowSlots.includes(i);
    const active = i === state.devPresenterIndex && !skipped;
    let cls = "";
    if (skipped) cls = " is-skipped";
    else if (active) cls = " is-active";
    html += `<li class="${cls.trim()}">${escapeHtml(p.addedBy)} — ${escapeHtml(p.title)} (${escapeHtml(p.year)})</li>`;
  }
  list.innerHTML = html;
  const cur = top[state.devPresenterIndex];
  const humanSlot = state.devPresenterIndex + 1;
  slotSpan.textContent = String(humanSlot);
  if (cur && !state.devNoShowSlots.includes(state.devPresenterIndex)) {
    line.textContent = `Showing line-up #${humanSlot}: ${cur.title} — submitted by ${cur.addedBy}`;
  } else {
    line.textContent = "No more fallbacks in the top three.";
  }
}

function shuffleInPlace(arr) {
  const a = arr;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seedDevRandomPicks() {
  if (!devModeOn() || isCloudMode()) return;
  const deck = DEV_FILMS.slice();
  shuffleInPlace(deck);
  const guestNames = ["Dev guest 1", "Dev guest 2", "Dev guest 3"];
  for (let i = 0; i < 3 && deck.length; i++) {
    const film = deck[i];
    const uid =
      "p-dev-" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36));
    const pick = {
      uid,
      id: film.id,
      title: film.title,
      year: film.release_date ? film.release_date.slice(0, 4) : "",
      poster: film.poster_path,
      addedBy: guestNames[i],
    };
    state.pool.push(pick);
  }
  state.devPresenterIndex = 0;
  state.devNoShowSlots = [];
  save();
  renderMainStats();
  toast("dev: added 3 random picks");
}

function devAdvanceFallback() {
  if (!devModeOn() || isCloudMode()) return;
  const topLen = Math.min(3, state.pool.length);
  if (topLen < 1) return;
  if (!state.devNoShowSlots.includes(state.devPresenterIndex)) {
    state.devNoShowSlots.push(state.devPresenterIndex);
  }
  let next = state.devPresenterIndex + 1;
  while (next < topLen && state.devNoShowSlots.includes(next)) next++;
  if (next < topLen) {
    state.devPresenterIndex = next;
  } else {
    toast("no further pick in top 3");
  }
  save();
  renderDevLadder();
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function mapSubmissionRow(row) {
  return {
    uid: row.id,
    id: row.tmdb_id,
    title: row.title,
    year: row.year || "",
    poster: row.poster_path,
    addedBy: row.display_name,
  };
}

function renderAdminPool() {
  const list = $("admin-pool-list");
  if (!list) return;
  $("admin-pool-count").textContent = state.pool.length;

  let drawDisabled = state.pool.length < 2;
  const hint = $("host-draw-hint");
  if (isCloudMode() && state.roomPublic) {
    const st = submissionsWindowStatus(
      new Date(),
      state.roomPublic.submissions_open_at,
      state.roomPublic.submissions_close_at
    );
    if (st !== "closed") drawDisabled = true;
    if (hint) {
      hint.hidden = false;
      if (st !== "closed") {
        hint.textContent = "Draw unlocks after the submission close time.";
      } else {
        hint.textContent = "Window closed — you can draw from the pool.";
      }
    }
  } else if (hint) hint.hidden = true;

  $("admin-draw-btn").disabled = drawDisabled;

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
      ${isCloudMode() ? "" : `<button type="button" class="del-btn" data-i="${i}">remove</button>`}`;
    list.appendChild(row);
  });
  if (!isCloudMode()) {
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
}

function renderWinner() {
  const el = $("winner-display");
  const slip = $("slip-row");
  if (!el) return;
  if (!state.winner) {
    el.innerHTML = "";
    if (slip) slip.hidden = true;
    return;
  }
  const f = state.winner;
  const p = f.poster ? `https://image.tmdb.org/t/p/w92${f.poster}` : null;
  el.innerHTML = `<div class="winner-row">${p ? `<img class="pool-row-poster" src="${p}" alt="">` : ""}
    <div style="flex:1;min-width:0;"><div class="winner-label">drawn film</div><div class="winner-title">${escapeHtml(f.title)}</div><div class="winner-year">${escapeHtml(f.year)}</div></div>
  </div>`;
  if (slip) slip.hidden = !isCloudMode();
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
    if (devModeOn()) u.searchParams.set("dev", "1");
    return u.toString();
  } catch {
    return "";
  }
}

function toIsoFromDatetimeLocal(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function populateHostForm() {
  $("room-name-input").value = state.roomName || "";
  $("event-dt").value = state.eventDt || "";
  $("yt-url-input").value = state.ytUrl || "";
  if (isCloudMode()) {
    const so = $("submissions-open-dt");
    const sc = $("submissions-close-dt");
    if (state.roomPublic && so && sc) {
      so.value = state.roomPublic.submissions_open_at
        ? isoToDatetimeLocalValue(state.roomPublic.submissions_open_at)
        : "";
      sc.value = state.roomPublic.submissions_close_at
        ? isoToDatetimeLocalValue(state.roomPublic.submissions_close_at)
        : "";
    }
  }
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
  refreshInviteRedirect();
}

/** Invite emails use this as Supabase redirectTo (must be allowlisted in the project). */
function refreshInviteRedirect() {
  const el = $("invite-redirect-to");
  if (!el || !isCloudMode()) return;
  const code = normalizeJoinCode(state.joinCode || getLastHostCode() || "");
  if (code.length >= 6) {
    el.value = shareJoinUrl(code);
  } else {
    try {
      const u = new URL(window.location.href);
      el.value = u.origin + u.pathname;
    } catch {
      el.value = "";
    }
  }
}

async function fetchRoomPublic(code) {
  const { data, error } = await sb.rpc("get_room_public", { p_join_code: code });
  if (error) throw error;
  return rpcFirstRow(data);
}

async function refreshMySubmission() {
  if (!isCloudMode() || !state.roomId) return;
  const { data, error } = await sb.rpc("get_my_submission", { p_room_id: state.roomId });
  if (error) {
    console.error(error);
    state.myPick = null;
    return;
  }
  const rows = data || [];
  state.myPick = rows[0] ? mapSubmissionRow(rows[0]) : null;
  syncPickMetaFromServerRow();
}

async function loadHostPoolFromServer() {
  if (!isCloudMode() || !state.roomId) return;
  const secret = getHostSecretForCode(state.joinCode);
  if (!secret) {
    state.pool = [];
    return;
  }
  const { data, error } = await sb.rpc("host_list_submissions", {
    p_room_id: state.roomId,
    p_host_secret: secret,
  });
  if (error) {
    console.error(error);
    toast(error.message || "host pool failed");
    state.pool = [];
    return;
  }
  state.pool = (data || []).map(mapSubmissionRow);
}

async function enterSite() {
  const code = normalizeJoinCode($("code-input").value);
  if (code.length < 6) {
    $("err-msg").textContent = "enter the 6-character join code";
    $("code-input").focus();
    return;
  }

  if (isCloudMode()) {
    const { data: sess } = await sb.auth.getSession();
    if (!sess?.session) {
      $("err-msg").textContent = "sign in with your invited email first";
      return;
    }
    try {
      const row = await fetchRoomPublic(code);
      if (!row) {
        $("err-msg").textContent = "no room with that code";
        $("code-input").value = "";
        $("code-input").focus();
        return;
      }
      $("err-msg").textContent = "";
      state.joinCode = normalizeJoinCode(row.join_code);
      currentRoomSlug = state.joinCode;
      state.roomId = row.id;
      state.roomPublic = row;
      state.roomName = row.room_name || "";
      state.eventDt = row.event_dt ? isoToDatetimeLocalValue(row.event_dt) : "";
      state.ytUrl = row.yt_url || "";
      state.pool = [];
      state.winner = null;
      await refreshMySubmission();
      showScreen("main-screen");
      renderCountdown();
      renderMainStats();
      openVideoModal();
      clearPendingJoinCode();
      return;
    } catch (e) {
      $("err-msg").textContent = e.message || "could not load room";
      return;
    }
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

async function openHostAdmin() {
  if (isCloudMode()) {
    const last = getLastHostCode();
    const lastNorm = last ? normalizeJoinCode(last) : "";
    if (lastNorm) {
      try {
        const row = await fetchRoomPublic(lastNorm);
        if (row) {
          state.joinCode = lastNorm;
          currentRoomSlug = lastNorm;
          state.roomId = row.id;
          state.roomPublic = row;
          state.roomName = row.room_name || "";
          state.eventDt = row.event_dt ? isoToDatetimeLocalValue(row.event_dt) : "";
          state.ytUrl = row.yt_url || "";
          await loadHostPoolFromServer();
        } else {
          state = freshState();
          currentRoomSlug = null;
        }
      } catch {
        state = freshState();
        currentRoomSlug = null;
      }
    } else {
      state = freshState();
      currentRoomSlug = null;
    }
  } else {
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
      <div class="result-actions">
        <button type="button" class="result-add-btn">+ add</button>
        <button type="button" class="result-later">next week</button>
      </div>`;
    div.querySelector(".result-add-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      addFilm(f);
    });
    div.querySelector(".result-later").addEventListener("click", (e) => {
      e.stopPropagation();
      saveForLater(f);
    });
    list.appendChild(div);
  });
}

function saveForLater(f) {
  if (state.myBacklog.length >= BACKLOG_MAX) {
    toast(`backlog full (${BACKLOG_MAX}) — remove ideas next week on paper`);
    return;
  }
  const id = f.id;
  if (state.myBacklog.some((x) => x.id === id)) {
    toast("already saved for later");
    return;
  }
  state.myBacklog.push({
    id,
    title: f.title,
    year: f.release_date ? f.release_date.slice(0, 4) : "",
    poster: f.poster_path,
  });
  save();
  renderBacklog();
  toast("saved for next week (this device only)");
}

async function beginChangePick() {
  if (!state.myPick || state.pickFinal || state.awaitingRepick) return;
  if (isCloudMode()) {
    if (!state.roomId) return;
    const { error } = await sb.rpc("delete_my_submission", { p_room_id: state.roomId });
    if (error) {
      toast(error.message || "could not clear pick");
      return;
    }
    state.myPick = null;
    state.awaitingRepick = true;
    state.pickFinal = false;
    setPickMeta(state.roomId, { pickFinal: false, awaitingRepick: true });
  } else {
    const uid = state.myPick.uid;
    const idx = state.pool.findIndex((p) => p.uid === uid);
    if (idx >= 0) state.pool.splice(idx, 1);
    if (
      state.winner &&
      state.winner.uid &&
      state.winner.uid === uid
    ) {
      state.winner = null;
    }
    state.myPick = null;
    state.awaitingRepick = true;
    save();
  }
  $("results-list").innerHTML = "";
  renderMainStats();
  toast("pick a replacement");
}

async function addFilm(f) {
  if (state.pickFinal && state.myPick) {
    toast("pick is final for this week");
    return;
  }
  if (state.myPick && !state.awaitingRepick) {
    toast("use change my pick first");
    return;
  }

  const name = $("name-input").value.trim() || "anon";
  const firstCommit = !state.awaitingRepick && !state.myPick;
  if (firstCommit) {
    if (
      !confirm(
        "Lock in this film for tonight? You get one change after this; then it’s final."
      )
    ) {
      return;
    }
  }

  if (isCloudMode()) {
    if (!state.roomId) {
      toast("join a room first");
      return;
    }
    const st = submissionsWindowStatus(
      new Date(),
      state.roomPublic.submissions_open_at,
      state.roomPublic.submissions_close_at
    );
    if (st !== "open") {
      toast("submissions are not open for this room");
      return;
    }
    const year = f.release_date ? f.release_date.slice(0, 4) : "";
    const { error } = await sb.rpc("upsert_my_submission", {
      p_room_id: state.roomId,
      p_display_name: name.slice(0, 80),
      p_tmdb_id: f.id,
      p_title: f.title,
      p_year: year,
      p_poster_path: f.poster_path || null,
    });
    if (error) {
      toast(error.message || "submit failed");
      return;
    }
    await refreshMySubmission();
    if (state.awaitingRepick) {
      state.awaitingRepick = false;
      state.pickFinal = true;
      setPickMeta(state.roomId, { pickFinal: true, awaitingRepick: false });
    } else {
      state.pickFinal = false;
      setPickMeta(state.roomId, { pickFinal: false, awaitingRepick: false });
    }
  } else {
    if (state.pickFinal && state.myPick) {
      toast("pick is final for this week");
      return;
    }
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
    if (state.awaitingRepick) {
      state.awaitingRepick = false;
      state.pickFinal = true;
    }
    save();
  }

  $("results-list").innerHTML = "";
  $("film-search").value = "";
  renderMainStats();
  toast(`"${f.title}" added`);
}

/** Full URL for magic-link return — keeps ?code= so the room survives the email round-trip. */
function buildMagicLinkRedirectUrl() {
  let u;
  try {
    u = new URL(window.location.href);
  } catch {
    return `${window.location.origin}/`;
  }
  const fromQuery = normalizeJoinCode(new URLSearchParams(u.search).get("code") || "");
  const fromInput = normalizeJoinCode($("code-input")?.value || "");
  const code = fromQuery.length >= 6 ? fromQuery : fromInput;
  if (code.length >= 6) u.searchParams.set("code", code);
  else u.searchParams.delete("code");
  if (devModeOn()) u.searchParams.set("dev", "1");
  else u.searchParams.delete("dev");
  return u.origin + u.pathname + u.search;
}

function persistPendingJoinCode(code) {
  const c = normalizeJoinCode(code || "");
  if (c.length < 6) return;
  try {
    localStorage.setItem(PENDING_JOIN_KEY, c);
  } catch {
    /* ignore */
  }
}

function clearPendingJoinCode() {
  try {
    localStorage.removeItem(PENDING_JOIN_KEY);
  } catch {
    /* ignore */
  }
}

function applyCodeFromQuery() {
  try {
    const c = new URLSearchParams(location.search).get("code");
    if (c) {
      const norm = normalizeJoinCode(c);
      $("code-input").value = norm;
      persistPendingJoinCode(norm);
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    const pending = localStorage.getItem(PENDING_JOIN_KEY);
    if (pending && !$("code-input")?.value) {
      $("code-input").value = normalizeJoinCode(pending);
    }
  } catch {
    /* ignore */
  }
}

async function maybeAutoEnterRoomAfterAuth() {
  if (!isCloudMode() || !sb) return;
  if (!$("entry-screen")?.classList.contains("active")) return;
  applyCodeFromQuery();
  const code = normalizeJoinCode($("code-input")?.value || "");
  if (code.length < 6) return;
  const { data: sess } = await sb.auth.getSession();
  if (!sess?.session) return;
  $("err-msg").textContent = "";
  await enterSite();
}

async function createRoomOnServer() {
  const roomName = $("room-name-input").value.trim();
  if (!roomName) {
    toast("add a room name");
    $("room-name-input").focus();
    return;
  }
  const dt = $("event-dt").value;
  if (!dt) {
    toast("pick screening date and time");
    $("event-dt").focus();
    return;
  }
  const openV = $("submissions-open-dt")?.value;
  const closeV = $("submissions-close-dt")?.value;
  const openIso = toIsoFromDatetimeLocal(openV);
  const closeIso = toIsoFromDatetimeLocal(closeV);
  if (!openIso || !closeIso) {
    toast("set submissions open and close");
    return;
  }
  const pin = ($("host-pin-input")?.value || "").trim();
  if (!pin) {
    toast("enter the host PIN (Netlify CLUB_HOST_PIN)");
    return;
  }

  let res;
  try {
    res = await fetch("/.netlify/functions/create-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pin,
        room_name: roomName,
        event_dt: toIsoFromDatetimeLocal(dt),
        yt_url: $("yt-url-input").value.trim(),
        submissions_open_at: openIso,
        submissions_close_at: closeIso,
      }),
    });
  } catch (e) {
    toast("network error — is the site on Netlify?");
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(body.error || "create room failed");
    return;
  }
  state.joinCode = normalizeJoinCode(body.join_code);
  currentRoomSlug = state.joinCode;
  state.roomId = body.id;
  setHostSecretForCode(state.joinCode, body.host_secret);
  setLastHostCode(state.joinCode);
  try {
    const row = await fetchRoomPublic(state.joinCode);
    state.roomPublic = row;
    state.roomName = row.room_name || "";
    state.eventDt = row.event_dt ? isoToDatetimeLocalValue(row.event_dt) : "";
    state.ytUrl = row.yt_url || "";
  } catch {
    /* ignore */
  }
  populateHostForm();
  renderHostJoinPanel();
  await loadHostPoolFromServer();
  renderAdminPool();
  renderWinner();
  toast("screening created — save the host key on this device");
}

async function sendInvitesFromHost() {
  if (!isCloudMode()) return;
  const raw = ($("invite-emails")?.value || "").trim();
  if (!raw) {
    toast("add at least one email");
    return;
  }
  const pin = ($("host-pin-input")?.value || "").trim();
  if (!pin) {
    toast("enter the host PIN (same as create screening)");
    return;
  }
  const redirectTo = ($("invite-redirect-to")?.value || "").trim();
  if (!redirectTo) {
    toast("missing redirect URL — open host panel with a join code set");
    return;
  }
  const joinCode = normalizeJoinCode(state.joinCode || getLastHostCode() || "");
  const roomName = (state.roomName || "").trim();

  let res;
  try {
    res = await fetch("/.netlify/functions/invite-members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pin,
        emails: raw,
        redirect_to: redirectTo,
        ...(joinCode.length >= 6 ? { join_code: joinCode } : {}),
        ...(roomName ? { room_name: roomName } : {}),
      }),
    });
  } catch {
    toast("network error — is the site on Netlify?");
    return;
  }
  const body = await res.json().catch(() => ({}));
  const pre = $("invite-results");
  if (pre) {
    pre.hidden = false;
    if (body.results && Array.isArray(body.results)) {
      const lines = body.results.map((r) =>
        r.ok ? `✓ ${r.email}` : `✗ ${r.email}: ${r.error}`
      );
      pre.textContent = `Invited: ${body.invited ?? 0}, failed: ${body.failed ?? 0}\n${lines.join("\n")}`;
    } else {
      pre.textContent = body.error ? String(body.error) : JSON.stringify(body, null, 2);
    }
  }
  if (!res.ok) {
    toast(body.error || "invite request failed");
    return;
  }
  toast(`Sent ${body.invited ?? 0} invite(s)`);
}

function bindEvents() {
  $("skip-btn").addEventListener("click", () => {
    $("video-modal").classList.remove("open");
    $("yt-frame").src = "";
  });

  $("enter-btn").addEventListener("click", () => enterSite());
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

  const createBtn = $("create-room-btn");
  if (createBtn) createBtn.addEventListener("click", () => createRoomOnServer());

  const saveHostSecret = $("save-host-secret-btn");
  if (saveHostSecret) {
    saveHostSecret.addEventListener("click", async () => {
      const code = normalizeJoinCode(state.joinCode || getLastHostCode() || "");
      const secret = ($("attach-host-secret")?.value || "").trim();
      if (code.length < 6) {
        toast("create or load a room first (join code)");
        return;
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(secret)) {
        toast("paste a valid host key (UUID)");
        return;
      }
      state.joinCode = code;
      setHostSecretForCode(code, secret);
      setLastHostCode(code);
      try {
        const row = await fetchRoomPublic(code);
        if (!row) {
          toast("invalid join code");
          return;
        }
        state.roomId = row.id;
        state.roomPublic = row;
        state.roomName = row.room_name || "";
        state.eventDt = row.event_dt ? isoToDatetimeLocalValue(row.event_dt) : "";
        state.ytUrl = row.yt_url || "";
        await loadHostPoolFromServer();
        renderAdminPool();
        renderWinner();
        refreshInviteRedirect();
        toast("host key saved on this device");
      } catch (e) {
        toast(e.message || "failed");
      }
    });
  }

  const sendInvitesBtn = $("send-invites-btn");
  if (sendInvitesBtn) {
    sendInvitesBtn.addEventListener("click", () => sendInvitesFromHost());
  }

  const startNew = $("start-new-room");
  if (startNew) {
    startNew.addEventListener("click", () => {
      currentRoomSlug = null;
      state = freshState();
      populateHostForm();
      renderHostJoinPanel();
      renderAdminPool();
      renderWinner();
      toast(isCloudMode() ? "new screening — fill the form and create" : "new screening — name, date, then save");
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

  $("admin-draw-btn").addEventListener("click", async () => {
    if (state.pool.length < 2) return;
    if (isCloudMode()) {
      const secret = getHostSecretForCode(state.joinCode);
      if (!secret) {
        toast("save the host key first");
        return;
      }
      const btn = $("admin-draw-btn");
      btn.disabled = true;
      let flashes = 0;
      const total = 16 + Math.floor(Math.random() * 8);
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          const pick = state.pool[Math.floor(Math.random() * state.pool.length)];
          state.winner = pick;
          renderWinner();
          flashes++;
          if (flashes >= total) {
            clearInterval(iv);
            resolve();
          }
        }, 80);
      });
      try {
        const { data, error } = await sb.rpc("host_draw_winner", {
          p_room_id: state.roomId,
          p_host_secret: secret,
        });
        if (error) {
          toast(error.message || "draw failed");
          state.winner = null;
          renderWinner();
        } else {
          const row = rpcFirstRow(data);
          if (row) {
            state.winner = mapSubmissionRow(row);
            await loadHostPoolFromServer();
            renderAdminPool();
            renderWinner();
            toast(`drawn: ${state.winner.title}`);
          }
        }
      } catch (e) {
        toast(e.message || "draw failed");
      }
      btn.disabled = false;
      return;
    }
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

  const clearBtn = $("admin-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.pool = [];
      state.winner = null;
      state.myPick = null;
      state.awaitingRepick = false;
      state.pickFinal = false;
      state.devPresenterIndex = 0;
      state.devNoShowSlots = [];
      save();
      renderAdminPool();
      renderWinner();
      toast("pool cleared");
    });
  }

  const devSeed = $("dev-seed-btn");
  if (devSeed) devSeed.addEventListener("click", seedDevRandomPicks);
  const devNext = $("dev-next-fallback-btn");
  if (devNext) devNext.addEventListener("click", devAdvanceFallback);

  const slip = $("copy-slip-btn");
  if (slip) {
    slip.addEventListener("click", () => {
      if (!state.winner?.title) return;
      copyText(state.winner.title);
    });
  }
  const rev = $("copy-reveal-btn");
  if (rev) {
    rev.addEventListener("click", () => {
      if (!state.winner?.title) return;
      copyText(
        `Tonight’s film is “${state.winner.title}”${state.winner.year ? ` (${state.winner.year})` : ""}.`
      );
    });
  }

  const magic = $("send-magic-btn");
  if (magic) {
    magic.addEventListener("click", async () => {
      const email = ($("auth-email")?.value || "").trim();
      const st = $("auth-status");
      if (!email) {
        if (st) {
          st.hidden = false;
          st.textContent = "Enter your email.";
        }
        return;
      }
      const codeForLink = normalizeJoinCode(
        $("code-input")?.value || new URLSearchParams(location.search).get("code") || ""
      );
      if (codeForLink.length >= 6) persistPendingJoinCode(codeForLink);
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: buildMagicLinkRedirectUrl() },
      });
      if (st) st.hidden = false;
      if (error) {
        if (st) st.textContent = error.message;
        return;
      }
      if (st) st.textContent = "Check your email for the sign-in link.";
    });
  }

  const so = $("entry-sign-out-btn");
  if (so) so.addEventListener("click", () => signOutClicked());
  const mo = $("main-sign-out-btn");
  if (mo) mo.addEventListener("click", () => signOutClicked());
}

async function signOutClicked() {
  if (sb) await sb.auth.signOut();
  updateAuthChrome();
  toast("signed out");
}

function updateAuthChrome() {
  const out = $("entry-sign-out-btn");
  const email = $("auth-email");
  const st = $("auth-status");
  if (!sb) return;
  sb.auth.getSession().then(({ data }) => {
    const s = data.session;
    if (out) out.hidden = !s;
    if (email && s?.user?.email) email.value = s.user.email;
    if (st && s) {
      st.hidden = false;
      st.textContent = `Signed in as ${s.user.email}`;
    }
  });
}

applyBuildMode();
bindEvents();
applyCodeFromQuery();
renderCountdown();
if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    updateAuthChrome();
    if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
      void maybeAutoEnterRoomAfterAuth();
    }
  });
  updateAuthChrome();
}
