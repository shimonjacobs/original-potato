/* ===================================================================
 * UI
 * =================================================================== */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function $(id) { return document.getElementById(id); }

function dishCardHtml(dish, o) {
  o = o || {};
  const t = dish.tags;
  const tags = []
    .concat(t.mealType.map(function (v) { return '<span class="tag tag-meal">' + v + "</span>"; }))
    .concat(['<span class="tag tag-' + t.kosher + '">' + t.kosher + "</span>", '<span class="tag">' + t.weight + "</span>",
      '<span class="tag">' + t.temperature + "</span>"])
    .concat(t.occasion.map(function (v) { return '<span class="tag tag-occ">' + v + "</span>"; }));

  let conf = "";
  if (typeof o.confidence === "number") {
    const pct = Math.round(o.confidence * 100);
    conf = '<div class="confidence" title="How sure Jev is about this pick"><span>Jev confidence</span>' +
      '<div class="bar"><div class="fill" style="width:' + pct + '%"></div></div><b>' + pct + "%</b></div>";
  }
  let backups = "";
  if (o.backups && o.backups.length) {
    backups = '<div class="backups"><span>Also good:</span>' + o.backups.map(function (b) {
      return '<button type="button" class="chip" data-action="pick" data-id="' + b.id + '">' + escapeHtml(b.name) + "</button>";
    }).join("") + "</div>";
  }
  let actions = "";
  if (o.actions) {
    actions = '<div class="card-actions">' +
      '<button type="button" class="primary" data-action="eat" data-id="' + dish.id + '">I\'ll have this</button>' +
      '<button type="button" class="secondary" data-action="reject" data-id="' + dish.id + '">Not this one</button></div>';
  }
  const img = dish.image ? '<img class="dish-img" src="' + escapeHtml(dish.image) + '" alt="' + escapeHtml(dish.name) + '">' : "";
  return '<div class="dish-card' + (o.highlight ? " highlight" : "") + '">' + img +
    "<h3>" + escapeHtml(dish.name) + "</h3>" +
    '<p class="dish-description">' + escapeHtml(dish.description) + "</p>" +
    '<div class="tag-row">' + tags.join("") + "</div>" +
    '<div class="dish-meta">About ' + dish.prepTimeMinutes + " min</div>" +
    conf + backups + actions + "</div>";
}

/* ---- tabs ---- */
function initTabs() {
  const buttons = document.querySelectorAll("[data-tab]");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      // Highlight the tab in the bar. My Dishes lives in Settings, so it highlights nothing.
      document.querySelectorAll("nav [data-tab]").forEach(function (b) { b.classList.remove("active"); });
      if (btn.closest("nav")) btn.classList.add("active");
      $("settings-panel").classList.remove("open");
      document.querySelectorAll(".page").forEach(function (p) { p.classList.remove("active"); });
      $(btn.getAttribute("data-tab")).classList.add("active");
    });
  });
}

/* ---- status badge ---- */
let lastStatus = { mode: Store.hasAi() ? "ready" : "rules", note: "" };

function renderStatus() {
  const el = $("status-badge");
  const m = lastStatus.mode;
  const text = m === "full" ? "Jev + Haiku" : m === "jev" ? "Jev + templates" : m === "ready" ? "Jev + Haiku ready" : m === "degraded" ? "Offline rules (API issue)" : "Offline rules";
  el.textContent = text;
  el.className = "status status-" + m;
  el.title = lastStatus.note || "Click to open settings";
}

/* ---- chat ---- */
const GREETING = "Hi! Tell me what you're in the mood for, or just say \"I'm hungry\", and I'll suggest something that fits the time of day.";
let session = newSession();
let busy = false;

function addBubble(role, text, card, traceId) {
  const win = $("chat-window");
  const b = document.createElement("div");
  b.className = "chat-bubble " + role;
  const t = document.createElement("div");
  t.className = "chat-text";
  t.textContent = text;
  b.appendChild(t);
  if (card) {
    const wrap = document.createElement("div");
    wrap.innerHTML = card;
    b.appendChild(wrap.firstChild);
  }
  if (traceId) {
    const l = document.createElement("button");
    l.type = "button"; l.className = "debug-link"; l.setAttribute("data-trace", traceId); l.textContent = "Debug trace";
    b.appendChild(l);
  }
  win.appendChild(b);
  win.scrollTop = win.scrollHeight;
  return b;
}

