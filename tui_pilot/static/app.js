// tui-pilot agent control panel — multi-session, id-keyed. Talks only to the HTTP API.
"use strict";

const $ = (id) => document.getElementById(id);
const el = {
  role: $("role"), roleDesc: $("roleDesc"), name: $("name"), cwd: $("cwd"),
  mode: $("mode"), modeWarn: $("modeWarn"), instructions: $("instructions"),
  task: $("task"), spawn: $("btnSpawn"),
  killAll: $("btnKillAll"), agents: $("agents"), summary: $("summary"),
  tabAgents: $("tabAgents"), tabInbox: $("tabInbox"), inboxBadge: $("inboxBadge"),
  inbox: $("inbox"),
  screen: $("screen"), prompt: $("prompt"), send: $("btnSend"),
  focusTitle: $("focusTitle"), focusPill: $("focusPill"), focusState: $("focusState"),
  approve: $("btnApprove"), deny: $("btnDeny"), interrupt: $("btnInterrupt"),
  keyBtn: $("btnKey"), customKey: $("customKey"), hist: $("histChk"), poll: $("pollChk"),
  json: $("json"), copyJson: $("btnCopyJson"), log: $("log"),
  answer: $("answerCard"), report: $("reportCard"), menu: $("menuCard"),
  orchBtn: $("btnOrch"), brakes: $("brakesStrip"), missionActivity: $("missionActivity"),
};

let roles = [];
let sessions = [];          // latest GET /sessions snapshot
let accounts = [];          // latest GET /accounts snapshot
let allProjects = [];       // latest GET /projects snapshot
let currentProjectId = null; // current-project id
let current = null;         // focused session id
let pending = new Set();    // session ids with an in-flight prompt
let lastJson = "{ }";
let spawnCount = 0;
let inboxOpen = false;
let focusSignal = null;     // cached open signal for the focused agent
let focusReport = null;     // cached report text for the focused agent
let orchId = null;          // the orchestrator session id (once known)
let missions = [];          // latest GET /missions snapshot

// ---- utilities ------------------------------------------------------------

function log(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.log.prepend(line);
}

const esc = (t) => (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function showJson(label, value) {
  const pretty = JSON.stringify(value, null, 2);
  lastJson = pretty;
  const e = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = e(pretty)
    .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="s">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="n">$1</span>');
  el.json.innerHTML = (label ? `<span class="k">// ${label}</span>\n` : "") + html;
}

async function api(method, path, body, label) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = (data && data.detail) || res.statusText;
    if (label) showJson(`${method} ${path} → ${res.status}`, { error: detail });
    throw new Error(`${res.status} ${detail}`);
  }
  if (label && data && typeof data === "object") showJson(`${method} ${path}`, data);
  return data;
}

const findSession = (id) => sessions.find((s) => s.id === id);
const blockedSessions = () => sessions.filter((s) => s.harness_state === "blocked");
const isOrch = (s) => s && (s.role === "orchestrator" || s.id === orchId);
const accountById = (id) => accounts.find((a) => a.id === id);
const accountColor = (id) => { const a = accountById(id); return (a && a.color) || "#8b949e"; };
const accountInitials = (a) => (a.label || a.id).slice(0, 2).toUpperCase();

// A session "needs attention" if a harness signal is blocking OR the TUI itself
// is showing a permission/input dialog that only a human can resolve.
function needsAttention(s) {
  return s.harness_state === "blocked" || s.has_menu
    || s.state === "AWAITING_PERMISSION" || s.state === "AWAITING_INPUT";
}

// is this session "working" for grouping purposes?
function isWorking(s) {
  if (needsAttention(s) || s.harness_state === "done") return false;
  if (s.state === "THINKING" || s.state === "STREAMING" || s.state === "BOOTING") return true;
  if (s.prep && s.prep !== "ready" && s.prep !== "error") return true;
  if (pending.has(s.id)) return true;
  return false;
}

// ---- view switching -------------------------------------------------------

let currentView = "fleet";

function switchView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => {
    v.style.display = v.id === `view-${name}` ? "flex" : "none";
  });
  document.querySelectorAll(".rail-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  // Refresh pages when switching to them
  if (name === "accounts") { loadAccounts().then(renderAccountsPage); }
  if (name === "projects") renderProjectsPage();
  if (name === "agents") renderRolesPage();
  if (name === "backlog") renderBacklog();
}

document.querySelectorAll(".rail-btn").forEach((b) => {
  b.onclick = () => switchView(b.dataset.view);
});

// ---- project bar ----------------------------------------------------------

async function loadCurrentProject() {
  try {
    const r = await api("GET", "/current-project");
    currentProjectId = r.project_id || null;
  } catch (e) { /* ignore */ }
  await loadProjects();
  renderProjectBar();
}

async function loadProjects() {
  try {
    const r = await api("GET", "/projects");
    allProjects = r.projects || [];
  } catch (e) { /* ignore */ }
}

async function loadAccounts() {
  try {
    const r = await api("GET", "/accounts");
    accounts = r.accounts || [];
  } catch (e) { /* ignore */ }
}

function renderProjectBar() {
  const proj = currentProjectId ? allProjects.find((p) => p.id === currentProjectId) : null;
  const chip = $("projectChipName");
  const icon = $("projectChipIcon");
  const dots = $("projectChipDots");
  chip.textContent = proj ? proj.name : "No project";
  icon.textContent = "📦";
  dots.innerHTML = "";
  if (proj && proj.pool) {
    for (const aid of (proj.pool || [])) {
      const d = document.createElement("span");
      d.className = "acct-dot";
      d.style.background = accountColor(aid);
      d.title = (accountById(aid) || {}).label || aid;
      dots.appendChild(d);
    }
  }
}

// project chip dropdown toggle
$("projectChip").onclick = (e) => {
  e.stopPropagation();
  const dd = $("projectDropdown");
  const open = dd.style.display !== "none";
  if (open) { dd.style.display = "none"; return; }
  renderProjectDropdown();
  dd.style.display = "";
};
document.addEventListener("click", () => { $("projectDropdown").style.display = "none"; });
$("projectDropdown").addEventListener("click", (e) => e.stopPropagation());

function renderProjectDropdown() {
  const list = $("projectDropdownList");
  list.innerHTML = "";
  if (!allProjects.length) {
    list.innerHTML = `<div class="pd-item dim">No projects yet</div>`;
    return;
  }
  for (const p of allProjects) {
    const item = document.createElement("div");
    item.className = "pd-item" + (p.id === currentProjectId ? " active" : "");
    item.textContent = p.name;
    item.onclick = async () => {
      try {
        await api("PUT", "/current-project", { project_id: p.id });
        currentProjectId = p.id;
        await loadProjects();
        renderProjectBar();
        $("projectDropdown").style.display = "none";
      } catch (ex) { log(`switch project: ${ex.message}`, "err"); }
    };
    list.appendChild(item);
  }
}

$("btnNewProjectQuick").onclick = () => {
  $("projectDropdown").style.display = "none";
  switchView("projects");
  setTimeout(() => openProjectEditor(null), 50);
};

// ---- roles ----------------------------------------------------------------

async function loadRoles() {
  try {
    const data = await api("GET", "/roles");
    roles = data.roles || [];
    el.role.innerHTML = roles
      .map((r) => `<option value="${r.id}">${r.emoji} ${r.label}</option>`)
      .join("");
    applyRole();
  } catch (e) { log(`roles: ${e.message}`, "err"); }
}

function applyRole() {
  const r = roles.find((x) => x.id === el.role.value);
  if (!r) return;
  el.roleDesc.textContent = r.description || "";
  el.mode.value = r.mode || "normal";
  el.instructions.value = r.instructions || "";
  if (el.modeWarn) el.modeWarn.style.display = el.mode.value === "bypass" ? "block" : "none";
  if (!el.name.value || el.name.dataset.auto === "1") {
    el.name.value = nextName(r.id);
    el.name.dataset.auto = "1";
  }
}

