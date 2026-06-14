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
  return `
    <div class="top">
      <span class="emoji">${isOrch(s) ? "🧠" : (s.emoji || "💬")}</span>
      <span class="nm" title="${esc(s.name)}">${esc(s.name)}</span>
      <button class="x" title="kill">✕</button>
    </div>
    ${cwd}
    <div class="meta">
      <span class="pill s-${s.state}"><span class="dot"></span>${s.state}</span>
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
  el.focusState.textContent = s ? state : "—";
  el.focusPill.className = `pill s-${state}`;
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

// ---- init -----------------------------------------------------------------
loadRoles();
pollMissions();
pollBrakes();
(async () => {
  await pollSessions();
  // ensure the orchestrator exists and make it the default focus.
  await focusOrchestrator();
})();
log("ready — chat with 🧠 Orchestrator, or use Advanced to spawn manually.");