function setBusy(on) {
  busy = on;
  $("chat-input").disabled = on;
  $("chat-send-btn").disabled = on;
  document.querySelectorAll(".chip-mood, .kt-btn").forEach(function (c) { c.disabled = on; });
  const existing = $("thinking");
  if (on && !existing) {
    const b = document.createElement("div");
    b.id = "thinking";
    b.className = "chat-bubble assistant chat-loading";
    b.textContent = "Thinking…";
    $("chat-window").appendChild(b);
    $("chat-window").scrollTop = $("chat-window").scrollHeight;
  } else if (!on && existing) {
    existing.remove();
    $("chat-input").focus();
  }
}

function showError(errors) {
  const el = $("chat-error");
  if (!errors || !errors.length) { el.style.display = "none"; return; }
  const seen = {};
  const lines = [];
  errors.forEach(function (e) {
    const msg = explainError(e);
    if (!seen[msg]) { seen[msg] = true; lines.push(msg); }
  });
  el.textContent = "Heads up: " + lines.join(" ") + (Trace.isOn() ? "" : " (Turn on Debug mode in Settings to see exactly what came back.)");
  el.style.display = "block";
}

/* ---- memory panel ---- */
const GROUP_TITLES = { now: "Right now", chat: "This chat", remembered: "Remembered" };

/* Keep the meaty/milky toggle in step with the real state (typed, read by Jev, or removed via a chip). */
function syncKosherToggle() {
  ["meaty", "milky"].forEach(function (k) {
    const b = $("kt-" + k);
    if (b) b.setAttribute("aria-pressed", session.kosher === k ? "true" : "false");
  });
}

function toggleKosher(kind) {
  if (busy) return;
  if (session.kosher === kind) { removeChip(session, "kosher"); }
  else { session.kosher = kind; session.kosherSrc = "typed"; session.skipKind = null; }
  renderMemory();
  showNudge(session.history.length > 0);
}

function renderMemory() {
  const chips = memoryChips(session);
  let html = "";
  ["now", "chat", "remembered"].forEach(function (g) {
    const items = chips.filter(function (c) { return c.group === g; });
    if (!items.length) return;
    html += "<h3>" + GROUP_TITLES[g] + '</h3><div class="mchips">' + items.map(function (c) {
      return '<span class="mchip mchip-' + c.source + (c.hard ? " hard" : "") + (c.restore ? " restore" : "") + '" title="' + escapeHtml(c.hint || "") + '">' +
        '<span class="mlabel">' + escapeHtml(c.label) + "</span>" +
        '<button type="button" class="mx" data-chip="' + escapeHtml(c.id) + '" aria-label="' + (c.restore ? "Use again" : "Remove") + '">' + (c.restore ? "&#8635;" : "&times;") + "</button></span>";
    }).join("") + "</div>";
  });
  if (!chips.some(function (c) { return c.group !== "now"; })) html += '<p class="mempty">Nothing learned yet. As we chat, what I pick up will show here.</p>';
  $("memory-chips").innerHTML = html;
  $("mem-count").textContent = String(chips.filter(function (c) { return c.group !== "now"; }).length);
  syncKosherToggle();
}

function showNudge(on) {
  $("memory-nudge").style.display = on ? "flex" : "none";
  $("mem-update-btn").style.display = on ? "" : "none"; // phone layout: shown in the collapsed bar
}

function setMemOpen(open) {
  $("chat-page").classList.toggle("mem-open", open);
  $("mem-bar").setAttribute("aria-expanded", open ? "true" : "false");
}

function doUpdateSuggestion() {
  if (busy) return;
  setMemOpen(false);
  addBubble("user", "Update the suggestion with my changes.");
  sendTurn("", { action: "refresh" });
}

function handleMemoryClick(e) {
  const btn = e.target.closest("[data-chip]");
  if (!btn || busy) return;
  if (removeChip(session, btn.getAttribute("data-chip"))) {
    renderMemory();
    refreshMemoryNote();
    showNudge(session.history.length > 0);
  }
}

async function sendTurn(text, opts) {
  if (busy) return;
  showNudge(false);
  setBusy(true);
  session.history.push({ role: "user", content: text || "Please update my suggestion." });
  try {
    const res = await runTurn(session, text, opts);
    const d = res.decision;
    session.history.push({ role: "assistant", content: res.reply });
    addBubble("assistant", res.reply, d.action === "recommend"
      ? dishCardHtml(d.dish, { highlight: true, confidence: d.confidence, backups: d.backups, actions: true }) : null, res.traceId);
    showError(res.errors);
    if (res.engine.named && !res.errors.length) { /* no model was needed; keep the current status */ }
    else lastStatus = res.errors.length && !res.engine.jev
      ? { mode: "degraded", note: explainError(res.errors[0]) }
      : { mode: res.engine.jev ? (res.engine.haiku ? "full" : "jev") : (Store.hasAi() ? "degraded" : "rules"), note: res.errors.length ? explainError(res.errors[0]) : "" };
  } catch (err) {
    showError([err]);
  }
  renderDebug();
  renderStatus();
  renderMemory();
  setBusy(false);
}