function nextName(roleId) {
  let i = 1, base = roleId;
  const taken = new Set(sessions.map((s) => s.name));
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ---- agents list ----------------------------------------------------------

function acctDotHtml(accountId) {
  if (!accountId) return "";
  const color = accountColor(accountId);
  const label = (accountById(accountId) || {}).label || accountId;
  return `<span class="acct-dot" style="background:${esc(color)}" title="${esc(label)}"></span>`;
}

function cardHtml(s) {
  const prep = s.prep && s.prep !== "ready" ? `<span class="badge prep-${s.prep}">${s.prep}</span>` : "";
  const busy = pending.has(s.id) ? `<span class="badge prep-working">working…</span>` : "";
  const task = s.task ? `<div class="task" title="${esc(s.task)}">▸ ${esc(s.task)}</div>` : "";
  let hs = "";
  if (s.harness_state === "blocked") hs = `<span class="badge hs-blocked">🔴 needs you</span>`;
  else if (s.state === "AWAITING_PERMISSION") hs = `<span class="badge hs-blocked">🔴 approve?</span>`;
  else if (s.state === "AWAITING_INPUT") hs = `<span class="badge hs-blocked">🔴 input</span>`;
  else if (s.harness_state === "done") hs = `<span class="badge hs-done">✅ done</span>`;
  const menu = s.has_menu ? `<span class="badge hs-blocked">🔴 menu</span>` : "";
  const cwd = s.cwd ? `<div class="cwd" title="${esc(s.cwd)}">${esc(s.cwd)}</div>` : "";
  const model = s.model
    ? `<span class="badge model-${esc(s.model)}" title="${esc(s.reason || "why this model")}">${esc(s.model)}</span>`
    : "";
  const dot = acctDotHtml(s.account_id);
  return `
    <div class="top">
      <span class="emoji">${isOrch(s) ? "🧠" : (s.emoji || "💬")}</span>
      <span class="nm" title="${esc(s.name)}">${esc(s.name)}</span>
      ${dot}
      <button class="x" title="kill">✕</button>
    </div>
    ${cwd}
    <div class="meta">
      <span class="pill s-${s.harness_state === "done" ? "IDLE" : s.state}"><span class="dot"></span>${s.harness_state === "done" ? "DONE" : s.state}</span>
      <span class="badge">${s.mode || "normal"}</span>
      ${model}${prep}${busy}${hs}${menu}
    </div>
    <div class="role">${esc(s.label || s.role || s.cmd)}</div>
    ${task}`;
}

function makeCard(s) {
  const card = document.createElement("div");
  card.className = `card st-${s.state}` + (s.id === current ? " active" : "")
    + (isOrch(s) ? " orch" : "")
    + (needsAttention(s) ? " blocked" : "")
    + (s.harness_state === "done" ? " done" : "");
  card.innerHTML = cardHtml(s);
  card.onclick = (ev) => {
    if (ev.target.classList.contains("x")) { killSession(s.id); return; }
    focus(s.id);
  };
  return card;
}

const GROUPS = [
  { key: "attention", label: "Needs attention", test: (s) => needsAttention(s) },
  { key: "working", label: "Working", test: (s) => isWorking(s) },
  { key: "done", label: "Done", test: (s) => s.harness_state === "done" },
  { key: "idle", label: "Idle", test: () => true },
];

function renderAgents() {
  el.summary.textContent = `${sessions.length} agent${sessions.length === 1 ? "" : "s"}`;
  el.killAll.disabled = sessions.length === 0;

  // inbox badge
  const nBlocked = blockedSessions().length;
  el.inboxBadge.textContent = nBlocked || "";
  el.inboxBadge.style.display = nBlocked ? "inline-block" : "none";

  el.agents.innerHTML = "";

  // Orchestrators first (the things you chat with), then mission groups,
  // then state-grouped sessions that have no mission.
  const orchs = sessions.filter((s) => isOrch(s));
  for (const s of orchs) el.agents.appendChild(makeCard(s));

  const rest = sessions.filter((s) => !isOrch(s));

  // mission groups (in first-seen order)
  const missionOrder = [];
  const byMission = new Map();
  for (const s of rest) {
    if (!s.mission) continue;
    if (!byMission.has(s.mission)) { byMission.set(s.mission, []); missionOrder.push(s.mission); }
    byMission.get(s.mission).push(s);
  }
  for (const name of missionOrder) {
    el.agents.appendChild(missionHeader(name));
    for (const s of byMission.get(name)) el.agents.appendChild(makeCard(s));
  }

  // sessions without a mission → existing state-group fallback
  const loose = rest.filter((s) => !s.mission);
  const buckets = new Map(GROUPS.map((g) => [g.key, []]));
  for (const s of loose) {
    const g = GROUPS.find((g) => g.test(s));
    buckets.get(g.key).push(s);
  }
  for (const g of GROUPS) {
    const items = buckets.get(g.key);
    if (!items.length) continue;
    const head = document.createElement("div");
    head.className = `group-head group-${g.key}`;
    head.textContent = `${g.label} (${items.length})`;
    el.agents.appendChild(head);
    for (const s of items) el.agents.appendChild(makeCard(s));
  }
}

function missionHeader(name) {
  const m = missions.find((x) => x.mission === name);
  const autopilot = !!(m && m.autopilot);
  const head = document.createElement("div");
  head.className = "mission-head";
  head.innerHTML = `<span title="${esc(name)}">▣ ${esc(name)}</span><span class="grow"></span>`;
  const toggle = document.createElement("button");
  toggle.className = `badge autopilot-toggle ${autopilot ? "autopilot" : "supervised"}`;
  toggle.textContent = autopilot ? "🟠 autopilot" : "🟢 supervised";
  toggle.title = "toggle mission autopilot";
  toggle.onclick = (ev) => { ev.stopPropagation(); setAutopilot(name, !autopilot); };
  head.appendChild(toggle);
  return head;
}

async function setAutopilot(mission, autopilot) {
  try {
    await api("POST", `/missions/${encodeURIComponent(mission)}/autopilot`, { autopilot }, `autopilot:${mission}`);
    log(`mission ${mission}: ${autopilot ? "autopilot" : "supervised"}`, "ok");
    await pollMissions();
    renderAgents();
  } catch (e) { log(`autopilot ${mission}: ${e.message}`, "err"); }
}

function focus(id) {
  current = id;
  inboxOpen = false;
  syncTabs();
  const s = findSession(id);
  if (s && isOrch(s)) {
    el.focusTitle.innerHTML = `🧠 <b>Orchestrator</b> <span class="dim">— chat: describe a mission and it dispatches workers</span>`;
  } else {
    el.focusTitle.textContent = s
      ? `${s.emoji || ""} ${s.name} — ${s.label || s.role || s.cmd}` : id;
  }
  focusSignal = null; focusReport = null;
  el.orchBtn.classList.toggle("active", !!(s && isOrch(s)));
  renderAgents();
  refreshScreen();
  refreshFocusHarness();
  refreshMenu();
  refreshMissionActivity();
  updateFocusControls();
}

// ---- orchestrator chat ----------------------------------------------------

async function focusOrchestrator() {
  try {
    const r = await api("POST", "/orchestrator", undefined, "orchestrator");
    if (r && r.id) {
      orchId = r.id;
      await pollSessions();
      focus(orchId);
    }
  } catch (e) { log(`orchestrator: ${e.message}`, "err"); }
}

// ---- mission activity (shown when a mission worker is focused) -------------

async function refreshMissionActivity() {
  const s = current ? findSession(current) : null;
  const mission = s && s.mission;
  if (!mission) {
    el.missionActivity.style.display = "none";
    el.missionActivity.innerHTML = "";
    return;
  }
  try {
    const data = await api("GET", `/missions/${encodeURIComponent(mission)}`);
    const acts = data.activity || [];
    el.missionActivity.style.display = "";
    const lines = acts.length
      ? acts.slice(-12).map((a) => `<div class="ma-line">${esc(typeof a === "string" ? a : JSON.stringify(a))}</div>`).join("")
      : `<div class="ma-line dim">(no activity yet)</div>`;
    el.missionActivity.innerHTML =
      `<div class="ma-head">mission · ${esc(mission)}</div>${lines}`;
  } catch (e) {
    el.missionActivity.style.display = "none";
  }
}

function updateFocusControls() {
  const s = current ? findSession(current) : null;
  const state = s ? s.state : "EXITED";
  const shown = s && s.harness_state === "done" ? "DONE" : state;
  el.focusState.textContent = s ? shown : "—";
  el.focusPill.className = `pill s-${shown === "DONE" ? "IDLE" : state}`;
  const alive = !!s && s.alive;
  const ready = s && (s.prep === "ready" || isOrch(s));
  const busy = pending.has(current);
  el.prompt.disabled = !alive || busy || !ready;
  el.prompt.placeholder = !s ? "Message the focused agent…"
    : isOrch(s) ? "Describe a mission for the orchestrator and press Enter…"
    : !ready ? `agent is ${s.prep}…` : busy ? "agent is working…" : "Message the focused agent and press Enter…";
  el.send.disabled = el.prompt.disabled;
  const isPerm = state === "AWAITING_PERMISSION";
  el.approve.disabled = !isPerm; el.deny.disabled = !isPerm;
  el.interrupt.disabled = !alive;
  document.querySelectorAll(".keys button, #btnKey").forEach((b) => (b.disabled = !alive));
}

// ---- inbox ---------------------------------------------------------------

function syncTabs() {
  el.tabAgents.classList.toggle("active", !inboxOpen);
  el.tabInbox.classList.toggle("active", inboxOpen);
  el.agents.style.display = inboxOpen ? "none" : "";
  el.inbox.style.display = inboxOpen ? "" : "none";
  if (inboxOpen) renderInbox();
}

function renderInbox() {
  const blocked = blockedSessions();
  el.inbox.innerHTML = "";
  if (!blocked.length) {
    el.inbox.innerHTML = `<div class="empty">No agents are blocked. 🎉</div>`;
    return;
  }
  for (const s of blocked) {
    const wrap = document.createElement("div");
    wrap.className = "inbox-item";
    const head = document.createElement("div");
    head.className = "inbox-head";
    head.innerHTML = `<span class="emoji">${s.emoji || "💬"}</span>
      <span class="nm" title="${esc(s.name)}">${esc(s.name)}</span>
      <button class="tiny gofocus" title="open">open ↗</button>`;
    head.querySelector(".gofocus").onclick = () => focus(s.id);
    wrap.appendChild(head);
    if (s.cwd) {
      const cwd = document.createElement("div");
      cwd.className = "cwd"; cwd.textContent = s.cwd; wrap.appendChild(cwd);
    }
    const slot = document.createElement("div");
    wrap.appendChild(slot);
    el.inbox.appendChild(wrap);
    // load this session's signal into its own answer card
    loadAnswerCard(s.id, slot);
  }
}

// ---- answer card (parameterized by session id) ---------------------------

async function loadAnswerCard(id, mount) {
  try {
    const data = await api("GET", `/sessions/${id}/signals`);
    const sig = (data.signals || [])[0] || null;
    if (id === current) focusSignal = sig;
    if (!sig) { mount.innerHTML = ""; return; }
    renderAnswerCard(id, sig, mount);
  } catch (e) {
    mount.innerHTML = `<div class="answer-card err">signals: ${esc(e.message)}</div>`;
  }
}

function renderAnswerCard(id, sig, mount) {
  const card = document.createElement("div");
  card.className = "answer-card";
  const actionLabel = (sig.action || "ask").replace(/_/g, " ");
  let refsHtml = "";
  if (sig.refs && sig.refs.length) {
    refsHtml = `<div class="refs"><span class="dim">refs:</span> `
      + sig.refs.map((r) => `<code>${esc(r)}</code>`).join(" ") + `</div>`;
  }
  card.innerHTML = `
    <div class="ac-head">🔴 <b>${esc(actionLabel)}</b></div>
    <div class="ac-text">${esc(sig.text) || "(no text)"}</div>
    ${refsHtml}
    <div class="ac-opts"></div>
    <div class="ac-free">
      <input type="text" class="ac-input" placeholder="Type your answer…" />
      <button class="primary ac-send">Send</button>
    </div>`;

  const opts = card.querySelector(".ac-opts");
  for (const opt of (sig.options || [])) {
    const b = document.createElement("button");
    b.textContent = opt;
    b.onclick = () => answerSignal(id, sig.id, opt, mount);
    opts.appendChild(b);
  }

  const input = card.querySelector(".ac-input");
  const doSend = () => {
    const txt = input.value.trim();
    if (!txt) return;
    answerSignal(id, sig.id, txt, mount);
  };
  card.querySelector(".ac-send").onclick = doSend;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSend(); } });

  mount.innerHTML = "";
  mount.appendChild(card);
}

