/* ===================================================================
 * DEBUG TAB - shows what Trace recorded (only when Debug mode is on).
 * =================================================================== */
const STATUS_WORDS = { ok: "OK", skip: "skipped", warn: "fallback", error: "ERROR", info: "info" };

function debugStepHtml(st) {
  let data = "";
  if (st.data !== undefined) data = "<details><summary>details</summary><pre>" + escapeHtml(JSON.stringify(st.data, null, 2)) + "</pre></details>";
  return '<li class="dstep ds-' + st.status + '"><span class="dbadge">' + STATUS_WORDS[st.status] + "</span> <b>" + escapeHtml(st.title) + '</b> <span class="muted">+' + st.ms + " ms</span>" +
    (st.detail ? '<div class="ddetail">' + escapeHtml(st.detail) + "</div>" : "") + data + "</li>";
}

function renderDebug(openId) {
  const box = $("debug-list");
  if (!box) return;
  const turns = Trace.turns();
  if (!turns.length) { box.innerHTML = '<p class="mempty">Nothing recorded yet. Send a message in Chat and the steps will appear here.</p>'; return; }
  box.innerHTML = turns.map(function (t, i) {
    const bad = t.steps.some(function (s) { return s.status === "error"; });
    const open = (openId ? t.id === openId : i === 0) ? " open" : "";
    return '<details class="dturn' + (bad ? " has-error" : "") + '" id="dturn-' + t.id + '"' + open + "><summary><b>#" + t.id + "</b> " + escapeHtml(t.input && t.input.text ? '"' + t.input.text + '"' : "(" + (t.input && t.input.action) + ")") +
      " &rarr; " + escapeHtml(t.result && t.result.dish ? t.result.dish : (t.result && t.result.action) || "...") + ' <span class="muted">' + (t.totalMs == null ? "" : t.totalMs + " ms") + (bad ? " , has errors" : "") + "</span></summary>" +
      '<ol class="dsteps">' + t.steps.map(debugStepHtml).join("") + "</ol>" +
      (t.result ? '<details><summary>final result</summary><pre>' + escapeHtml(JSON.stringify(t.result, null, 2)) + "</pre></details>" : "") + "</details>";
  }).join("");
}

function showDebugTurn(id) {
  $("debug-tab-btn").click();
  renderDebug(id);
  const el = $("dturn-" + id);
  if (el) el.scrollIntoView({ block: "start" });
}

function applyDebugMode() {
  const on = Trace.isOn();
  $("debug-tab-btn").style.display = on ? "" : "none";
  $("debug-toggle").checked = on;
  if (!on && $("debug-page").classList.contains("active")) $("chat-tab-btn").click();
  renderDebug();
}

function initDebug() {
  $("debug-toggle").addEventListener("change", function (e) { Trace.setOn(e.target.checked); applyDebugMode(); });
  $("debug-clear-btn").addEventListener("click", function () { Trace.clear(); renderDebug(); });
  $("debug-copy-btn").addEventListener("click", function () {
    const btn = $("debug-copy-btn");
    const done = function (ok) { btn.textContent = ok ? "Copied" : "Copy failed (use Download)"; setTimeout(function () { btn.textContent = "Copy all"; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(Trace.exportJson()).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });
  $("debug-download-btn").addEventListener("click", function () {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([Trace.exportJson()], { type: "application/json" }));
    a.download = "what-should-i-eat-debug.json";
    document.body.appendChild(a); a.click(); a.remove();
  });
  applyDebugMode();
}