function handleSubmit(e) {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  addBubble("user", text);
  sendTurn(text);
}

function handleChatClick(e) {
  const dl = e.target.closest("[data-trace]");
  if (dl) { showDebugTurn(Number(dl.getAttribute("data-trace"))); return; }
  const btn = e.target.closest("[data-action]");
  if (!btn || busy) return;
  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const dish = dishById(id);
  if (!dish) return;

  if (action === "eat") {
    Store.recordEaten(id);
    btn.closest(".card-actions").innerHTML = '<span class="saved">Noted, enjoy! I\'ll steer clear of it for a day or so.</span>';
    refreshMemoryNote();
    renderMemory();
  } else if (action === "reject") {
    btn.closest(".card-actions").remove();
    addBubble("user", "Not this one, something else please.");
    sendTurn("Not this one, something else please.", { action: "reject" });
  } else if (action === "pick") {
    // Jump straight to a runner-up, no API call needed.
    session.lastDish = dish;
    if (session.suggestedIds.indexOf(id) === -1) session.suggestedIds.push(id);
    const text = "Good choice, here's " + dish.name + ".";
    session.history.push({ role: "assistant", content: text });
    addBubble("assistant", text, dishCardHtml(dish, { highlight: true, actions: true }));
    renderMemory();
  }
}

function resetChat() {
  session = newSession();
  Store.clearRejected(); // turned-down dishes only last for one chat
  $("chat-window").innerHTML = "";
  addBubble("assistant", GREETING);
  showError(null);
  showNudge(false);
  renderMemory();
}

function initChat() {
  addBubble("assistant", GREETING);
  $("chat-form").addEventListener("submit", handleSubmit);
  $("chat-reset-btn").addEventListener("click", resetChat);
  $("mem-reset-btn").addEventListener("click", function () { setMemOpen(false); resetChat(); });
  $("mem-bar").addEventListener("click", function () { setMemOpen(!$("chat-page").classList.contains("mem-open")); });
  $("mem-update-btn").addEventListener("click", doUpdateSuggestion);
  $("chat-window").addEventListener("click", handleChatClick);
  $("memory-panel").addEventListener("click", handleMemoryClick);
  $("nudge-btn").addEventListener("click", doUpdateSuggestion);
  $("kt-meaty").addEventListener("click", function () { toggleKosher("meaty"); });
  $("kt-milky").addEventListener("click", function () { toggleKosher("milky"); });
  document.querySelectorAll(".chip-mood").forEach(function (c) {
    c.addEventListener("click", function () {
      if (busy) return;
      const text = c.getAttribute("data-text");
      addBubble("user", text);
      sendTurn(text);
    });
  });
}

/* ---- settings ---- */
function refreshMemoryNote() {
  const s = Store.summary();
  $("memory-note").textContent = "Remembering " + s.eaten + " meals you've eaten. Dishes you turn down are forgotten when you start over.";
}

function initSettings() {
  const panel = $("settings-panel");
  const toggle = function () { panel.classList.toggle("open"); };
  $("settings-btn").addEventListener("click", toggle);
  $("status-badge").addEventListener("click", toggle);

  $("key-input").value = "";
  $("key-input").placeholder = Store.hasStoredKey() ? "Key saved in this browser (paste to replace)" : (CONFIG.OPENROUTER_API_KEY ? "Using the key built into this file" : (CONFIG.PROXY_URL ? "Optional: using the shared proxy" : "Paste your OpenRouter key"));

  $("key-save-btn").addEventListener("click", function () {
    const v = $("key-input").value.trim();
    if (v) { Store.setKey(v); $("key-input").value = ""; $("key-input").placeholder = "Key saved in this browser (paste to replace)"; }
    lastStatus = { mode: Store.hasAi() ? "ready" : "rules", note: "" };
    renderStatus();
    $("test-result").textContent = v ? "Key saved. Press Test connection." : "Nothing pasted.";
  });
  $("key-clear-btn").addEventListener("click", function () {
    Store.setKey("");
    $("key-input").placeholder = CONFIG.OPENROUTER_API_KEY ? "Using the key built into this file" : (CONFIG.PROXY_URL ? "Optional: using the shared proxy" : "Paste your OpenRouter key");
    lastStatus = { mode: Store.hasAi() ? "ready" : "rules", note: "" };
    renderStatus();
    $("test-result").textContent = "Saved key removed.";
  });
  $("test-btn").addEventListener("click", async function () {
    const out = $("test-result");
    out.textContent = "Testing…";
    const results = await testConnection();
    out.innerHTML = results.map(function (r) {
      return '<div class="' + (r.ok ? "ok" : "bad") + '"><b>' + (r.ok ? "OK" : "Problem") + "</b> " + escapeHtml(r.name) + ": " + escapeHtml(r.detail) + "</div>";
    }).join("");
  });
  $("memory-clear-btn").addEventListener("click", function () {
    Store.clearTaste();
    refreshMemoryNote();
    renderMemory();
  });
  refreshMemoryNote();
}