async function answerSignal(id, signalId, text, mount) {
  const s = findSession(id);
  const nm = s ? s.name : id;
  try {
    const r = await api("POST", `/sessions/${id}/answer`, { signal_id: signalId, text }, `answer:${nm}`);
    if (r && r.ok) {
      log(`answered ${nm}: ${text.slice(0, 80)}`, "ok");
      mount.innerHTML = "";
      if (id === current) focusSignal = null;
      await pollSessions();
      if (inboxOpen) renderInbox();
      if (id === current) { refreshScreen(); refreshFocusHarness(); }
    } else {
      log(`answer ${nm}: not ok`, "err");
    }
  } catch (e) {
    log(`answer ${nm}: ${e.message}`, "err");
  }
}

// ---- focused-agent harness panels (answer card above screen + report) ----

async function refreshFocusHarness() {
  const s = current ? findSession(current) : null;
  // answer card (blocked)
  if (s && s.harness_state === "blocked") {
    el.answer.style.display = "";
    loadAnswerCard(current, el.answer);
  } else {
    el.answer.style.display = "none";
    el.answer.innerHTML = "";
  }
  // report viewer (done)
  if (s && s.harness_state === "done") {
    el.report.style.display = "";
    loadReport(current);
  } else {
    el.report.style.display = "none";
    el.report.innerHTML = "";
    el.screen.style.display = "";
  }
}

async function loadReport(id) {
  let body;
  try {
    body = await api("GET", `/sessions/${id}/report`);
  } catch (e) {
    body = String(e.message).startsWith("404") ? "(no report produced)" : `report error: ${e.message}`;
  }
  focusReport = body;
  const s = findSession(id);
  const nm = s ? s.name : id;
  const card = document.createElement("div");
  card.className = "report-card";
  card.innerHTML = `
    <div class="rc-head">✅ <b>${esc(nm)}</b> finished — report</div>
    <pre class="rc-body">${esc(body)}</pre>
    <div class="rc-actions">
      <button class="rc-handoff primary">Spawn successor ▶</button>
      <button class="rc-kill red">Archive &amp; kill</button>
    </div>
    <p class="rc-cap dim">A done agent is parked (kept for inspection) until you kill it.</p>`;
  card.querySelector(".rc-kill").onclick = () => killSession(id);
  card.querySelector(".rc-handoff").onclick = async () => {
    try {
      const r = await api("POST", `/sessions/${id}/handoff`, undefined, `handoff:${nm}`);
      if (r && r.ok) { log(`handoff: spawned successor for ${nm}`, "ok"); await pollSessions(); }
      else log(`handoff ${nm}: no pending handoff`, "");
    } catch (e) { log(`handoff ${nm}: ${e.message}`, "err"); }
  };
  el.report.innerHTML = "";
  el.report.appendChild(card);
  el.screen.style.display = "none";
}

