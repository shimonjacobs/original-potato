/* The Settings panel. Everyday options on top; Developer settings (Debug mode,
 * manual key, dish import / export) tucked away below. */
const SettingsUI = (function () {
  const $ = Dom.$;

  function setStatus(text) { $("suggest-status").textContent = text; }

  function refreshMeals() {
    const n = Store.recentEaten().length;
    $("meals-note").textContent = "Remembering " + n + " recent meal" + (n === 1 ? "" : "s") + ".";
  }

  function applyDebug() {
    const on = Debug.isOn();
    document.body.classList.toggle("debug-on", on);
    $("debug-toggle").checked = on;
    if (!on && $("debug-page").classList.contains("active")) App.showPage(document.body.classList.contains("offline") ? "browse-page" : "chat-page");
    DebugUI.render();
  }

  function applyChips() {
    const on = Store.flag("chips", true); // on unless switched off
    document.body.classList.toggle("show-chips", on);
    $("chips-toggle").checked = on;
    ChatUI.renderChips();
  }

  function applyKeyPlaceholder() {
    $("key-input").value = "";
    $("key-input").placeholder = Store.devKey() ? "Key saved in this browser (paste to replace)" : "Optional: paste an OpenRouter key";
  }

  function init() {
    $("settings-btn").addEventListener("click", function () { $("settings-panel").classList.toggle("open"); });

    $("chips-toggle").addEventListener("change", function (e) { Store.setFlag("chips", e.target.checked); applyChips(); });
    $("meals-clear-btn").addEventListener("click", function () { Store.clearEaten(); refreshMeals(); ChatUI.renderChips(); });
    $("retry-btn").addEventListener("click", function () { App.retry(); });

    $("debug-toggle").addEventListener("change", function (e) { Debug.setOn(e.target.checked); applyDebug(); });
    $("key-save-btn").addEventListener("click", function () {
      const v = $("key-input").value.trim();
      if (v) Store.setDevKey(v);
      applyKeyPlaceholder();
    });
    $("key-clear-btn").addEventListener("click", function () { Store.setDevKey(""); applyKeyPlaceholder(); });

    $("export-btn").addEventListener("click", function () {
      Dom.download("my-dishes.json", Dishes.exportJson(), "application/json");
      EditorUI.message("Exported " + Dishes.all().length + " dishes to my-dishes.json.");
    });
    $("import-btn").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const r = Dishes.importJson(String(reader.result));
        if (r.ok) { EditorUI.render(); BrowseUI.refresh(); }
        EditorUI.message(r.message, !r.ok);
        App.showPage("edit-page");
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    applyKeyPlaceholder();
    applyDebug();
    applyChips();
    refreshMeals();
  }

  return { init: init, setStatus: setStatus, refreshMeals: refreshMeals };
})();