/* ---- browse ---- */
const MULTI = ["mealType", "occasion"];
const SINGLE = ["kosher", "weight", "temperature"];
const browse = { filters: {}, search: "" };

function matchesBrowse(dish) {
  for (const dim in browse.filters) {
    const wanted = browse.filters[dim];
    if (!wanted || !wanted.length) continue;
    const v = dish.tags[dim];
    if (Array.isArray(v)) {
      if (!wanted.some(function (w) { return v.indexOf(w) !== -1; })) return false;
    } else if (wanted.indexOf(v) === -1) return false;
  }
  if (browse.search) {
    const n = browse.search.toLowerCase();
    if (dish.name.toLowerCase().indexOf(n) === -1 && dish.description.toLowerCase().indexOf(n) === -1) return false;
  }
  return true;
}

function renderGrid() {
  const list = DISHES.filter(matchesBrowse);
  $("dish-grid").innerHTML = list.length
    ? '<div class="dish-grid">' + list.map(function (d) { return dishCardHtml(d); }).join("") + "</div>"
    : "<p>No dishes match those filters.</p>";
  $("dish-count").textContent = list.length + " of " + DISHES.length + " dishes";
}

const FILTER_LABELS = { mealType: "Meal type", occasion: "Occasion", kosher: "Milky / meaty / pareve", weight: "Weight", temperature: "Temperature" };

function buildFilters() {
  let html = "";
  MULTI.forEach(function (dim) {
    html += '<div class="filter-group"><h3>' + FILTER_LABELS[dim] + "</h3>" + TAG_VOCAB[dim].map(function (v) {
      return '<label class="filter-checkbox"><input type="checkbox" data-dimension="' + dim + '" data-value="' + v + '"> ' + v + "</label>";
    }).join("") + "</div>";
  });
  SINGLE.forEach(function (dim) {
    html += '<div class="filter-group"><h3>' + FILTER_LABELS[dim] + '</h3><select data-dimension="' + dim + '"><option value="">Any</option>' +
      TAG_VOCAB[dim].map(function (v) { return '<option value="' + v + '">' + v + "</option>"; }).join("") + "</select></div>";
  });
  $("filter-groups").innerHTML = html;

  $("filter-groups").querySelectorAll('input[type="checkbox"]').forEach(function (c) {
    c.addEventListener("change", function () {
      const dim = c.getAttribute("data-dimension"), val = c.getAttribute("data-value");
      const cur = browse.filters[dim] || [];
      browse.filters[dim] = c.checked ? cur.concat([val]) : cur.filter(function (x) { return x !== val; });
      renderGrid();
    });
  });
  $("filter-groups").querySelectorAll("select").forEach(function (s) {
    s.addEventListener("change", function () {
      browse.filters[s.getAttribute("data-dimension")] = s.value ? [s.value] : [];
      renderGrid();
    });
  });
}

// Called after the dish list changes (editor): rebuild filters, clear them, redraw.
function refreshBrowse() {
  browse.filters = {};
  browse.search = "";
  $("search-box").value = "";
  buildFilters();
  renderGrid();
}

function initBrowse() {
  $("filters-toggle").addEventListener("click", function () {
    const open = !document.querySelector(".filter-panel").classList.contains("open");
    document.querySelector(".filter-panel").classList.toggle("open", open);
    $("filters-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  });
  buildFilters();
  $("search-box").addEventListener("input", function (e) { browse.search = e.target.value; renderGrid(); });
  $("clear-filters-btn").addEventListener("click", refreshBrowse);
  renderGrid();
}

document.addEventListener("DOMContentLoaded", function () {
  initTabs();
  initChat();
  initSettings();
  initBrowse();
  initDebug();
  renderStatus();
  renderMemory();
});