// ---- menu card (focused-agent interactive selection menu) ----------------

async function refreshMenu() {
  if (!current) { el.menu.style.display = "none"; el.menu.innerHTML = ""; return; }
  const id = current;
  let menu = null;
  try {
    const data = await api("GET", `/sessions/${id}/menu`);
    menu = data && data.menu;
  } catch (e) {
    el.menu.style.display = "none"; el.menu.innerHTML = "";
    return;
  }
  if (id !== current) return; // focus changed while awaiting
  if (!menu) { el.menu.style.display = "none"; el.menu.innerHTML = ""; return; }
  renderMenuCard(id, menu);
}

function renderMenuCard(id, menu) {
  const card = document.createElement("div");
  card.className = "menu-card";
  card.innerHTML = `
    <div class="mc-head">🔴 <b>${esc(menu.prompt) || "Select an option"}</b></div>
    <div class="mc-opts"></div>`;
  const opts = card.querySelector(".mc-opts");
  for (const opt of (menu.options || [])) {
    const b = document.createElement("button");
    b.textContent = opt.label;
    if (opt.index === menu.selected) b.classList.add("selected");
    b.onclick = () => selectMenu(id, opt.index);
    opts.appendChild(b);
  }
  el.menu.innerHTML = "";
  el.menu.appendChild(card);
  el.menu.style.display = "";
}

async function selectMenu(id, index) {
  const s = findSession(id);
  const nm = s ? s.name : id;
  try {
    const r = await api("POST", `/sessions/${id}/menu`, { index }, `menu:${nm}`);
    if (r && r.ok) log(`menu ${nm}: selected ${index}`, "ok");
  } catch (e) {
    log(`menu ${nm}: ${e.message}`, "err");
  }
  setTimeout(() => { if (current === id) { refreshScreen(); refreshMenu(); } }, 300);
}

// ---- polling --------------------------------------------------------------

async function pollSessions() {
  try {
    const data = await api("GET", "/sessions");
    sessions = data.sessions || [];
    if (current && !findSession(current)) {
      current = null;
      el.focusTitle.textContent = "No agent selected";
      el.answer.style.display = "none"; el.report.style.display = "none";
      el.menu.style.display = "none"; el.menu.innerHTML = "";
      el.screen.style.display = "";
    }
    renderAgents();
    if (inboxOpen) renderInbox();
    updateFocusControls();
    // keep focused harness panels in sync as state transitions
    refreshFocusHarness();
    // remember the orchestrator id if we can spot it
    if (!orchId) {
      const o = sessions.find((s) => s.role === "orchestrator" || s.is_orchestrator);
      if (o) orchId = o.id;
    }
    refreshMissionActivity();
  } catch (e) { /* server momentarily busy */ }
}

async function refreshScreen() {
  if (!current) { el.screen.textContent = "No agent selected."; return; }
  const s = findSession(current);
  if (s && s.harness_state === "done") return; // report viewer owns the stage
  try {
    el.screen.textContent = await api("GET", `/sessions/${current}/screen?history=${el.hist.checked}`);
  } catch (e) {
    if (String(e.message).startsWith("4")) el.screen.textContent = `(${current} is gone)`;
  }
}

// ---- missions + brakes ----------------------------------------------------

async function pollMissions() {
  try {
    const data = await api("GET", "/missions");
    missions = data.missions || [];
  } catch (e) { /* ignore */ }
}

async function pollBrakes() {
  let brakes = [];
  try {
    const data = await api("GET", "/brakes");
    brakes = data.brakes || [];
  } catch (e) { return; }
  renderBrakes(brakes);
}

function renderBrakes(brakes) {
  if (!brakes.length) {
    el.brakes.style.display = "none";
    el.brakes.innerHTML = "";
    return;
  }
  el.brakes.style.display = "";
  el.brakes.innerHTML = "";
  for (const b of brakes) {
    const card = document.createElement("div");
    card.className = "brake-card";
    const meta = [b.mission ? `mission ${b.mission}` : null, b.worker ? `worker ${b.worker}` : null]
      .filter(Boolean).join(" · ");
    card.innerHTML = `
      <div class="bc-head">🟠 brake · ${esc(b.brake)}</div>
      <div class="bc-detail">${esc(b.detail || "")}</div>
      ${meta ? `<div class="bc-meta">${esc(meta)}</div>` : ""}
      <div class="bc-actions">
        <button class="green bc-allow">Allow</button>
        <button class="bc-skip">Skip</button>
      </div>`;
    card.querySelector(".bc-allow").onclick = () => brakeAction(b.id, "allow");
    card.querySelector(".bc-skip").onclick = () => brakeAction(b.id, "skip");
    el.brakes.appendChild(card);
  }
}

async function brakeAction(id, verb) {
  try {
    await api("POST", `/brakes/${id}/${verb}`, undefined, `brake:${verb}`);
    log(`brake ${verb}: ${id}`, "ok");
  } catch (e) { log(`brake ${verb}: ${e.message}`, "err"); }
  await pollBrakes();
  await pollSessions();
}

setInterval(pollSessions, 1100);
setInterval(() => { if (el.poll.checked) { refreshScreen(); refreshMenu(); } }, 700);
setInterval(pollMissions, 1100);
setInterval(pollBrakes, 1000);

// ---- tab toggles ----------------------------------------------------------

el.tabAgents.onclick = () => { inboxOpen = false; syncTabs(); };
el.tabInbox.onclick = () => { inboxOpen = true; syncTabs(); };

// ---- actions --------------------------------------------------------------

function updateModeWarn() {
  el.modeWarn.style.display = el.mode.value === "bypass" ? "block" : "none";
}
el.mode.onchange = updateModeWarn;
el.role.onchange = () => { applyRole(); updateModeWarn(); };
el.name.oninput = () => { el.name.dataset.auto = "0"; };
el.instructions.oninput = () => {}; // editable; spawn reads its value

el.spawn.onclick = async () => {
  const name = el.name.value.trim();
  if (!name) return log("name required", "err");
  const task = el.task.value.trim() || undefined;
  const body = {
    name, role: el.role.value, mode: el.mode.value,
    instructions: el.instructions.value,
    task,
    cwd: el.cwd.value.trim() || undefined,
    project_id: currentProjectId || undefined,
  };
  el.spawn.disabled = true;
  try {
    const info = await api("POST", "/sessions", body, "spawn");
    log(`spawned ${name} (${el.role.value}, ${el.mode.value})` + (task ? ` · task: ${task.slice(0, 60)}` : ""), "ok");
    spawnCount++;
    await pollSessions();
    if (info && info.id) focus(info.id);
    el.task.value = "";
    el.name.value = nextName(el.role.value); el.name.dataset.auto = "1";
  } catch (e) {
    log(`spawn: ${e.message}`, "err");
  } finally {
    el.spawn.disabled = false;
  }
};

async function killSession(id) {
  const s = findSession(id);
  const nm = s ? s.name : id;
  try { await api("DELETE", `/sessions/${id}`, undefined, "kill"); log(`killed ${nm}`, "ok"); }
  catch (e) { log(`kill: ${e.message}`, "err"); }
  if (current === id) {
    current = null; el.screen.textContent = "Agent killed."; el.screen.style.display = "";
    el.answer.style.display = "none"; el.report.style.display = "none";
    el.menu.style.display = "none"; el.menu.innerHTML = "";
    el.focusTitle.textContent = "No agent selected";
  }
  pending.delete(id);
  await pollSessions();
}

el.killAll.onclick = async () => {
  if (!sessions.length || !confirm(`Kill all ${sessions.length} agents?`)) return;
  for (const s of [...sessions]) await killSession(s.id);
};

