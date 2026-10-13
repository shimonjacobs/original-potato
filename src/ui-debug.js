/* The Debug tab: what Debug recorded (only when Debug mode is on). */
const DebugUI = (function () {
  const $ = Dom.$;
  const STATUS_WORDS = { ok: "OK", skip: "skipped", warn: "fallback", error: "ERROR", info: "info" };

  function stepHtml(s) {
    const data = s.data !== undefined ? "<details><summary>details</summary><pre>" + Dom.esc(JSON.stringify(s.data, null, 2)) + "</pre></details>" : "";
    return '<li class="dstep ds-' + s.status + '"><span class="dbadge">' + STATUS_WORDS[s.status] + "</span> <b>" + Dom.esc(s.title) + '</b> <span class="muted">+' + s.ms + " ms</span>" +
      (s.detail ? '<div class="ddetail">' + Dom.esc(s.detail) + "</div>" : "") + data + "</li>";
  }

  function render(openId) {
    const box = $("debug-list");
    const turns = Debug.turns();
    if (!turns.length) { box.innerHTML = '<p class="muted">Nothing recorded yet.</p>'; return; }
    box.innerHTML = turns.map(function (t, i) {
      const bad = t.steps.some(function (s) { return s.status === "error"; });
      const label = t.input && t.input.text ? '"' + t.input.text + '"' : "(" + (t.input && t.input.action) + ")";
      return '<details class="dturn' + (bad ? " has-error" : "") + '" id="dturn-' + t.id + '"' + ((openId ? t.id === openId : i === 0) ? " open" : "") + "><summary><b>#" + t.id + "</b> " + Dom.esc(label) +
        " &rarr; " + Dom.esc(t.result && t.result.dish ? t.result.dish : "...") + ' <span class="muted">' + (t.totalMs == null ? "" : t.totalMs + " ms") + "</span></summary>" +
        '<ol class="dsteps">' + t.steps.map(stepHtml).join("") + "</ol>" +
        (t.result ? "<details><summary>final result</summary><pre>" + Dom.esc(JSON.stringify(t.result, null, 2)) + "</pre></details>" : "") + "</details>";
    }).join("");
  }

  function show(id) {
    App.showPage("debug-page");
    render(id);
    const el = $("dturn-" + id);
    if (el) el.scrollIntoView({ block: "start" });
  }

  function init() {
    $("debug-clear-btn").addEventListener("click", function () { Debug.clear(); render(); });
    $("debug-copy-btn").addEventListener("click", function () {
      const btn = $("debug-copy-btn");
      const done = function (ok) { btn.textContent = ok ? "Copied" : "Copy failed (use Download)"; setTimeout(function () { btn.textContent = "Copy all"; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(Debug.exportJson()).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
    $("debug-download-btn").addEventListener("click", function () { Dom.download("what-should-i-eat-debug.json", Debug.exportJson(), "application/json"); });
  }

  return { init: init, render: render, show: show };
})();
