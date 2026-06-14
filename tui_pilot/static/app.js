// tui-pilot agent control panel — multi-session. Talks only to the HTTP API.
"use strict";

const $ = (id) => document.getElementById(id);
const el = {
  role: $("role"), roleDesc: $("roleDesc"), name: $("name"), cwd: $("cwd"),
  mode: $("mode"), modeWarn: $("modeWarn"), instructions: $("instructions"),
  task: $("task"), spawn: $("btnSpawn"),
  killAll: $("btnKillAll"), agents: $("agents"), summary: $("summary"),
  screen: $("screen"), prompt: $("prompt"), send: $("btnSend"),
  focusTitle: $("focusTitle"), focusPill: $("focusPill"), focusState: $("focusState"),
  approve: $("btnApprove"), deny: $("btnDeny"), interrupt: $("btnInterrupt"),
  keyBtn: $("btnKey"), customKey: $("customKey"), hist: $("histChk"), poll: $("pollChk"),
  json: $("json"), copyJson: $("btnCopyJson"), log: $("log"),
};

let roles = [];
let sessions = [];          // latest GET /sessions snapshot
let current = null;         // focused session name
let pending = new Set();    // sessions with an in-flight prompt
let lastJson = "{ }";
let spawnCount = 0;

// ---- utilities ------------------------------------------------------------

function log(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.log.prepend(line);
}

function showJson(label, value) {
  const pretty = JSON.stringify(value, null, 2);
  lastJson = pretty;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = esc(pretty)
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

const findSession = (name) => sessions.find((s) => s.name === name);

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
  while (findSession(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ---- agents list ----------------------------------------------------------

function renderAgents() {
  el.summary.textContent = `${sessions.length} agent${sessions.length === 1 ? "" : "s"}`;
  el.killAll.disabled = sessions.length === 0;
  el.agents.innerHTML = "";
  for (const s of sessions) {
    const card = document.createElement("div");
    card.className = `card st-${s.state}` + (s.name === current ? " active" : "");
    const prep = s.prep && s.prep !== "ready" ? `<span class="badge prep-${s.prep}">${s.prep}</span>` : "";
    const busy = pending.has(s.name) ? `<span class="badge prep-working">working…</span>` : "";
    const esc = (t) => (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const task = s.task ? `<div class="task" title="${esc(s.task)}">▸ ${esc(s.task)}</div>` : "";
    card.innerHTML = `
      <div class="top">
        <span class="emoji">${s.emoji || "💬"}</span>
        <span class="nm" title="${s.name}">${s.name}</span>
        <button class="x" title="kill">✕</button>
      </div>
      <div class="meta">
        <span class="pill s-${s.state}"><span class="dot"></span>${s.state}</span>
        <span class="badge">${s.mode || "normal"}</span>
        ${prep}${busy}
      </div>
      <div class="role">${s.label || s.role || s.cmd}</div>
      ${task}`;
    card.onclick = (ev) => {
      if (ev.target.classList.contains("x")) { killSession(s.name); return; }
      focus(s.name);
    };
    el.agents.appendChild(card);
  }
}

function focus(name) {
  current = name;
  const s = findSession(name);
  el.focusTitle.textContent = s ? `${s.emoji || ""} ${s.name} — ${s.label || s.role || s.cmd}` : name;
  renderAgents();
  refreshScreen();
  updateFocusControls();
}

function updateFocusControls() {
  const s = current ? findSession(current) : null;
  const state = s ? s.state : "EXITED";
  el.focusState.textContent = s ? state : "—";
  el.focusPill.className = `pill s-${state}`;
  const alive = !!s && s.alive;
  const ready = s && s.prep === "ready";
  const busy = pending.has(current);
  el.prompt.disabled = !alive || busy || !ready;
  el.prompt.placeholder = !s ? "Message the focused agent…"
    : !ready ? `agent is ${s.prep}…` : busy ? "agent is working…" : "Message the focused agent and press Enter…";
  el.send.disabled = el.prompt.disabled;
  const isPerm = state === "AWAITING_PERMISSION";
  el.approve.disabled = !isPerm; el.deny.disabled = !isPerm;
  el.interrupt.disabled = !alive;
  document.querySelectorAll(".keys button, #btnKey").forEach((b) => (b.disabled = !alive));
}

// ---- polling --------------------------------------------------------------

async function pollSessions() {
  try {
    const data = await api("GET", "/sessions");
    sessions = data.sessions || [];
    if (current && !findSession(current)) current = null;
    renderAgents();
    updateFocusControls();
  } catch (e) { /* server momentarily busy */ }
}

async function refreshScreen() {
  if (!current) { el.screen.textContent = "No agent selected."; return; }
  try {
    el.screen.textContent = await api("GET", `/sessions/${current}/screen?history=${el.hist.checked}`);
  } catch (e) {
    if (String(e.message).startsWith("4")) el.screen.textContent = `(${current} is gone)`;
  }
}

setInterval(pollSessions, 1100);
setInterval(() => { if (el.poll.checked) refreshScreen(); }, 700);

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
    await api("POST", "/sessions", body, "spawn");
    log(`spawned ${name} (${el.role.value}, ${el.mode.value})` + (task ? ` · task: ${task.slice(0, 60)}` : ""), "ok");
    spawnCount++;
    await pollSessions();
    focus(name);
    el.task.value = "";
    el.name.value = nextName(el.role.value); el.name.dataset.auto = "1";
  } catch (e) {
    if (String(e.message).startsWith("409")) { log(`${name} exists — focusing it`, "ok"); focus(name); }
    else log(`spawn: ${e.message}`, "err");
  } finally {
    el.spawn.disabled = false;
  }
};

async function killSession(name) {
  try { await api("DELETE", `/sessions/${name}`, undefined, "kill"); log(`killed ${name}`, "ok"); }
  catch (e) { log(`kill: ${e.message}`, "err"); }
  if (current === name) { current = null; el.screen.textContent = "Agent killed."; }
  pending.delete(name);
  await pollSessions();
}

el.killAll.onclick = async () => {
  if (!sessions.length || !confirm(`Kill all ${sessions.length} agents?`)) return;
  for (const s of [...sessions]) await killSession(s.name);
};

async function sendPrompt() {
  if (!current) return;
  const name = current;
  const text = el.prompt.value.trim();
  if (!text) return;
  el.prompt.value = "";
  pending.add(name);
  log(`→ ${name}: ${text}`);
  updateFocusControls(); renderAgents();
  try {
    const r = await api("POST", `/sessions/${name}/prompt`, { text, timeout: 600 }, `prompt:${name}`);
    log(`← ${name} (${r.state}): ${r.response ? r.response.slice(0, 140) : "(empty)"}`, r.state === "ERROR" ? "err" : "ok");
  } catch (e) {
    log(`prompt ${name}: ${e.message}`, "err");
  } finally {
    pending.delete(name);
    updateFocusControls(); renderAgents();
    if (current === name) refreshScreen();
  }
}
el.send.onclick = sendPrompt;
el.prompt.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendPrompt(); } });

const act = async (verb, label) => {
  if (!current) return;
  try { await api("POST", `/sessions/${current}/${verb}`, undefined, label); log(`${label} → ${current}`, "ok"); }
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

// ---- init -----------------------------------------------------------------
loadRoles();
pollSessions();
log("ready — pick a role and spawn an agent.");