async function sendPrompt() {
  if (!current) return;
  const id = current;
  const s = findSession(id);
  const nm = s ? s.name : id;
  const text = el.prompt.value.trim();
  if (!text) return;
  el.prompt.value = "";
  pending.add(id);
  log(`→ ${nm}: ${text}`);
  updateFocusControls(); renderAgents();
  try {
    const r = await api("POST", `/sessions/${id}/prompt`, { text, timeout: 600 }, `prompt:${nm}`);
    log(`← ${nm} (${r.state}): ${r.response ? r.response.slice(0, 140) : "(empty)"}`, r.state === "ERROR" ? "err" : "ok");
  } catch (e) {
    log(`prompt ${nm}: ${e.message}`, "err");
  } finally {
    pending.delete(id);
    updateFocusControls(); renderAgents();
    if (current === id) refreshScreen();
  }
}
el.send.onclick = sendPrompt;
el.prompt.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendPrompt(); } });

const act = async (verb, label) => {
  if (!current) return;
  const s = findSession(current);
  const nm = s ? s.name : current;
  try { await api("POST", `/sessions/${current}/${verb}`, undefined, label); log(`${label} → ${nm}`, "ok"); }
  catch (e) { log(`${label}: ${e.message}`, "err"); }
  setTimeout(refreshScreen, 300);
};
el.approve.onclick = () => act("approve", "approve");
el.deny.onclick = () => act("deny", "deny");
el.interrupt.onclick = () => act("interrupt", "interrupt");

async function sendKey(key) {
  if (!current || !key) return;
  try { await api("POST", `/sessions/${current}/key`, { key }, "key"); log(`key ${key} → ${current}`); }
  catch (e) { log(`key: ${e.message}`, "err"); }
  setTimeout(refreshScreen, 250);
}
document.querySelectorAll(".keys button").forEach((b) => (b.onclick = () => sendKey(b.dataset.key)));
el.keyBtn.onclick = () => { sendKey(el.customKey.value.trim()); el.customKey.value = ""; };
el.hist.onchange = refreshScreen;
el.copyJson.onclick = async () => {
  try { await navigator.clipboard.writeText(lastJson); log("JSON copied", "ok"); }
  catch { log("clipboard blocked", "err"); }
};

el.orchBtn.onclick = focusOrchestrator;

// ==========================================================================
// ACCOUNTS PAGE
// ==========================================================================

function colorForAcct(a) {
  return a.color || "#8b949e";
}

function renderAccountsPage() {
  const list = $("accountsList");
  list.innerHTML = "";
  if (!accounts.length) {
    list.innerHTML = `<div class="page-empty">No accounts yet. Scan or add one.</div>`;
    return;
  }
  for (const a of accounts) {
    const color = colorForAcct(a);
    const initials = accountInitials(a);
    const isDefault = a.is_default;
    const card = document.createElement("div");
    card.className = "acct-card";
    card.innerHTML = `
      <div class="acct-swatch" style="background:${color}22;color:${color}">${esc(initials)}</div>
      <div class="acct-info">
        <div class="acct-name">${esc(a.label)}</div>
        <div class="acct-tags">
          <span class="badge provider">${esc(a.provider || "claude-code")}</span>
          ${isDefault ? `<span class="badge is-default">⭐ default</span>` : ""}
        </div>
        <div class="acct-dir">${esc(a.config_dir)}</div>
      </div>
      <div class="acct-actions">
        ${!isDefault ? `<button class="tiny set-default" data-id="${esc(a.id)}">Set default</button>` : ""}
        <button class="tiny login-btn" data-id="${esc(a.id)}">Log in ↗</button>
        <button class="tiny red del-acct" data-id="${esc(a.id)}">✕</button>
      </div>`;
    list.appendChild(card);
  }
  list.querySelectorAll(".set-default").forEach((b) => {
    b.onclick = () => setAccountDefault(b.dataset.id);
  });
  list.querySelectorAll(".login-btn").forEach((b) => {
    b.onclick = () => loginAccount(b.dataset.id);
  });
  list.querySelectorAll(".del-acct").forEach((b) => {
    b.onclick = () => deleteAccount(b.dataset.id);
  });
}

async function setAccountDefault(id) {
  try {
    await api("POST", `/accounts/${id}/default`, undefined, "set-default");
    log("default account set", "ok");
    await loadAccounts();
    renderAccountsPage();
  } catch (e) { log(`set-default: ${e.message}`, "err"); }
}

async function deleteAccount(id) {
  if (!confirm("Delete this account?")) return;
  try {
    await api("DELETE", `/accounts/${id}`, undefined, "del-account");
    log("account deleted", "ok");
    await loadAccounts();
    renderAccountsPage();
    renderProjectBar();
  } catch (e) { log(`del-account: ${e.message}`, "err"); }
}

async function loginAccount(id) {
  try {
    const r = await api("POST", `/accounts/${id}/login`, undefined, "login");
    if (r && r.id) {
      log(`login session: ${r.id}`, "ok");
      await pollSessions();
      // switch to fleet view and focus the login session
      switchView("fleet");
      focus(r.id);
    }
  } catch (e) { log(`login: ${e.message}`, "err"); }
}

// scan
$("btnScanAccounts").onclick = async () => {
  const scanResults = $("scanResults");
  const accountForm = $("accountForm");
  accountForm.style.display = "none";
  scanResults.style.display = "";
  scanResults.innerHTML = `<div class="dim">Scanning…</div>`;
  try {
    const r = await api("POST", "/accounts/scan", undefined, "scan");
    const managed = r.managed || [];
    const importable = r.importable || [];
    let html = "";
    if (!managed.length && !importable.length) {
      html = `<div class="dim">Nothing new found.</div>`;
    } else {
      if (managed.length) {
        html += `<div class="scan-section-head">Managed (new dirs found)</div>`;
        for (const s of managed) {
          html += `<div class="scan-item">
            <div class="si-info"><b>${esc(s.id || s.label || s.config_dir)}</b><div class="si-dir">${esc(s.config_dir)}</div></div>
            <button class="tiny import-managed" data-id="${esc(s.id || "")}" data-label="${esc(s.label || s.id || "")}" data-dir="${esc(s.config_dir)}" data-provider="${esc(s.provider || "claude-code")}">Import</button>
          </div>`;
        }
      }
      if (importable.length) {
        html += `<div class="scan-section-head" style="margin-top:12px">Importable (existing ~/.claude-* dirs)</div>`;
        for (const s of importable) {
          html += `<div class="scan-item">
            <div class="si-info"><b>${esc(s.id || s.label || s.config_dir)}</b><div class="si-dir">${esc(s.config_dir)}</div></div>
            <button class="tiny import-existing" data-id="${esc(s.id || "")}" data-label="${esc(s.label || s.id || "")}" data-dir="${esc(s.config_dir)}" data-provider="${esc(s.provider || "claude-code")}">Import</button>
          </div>`;
        }
      }
    }
    scanResults.innerHTML = html;
    scanResults.querySelectorAll(".import-managed, .import-existing").forEach((b) => {
      const isManaged = b.classList.contains("import-managed");
      b.onclick = async () => {
        const color = randomColor();
        try {
          const endpoint = isManaged ? "/accounts" : "/accounts/import";
          await api("POST", endpoint, {
            id: b.dataset.id, label: b.dataset.label,
            config_dir: b.dataset.dir, provider: b.dataset.provider, color,
          }, "import");
          log(`imported: ${b.dataset.label}`, "ok");
          await loadAccounts();
          renderAccountsPage();
          renderProjectBar();
          b.closest(".scan-item").remove();
        } catch (ex) { log(`import: ${ex.message}`, "err"); }
      };
    });
  } catch (e) {
    scanResults.innerHTML = `<div style="color:var(--red)">scan error: ${esc(e.message)}</div>`;
  }
};

// new account form
$("btnNewAccount").onclick = () => {
  const scanResults = $("scanResults");
  const accountForm = $("accountForm");
  scanResults.style.display = "none";
  accountForm.style.display = "";
  const color = randomColor();
  accountForm.innerHTML = `
    <h3>New account</h3>
    <div class="pef-field"><label>ID (slug)</label><input type="text" id="newAcctId" placeholder="e.g. mywork" /></div>
    <div class="pef-field"><label>Label</label><input type="text" id="newAcctLabel" placeholder="My Work Account" /></div>
    <div class="pef-field"><label>Config dir</label><input type="text" id="newAcctDir" placeholder="/path/to/config" /></div>
    <div class="pef-field"><label>Provider</label>
      <select id="newAcctProvider"><option value="claude-code">claude-code</option></select>
    </div>
    <div class="row">
      <button id="btnCreateAcct" class="primary">Create account</button>
      <button id="btnCancelAcct">Cancel</button>
    </div>`;
  $("btnCancelAcct").onclick = () => { accountForm.style.display = "none"; };
  $("btnCreateAcct").onclick = async () => {
    const id = $("newAcctId").value.trim();
    const label = $("newAcctLabel").value.trim();
    const config_dir = $("newAcctDir").value.trim();
    const provider = $("newAcctProvider").value;
    if (!id || !label || !config_dir) return log("id, label, config_dir required", "err");
    try {
      await api("POST", "/accounts", { id, label, config_dir, color, provider }, "create-account");
      log(`account created: ${label}`, "ok");
      await loadAccounts();
      renderAccountsPage();
      renderProjectBar();
      accountForm.style.display = "none";
    } catch (ex) { log(`create-account: ${ex.message}`, "err"); }
  };
};

function randomColor() {
  const colors = ["#34d399","#60a5fa","#f87171","#fbbf24","#a78bfa","#fb923c","#38bdf8","#4ade80"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ==========================================================================
// PROJECTS PAGE
// ==========================================================================

let editingProject = null; // null = new, else project id

function renderProjectsPage() {
  const list = $("projectList");
  list.innerHTML = "";
  for (const p of allProjects) {
    const item = document.createElement("div");
    item.className = "page-list-item" + (editingProject === p.id ? " active" : "");
    item.innerHTML = `<span class="item-label">${esc(p.name)}</span>`;
    item.onclick = () => openProjectEditor(p.id);
    list.appendChild(item);
  }
}

async function openProjectEditor(id) {
  editingProject = id;
  renderProjectsPage();
  const pane = $("projectEditor");
  if (!id) {
    // new project form
    pane.innerHTML = buildProjectEditorHtml(null, []);
    wireProjectEditor(null, []);
    return;
  }
  try {
    const proj = await api("GET", `/projects/${id}`);
    pane.innerHTML = buildProjectEditorHtml(proj, proj.pool || []);
    wireProjectEditor(proj, proj.pool || []);
  } catch (e) {
    pane.innerHTML = `<div class="page-empty">Error: ${esc(e.message)}</div>`;
  }
}

function buildProjectEditorHtml(proj, pool) {
  const isNew = !proj;
  const name = proj ? proj.name : "";
  const path = proj ? (proj.path || "") : "";
  const strategy = proj ? (proj.account_strategy || "single") : "single";
  const modelCeiling = proj ? (proj.model_ceiling || "") : "";
  const autopilot = proj ? !!proj.autopilot : false;
  return `
    <div class="proj-editor-form">
      <div class="pef-head">
        <h2>${isNew ? "New Project" : esc(proj.name)}</h2>
        ${!isNew ? `<button id="btnDeleteProject" class="tiny red">Delete</button>` : ""}
      </div>
      <div class="pef-field"><label>Project name</label>
        <input type="text" id="pefName" value="${esc(name)}" placeholder="My Project" />
      </div>
      <div class="pef-field"><label>Working directory</label>
        <input type="text" id="pefPath" style="font-family:ui-monospace,monospace" value="${esc(path)}" placeholder="/path/to/project" />
      </div>
      ${isNew ? `<div class="pef-field"><label>ID (slug)</label>
        <input type="text" id="pefId" value="" placeholder="my-project" />
      </div>` : ""}
      <div class="pef-field"><label>Account strategy</label>
        <div class="seg-toggle">
          <button class="strat-btn ${strategy === "single" ? "on" : ""}" data-strat="single">Single account</button>
          <button class="strat-btn ${strategy === "round_robin" ? "on" : ""}" data-strat="round_robin">Round-robin pool ⟳</button>
        </div>
        <p class="hint" id="stratHint">${strategyHint(strategy)}</p>
      </div>
      <div class="pef-field">
        <label>Account pool <span style="opacity:.4">· use ↑↓ to reorder</span></label>
        <div id="poolList" class="pool-list">${buildPoolHtml(pool)}</div>
        <div class="pool-add-row">
          <select id="poolAddSelect"></select>
          <button id="btnAddToPool" class="tiny">+ Add</button>
        </div>
        <div class="next-worker-hint" id="nextWorkerHint">${nextWorkerHint(pool, strategy)}</div>
      </div>
      <div class="pef-field"><label>Defaults (optional)</label>
        <div class="row">
          <select id="pefModelCeiling" style="flex:1">
            <option value="">— no model ceiling —</option>
            <option value="haiku" ${modelCeiling === "haiku" ? "selected" : ""}>haiku</option>
            <option value="sonnet" ${modelCeiling === "sonnet" ? "selected" : ""}>sonnet</option>
            <option value="opus" ${modelCeiling === "opus" ? "selected" : ""}>opus</option>
          </select>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;text-transform:none;color:var(--fg);white-space:nowrap">
            <input type="checkbox" id="pefAutopilot" ${autopilot ? "checked" : ""}> autopilot
          </label>
        </div>
      </div>
      <div class="pef-actions">
        <button id="btnSaveProject" class="primary">${isNew ? "Create project" : "Save changes"}</button>
      </div>
    </div>`;
}

function strategyHint(s) {
  return s === "round_robin"
    ? "Round-robin: each new worker takes the next account in the pool."
    : "Single: all workers use the first account in the pool.";
}

function buildPoolHtml(pool) {
  if (!pool.length) return `<div class="dim" style="font-size:12px;padding:4px 0">No accounts in pool yet.</div>`;
  return pool.map((aid, i) => {
    const a = accountById(aid);
    const color = a ? colorForAcct(a) : "#8b949e";
    const label = a ? a.label : aid;
    return `<div class="pool-pill" data-aid="${esc(aid)}">
      <span class="pp-pos">${i + 1}</span>
      <span class="pp-dot" style="background:${esc(color)}"></span>
      <span class="pp-label">${esc(label)}</span>
      <button class="pp-up" data-idx="${i}" title="move up">↑</button>
      <button class="pp-dn" data-idx="${i}" title="move down">↓</button>
      <button class="pp-rm" data-idx="${i}" title="remove">✕</button>
    </div>`;
  }).join("");
}

function nextWorkerHint(pool, strategy) {
  if (!pool.length) return "";
  const a = accountById(pool[0]);
  const name = a ? a.label : pool[0];
  if (strategy === "round_robin" && pool.length > 1) {
    const b = accountById(pool[1]);
    const name2 = b ? b.label : pool[1];
    return `Next worker → <b>${esc(name)}</b>, then <b>${esc(name2)}</b>…`;
  }
  return `Next worker → <b>${esc(name)}</b>`;
}

function wireProjectEditor(proj, initialPool) {
  let pool = [...initialPool];
  let strategy = proj ? (proj.account_strategy || "single") : "single";

  function refreshPool() {
    $("poolList").innerHTML = buildPoolHtml(pool);
    const hint = $("nextWorkerHint");
    if (hint) hint.innerHTML = nextWorkerHint(pool, strategy);
    wirePoolButtons();
  }

  function wirePoolButtons() {
    $("poolList").querySelectorAll(".pp-up").forEach((b) => {
      b.onclick = () => {
        const i = parseInt(b.dataset.idx);
        if (i <= 0) return;
        [pool[i - 1], pool[i]] = [pool[i], pool[i - 1]];
        refreshPool();
      };
    });
    $("poolList").querySelectorAll(".pp-dn").forEach((b) => {
      b.onclick = () => {
        const i = parseInt(b.dataset.idx);
        if (i >= pool.length - 1) return;
        [pool[i], pool[i + 1]] = [pool[i + 1], pool[i]];
        refreshPool();
      };
    });
    $("poolList").querySelectorAll(".pp-rm").forEach((b) => {
      b.onclick = () => {
        const i = parseInt(b.dataset.idx);
        pool.splice(i, 1);
        refreshPool();
      };
    });
  }

  // strategy toggle
  document.querySelectorAll(".strat-btn").forEach((b) => {
    b.onclick = () => {
      strategy = b.dataset.strat;
      document.querySelectorAll(".strat-btn").forEach((x) => x.classList.toggle("on", x.dataset.strat === strategy));
      const hint = $("stratHint");
      if (hint) hint.textContent = strategyHint(strategy);
      refreshPool();
    };
  });

  // pool add select — populate with accounts not yet in pool
  function refreshAddSelect() {
    const sel = $("poolAddSelect");
    if (!sel) return;
    sel.innerHTML = accounts.filter((a) => !pool.includes(a.id))
      .map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join("");
    if (!sel.options.length) sel.innerHTML = `<option value="">— all accounts in pool —</option>`;
  }
  refreshAddSelect();

  const addBtn = $("btnAddToPool");
  if (addBtn) {
    addBtn.onclick = () => {
      const sel = $("poolAddSelect");
      const aid = sel && sel.value;
      if (!aid || pool.includes(aid)) return;
      pool.push(aid);
      refreshPool();
      refreshAddSelect();
    };
  }

  wirePoolButtons();

  // save
  $("btnSaveProject").onclick = async () => {
    const name = $("pefName").value.trim();
    const path = $("pefPath").value.trim();
    const modelCeiling = $("pefModelCeiling").value || null;
    const autopilot = $("pefAutopilot").checked ? 1 : 0;
    if (!name || !path) return log("name and path required", "err");
    try {
      let id = proj ? proj.id : ($("pefId") ? $("pefId").value.trim() : null);
      if (!id) { log("id required", "err"); return; }
      if (!proj) {
        await api("POST", "/projects", { id, name, path, account_strategy: strategy, model_ceiling: modelCeiling, autopilot }, "create-project");
      } else {
        await api("PATCH", `/projects/${id}`, { name, path, account_strategy: strategy, model_ceiling: modelCeiling, autopilot }, "patch-project");
      }
      // save pool
      await api("PUT", `/projects/${id}/accounts`, { account_ids: pool }, "set-pool");
      log(`project saved: ${name}`, "ok");
      await loadProjects();
      renderProjectsPage();
      openProjectEditor(id);
      renderProjectBar();
    } catch (ex) { log(`save-project: ${ex.message}`, "err"); }
  };

  // delete
  const delBtn = $("btnDeleteProject");
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!proj || !confirm(`Delete project "${proj.name}"?`)) return;
      try {
        await api("DELETE", `/projects/${proj.id}`, undefined, "delete-project");
        log(`project deleted: ${proj.name}`, "ok");
        if (currentProjectId === proj.id) {
          currentProjectId = null;
          await api("PUT", "/current-project", { project_id: null });
        }
        editingProject = null;
        await loadProjects();
        renderProjectsPage();
        $("projectEditor").innerHTML = `<div class="page-empty">Select a project or create a new one.</div>`;
        renderProjectBar();
      } catch (ex) { log(`delete-project: ${ex.message}`, "err"); }
    };
  }
}

$("btnNewProject").onclick = () => openProjectEditor(null);

// ==========================================================================
// AGENTS/ROLES EDITOR
// ==========================================================================

let editingRole = null;

function renderRolesPage() {
  const list = $("roleList");
  list.innerHTML = "";
  for (const r of roles) {
    const item = document.createElement("div");
    item.className = "page-list-item" + (editingRole === r.id ? " active" : "");
    item.innerHTML = `<span>${esc(r.emoji || "")}</span><span class="item-label">${esc(r.label)}</span>
      ${r.is_system ? `<span class="badge" style="font-size:9px">sys</span>` : ""}`;
    item.onclick = () => openRoleEditor(r.id);
    list.appendChild(item);
  }
}

function openRoleEditor(id) {
  editingRole = id;
  renderRolesPage();
  const pane = $("roleEditor");
  const r = id ? roles.find((x) => x.id === id) : null;
  if (!r && id) { pane.innerHTML = `<div class="page-empty">Role not found.</div>`; return; }
  pane.innerHTML = buildRoleEditorHtml(r);
  wireRoleEditor(r);
}

function buildRoleEditorHtml(r) {
  const isNew = !r;
  return `
    <div class="role-editor-form">
      <div class="ref-head">
        <h2>${isNew ? "New Role" : esc(r.label || r.id)}</h2>
        ${!isNew && !r.is_system ? `<button id="btnDeleteRole" class="tiny red">Delete</button>` : ""}
      </div>
      ${isNew ? `<div class="ref-field"><label>ID (slug)</label>
        <input type="text" id="refId" placeholder="my-role" /></div>` : ""}
      <div class="ref-row">
        <div class="ref-field" style="flex:0 0 72px"><label>Emoji</label>
          <input type="text" id="refEmoji" value="${esc(r ? (r.emoji || "") : "")}" style="text-align:center" placeholder="🤖" />
        </div>
        <div class="ref-field"><label>Label</label>
          <input type="text" id="refLabel" value="${esc(r ? (r.label || "") : "")}" placeholder="My Role" />
        </div>
      </div>
      <div class="ref-row">
        <div class="ref-field"><label>Permission mode</label>
          <select id="refMode">
            <option value="normal" ${(!r || r.mode === "normal") ? "selected" : ""}>normal</option>
            <option value="accept-edits" ${r && r.mode === "accept-edits" ? "selected" : ""}>accept-edits</option>
            <option value="auto" ${r && r.mode === "auto" ? "selected" : ""}>auto</option>
            <option value="plan" ${r && r.mode === "plan" ? "selected" : ""}>plan</option>
            <option value="bypass" ${r && r.mode === "bypass" ? "selected" : ""}>⚠ bypass</option>
          </select>
        </div>
        <div class="ref-field"><label>Default model</label>
          <select id="refModel">
            <option value="" ${(!r || !r.default_model) ? "selected" : ""}>— let orchestrator pick —</option>
            <option value="haiku" ${r && r.default_model === "haiku" ? "selected" : ""}>haiku</option>
            <option value="sonnet" ${r && r.default_model === "sonnet" ? "selected" : ""}>sonnet</option>
            <option value="opus" ${r && r.default_model === "opus" ? "selected" : ""}>opus</option>
          </select>
        </div>
      </div>
      <div class="ref-field"><label>Description <span class="dim">(shown in pickers)</span></label>
        <input type="text" id="refDesc" value="${esc(r ? (r.description || "") : "")}" placeholder="What does this role do?" />
      </div>
      <div class="ref-field"><label>Instructions <span class="dim">(priming — typed as first message)</span></label>
        <textarea id="refInstructions" rows="6" style="font-family:ui-monospace,monospace;font-size:12px">${esc(r ? (r.instructions || "") : "")}</textarea>
      </div>
      <div class="ref-note">🔑 Account: <b>inherited from project at spawn</b> — round-robin pool, or single account.</div>
      <div class="ref-actions">
        <button id="btnSaveRole" class="primary">Save role</button>
        <span class="dim">Stored in SQLite</span>
      </div>
    </div>`;
}

function wireRoleEditor(r) {
  $("btnSaveRole").onclick = async () => {
    const id = r ? r.id : ($("refId") ? $("refId").value.trim() : null);
    const label = $("refLabel").value.trim();
    const emoji = $("refEmoji").value.trim();
    const mode = $("refMode").value;
    const default_model = $("refModel").value || null;
    const description = $("refDesc").value.trim();
    const instructions = $("refInstructions").value;
    if (!id) { log("id required", "err"); return; }
    if (!label) { log("label required", "err"); return; }
    try {
      if (!r) {
        await api("POST", "/roles", { id, label, emoji, mode, default_model, description, instructions }, "create-role");
      } else {
        await api("PATCH", `/roles/${id}`, { label, emoji, mode, default_model, description, instructions }, "patch-role");
      }
      log(`role saved: ${label}`, "ok");
      await loadRoles();
      renderRolesPage();
      openRoleEditor(id);
    } catch (ex) { log(`save-role: ${ex.message}`, "err"); }
  };

  const delBtn = $("btnDeleteRole");
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!r || !confirm(`Delete role "${r.label}"?`)) return;
      try {
        await api("DELETE", `/roles/${r.id}`, undefined, "delete-role");
        log(`role deleted: ${r.label}`, "ok");
        editingRole = null;
        await loadRoles();
        renderRolesPage();
        $("roleEditor").innerHTML = `<div class="page-empty">Select a role or create a new one.</div>`;
      } catch (ex) { log(`delete-role: ${ex.message}`, "err"); }
    };
  }
}

$("btnNewRole").onclick = () => {
  editingRole = null;
  renderRolesPage();
  $("roleEditor").innerHTML = buildRoleEditorHtml(null);
  wireRoleEditor(null);
};

// ---- backlog kanban -------------------------------------------------------

// NOTE: a task with status 'blocked' won't render in any of these 4 columns —
// Chunk 3 (pipelines) must handle/display blocked tasks (no blocked column here yet).
const BACKLOG_COLS = [
  { id: "ready",       label: "Ready",       color: "#8b949e" },
  { id: "in_progress", label: "In Progress", color: "#58a6ff" },
  { id: "review",      label: "Review",      color: "#bc8cff" },
  { id: "shipped",     label: "Shipped",     color: "#3fb950" },
];
const PRIORITY_COLORS = ["#f85149", "#d29922", "#58a6ff", "#8b949e"];
const PRIORITY_LABELS = ["P0", "P1", "P2", "P3"];

let backlogTasks = [];
let selectedTaskId = null;

async function renderBacklog() {
  if (!currentProjectId) {
    $("backlogKanban").innerHTML = `<div class="dim" style="padding:16px">Select a project first.</div>`;
    return;
  }
  try {
    const r = await api("GET", `/tasks?project_id=${encodeURIComponent(currentProjectId)}`);
    backlogTasks = r.tasks || [];
  } catch (e) {
    $("backlogKanban").innerHTML = `<div class="dim" style="padding:16px">Error loading tasks.</div>`;
    return;
  }
  renderKanban();
}

function renderKanban() {
  const board = $("backlogKanban");
  board.innerHTML = "";
  for (const col of BACKLOG_COLS) {
    const items = backlogTasks.filter(t => t.status === col.id);
    const colEl = document.createElement("div");
    colEl.className = "bk-col";
    colEl.innerHTML = `
      <div class="bk-col-head">
        <span class="bk-col-dot" style="background:${col.color}"></span>
        <span class="bk-col-label">${esc(col.label)}</span>
        <span class="bk-col-count">${items.length}</span>
      </div>
      <div class="bk-col-body" id="bk-col-${col.id}">
        ${items.length === 0 ? '<div class="dim" style="font-size:12px;padding:8px">—</div>' : ""}
      </div>`;
    board.appendChild(colEl);
    const body = colEl.querySelector(`#bk-col-${col.id}`);
    for (const t of items) {
      body.appendChild(makeTaskCard(t));
    }
  }
}

function makeTaskCard(t) {
  const pIdx = Math.min(Math.max(t.priority || 2, 0), 3);
  const pColor = PRIORITY_COLORS[pIdx];
  const pLabel = PRIORITY_LABELS[pIdx];
  const card = document.createElement("div");
  card.className = "bk-task-card";
  card.innerHTML = `
    <div class="bk-tc-head">
      <span class="bk-priority-dot" style="background:${pColor}" title="${pLabel}"></span>
      <span class="bk-tc-id">${esc(t.id)}</span>
      ${t.feature ? `<span class="bk-feature-chip">${esc(t.feature)}</span>` : ""}
    </div>
    <div class="bk-tc-title">${esc(t.title)}</div>`;
  card.onclick = () => openTaskDetail(t.id);
  return card;
}

async function openTaskDetail(taskId) {
  selectedTaskId = taskId;
  try {
    const t = await api("GET", `/tasks/${encodeURIComponent(taskId)}`);
    const panel = $("taskDetailPanel");
    $("tdpId").textContent = t.id;
    $("tdpTitle").textContent = t.title;
    const pIdx = Math.min(Math.max(t.priority || 2, 0), 3);
    $("tdpFeature").textContent = t.feature ? `Feature: ${t.feature}` : "";
    $("tdpStatus").textContent = `Status: ${t.status}`;
    $("tdpOrigin").textContent = t.origin_quote
      ? `"${t.origin_quote}"${t.origin_source ? ` — ${t.origin_source}` : ""}`
      : "—";
    $("tdpDescription").textContent = t.description || "—";
    // Node chips
    const nodesEl = $("tdpNodes");
    nodesEl.innerHTML = "";
    if (t.nodes && t.nodes.length) {
      for (const nid of t.nodes) {
        const chip = document.createElement("span");
        chip.className = "bk-node-chip";
        chip.textContent = nid;
        nodesEl.appendChild(chip);
      }
    } else {
      nodesEl.textContent = "None";
    }
    // Move buttons
    const moveBtns = $("tdpMoveButtons");
    moveBtns.innerHTML = "";
    for (const col of BACKLOG_COLS) {
      if (col.id === t.status) continue;
      const btn = document.createElement("button");
      btn.className = "tiny";
      btn.textContent = col.label;
      btn.style.borderColor = col.color;
      btn.onclick = async () => {
        try {
          await api("POST", `/tasks/${encodeURIComponent(t.id)}/move`, { status: col.id });
          await renderBacklog();
          openTaskDetail(t.id);
        } catch (ex) { log(`move task: ${ex.message}`, "err"); }
      };
      moveBtns.appendChild(btn);
    }
    panel.style.display = "";
  } catch (ex) {
    log(`task detail: ${ex.message}`, "err");
  }
}

$("btnCloseDetail").onclick = () => { $("taskDetailPanel").style.display = "none"; };

$("btnAddTask").onclick = () => {
  const form = $("addTaskForm");
  form.style.display = form.style.display === "none" ? "" : "none";
};

$("btnTaskCancel").onclick = () => { $("addTaskForm").style.display = "none"; };

$("btnTaskSubmit").onclick = async () => {
  if (!currentProjectId) { log("No project selected", "err"); return; }
  const title = $("taskTitle").value.trim();
  if (!title) { log("Title is required", "err"); return; }
  const feature = $("taskFeature").value.trim() || null;
  const priority = parseInt($("taskPriority").value, 10);
  try {
    await api("POST", "/tasks", { project_id: currentProjectId, title, feature, priority });
    $("taskTitle").value = "";
    $("taskFeature").value = "";
    $("taskPriority").value = "2";
    $("addTaskForm").style.display = "none";
    await renderBacklog();
  } catch (ex) { log(`add task: ${ex.message}`, "err"); }
};

// ---- init -----------------------------------------------------------------
(async () => {
  await loadAccounts();
  await loadRoles();
  await loadCurrentProject();
  pollMissions();
  pollBrakes();
  await pollSessions();
  // ensure the orchestrator exists and make it the default focus.
  await focusOrchestrator();
})();
log("ready — chat with 🧠 Orchestrator, or use Advanced to spawn manually.");
