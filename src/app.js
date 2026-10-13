/* Startup, the page/tab switching, and the state shared across tabs: the chat
 * session (including the meaty switch), offline mode, and "I'll have this". */
const App = (function () {
  const $ = Dom.$;
  let session = Turn.newSession();

  function showPage(id) {
    document.querySelectorAll(".page").forEach(function (p) { p.classList.toggle("active", p.id === id); });
    document.querySelectorAll("nav [data-tab]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === id); });
    $("settings-panel").classList.remove("open");
  }

  /* The meaty switch lives in the header and applies to every tab. It is not remembered: a reload clears it. */
  function syncMeaty() {
    $("meaty-toggle").setAttribute("aria-pressed", session.meaty ? "true" : "false");
    BrowseUI.render();
  }
  function setMeaty(on) { session.meaty = on; syncMeaty(); ChatUI.renderChips(); }

  /* Start over keeps the meaty switch, since it is still showing in the header. */
  function resetSession() {
    const meaty = session.meaty;
    session = Turn.newSession();
    session.meaty = meaty;
  }

  /* Suggestions unavailable: show the plain list, with no chat. */
  function goOffline(reason) {
    document.body.classList.add("offline");
    SettingsUI.setStatus("List only. " + (reason || ""));
    showPage("browse-page");
  }
  function retry() {
    document.body.classList.remove("offline");
    SettingsUI.setStatus("Suggestions on.");
    resetSession();
    showPage("chat-page");
    ChatUI.reset();
  }

  /* "I'll have this": the only way meals are remembered. */
  function eat(btn) {
    Store.recordEaten(btn.getAttribute("data-id"));
    btn.closest(".card-actions").innerHTML = '<span class="saved">Noted, enjoy!</span>';
    SettingsUI.refreshMeals();
    ChatUI.renderChips();
  }

  function init() {
    Dishes.load();
    document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { showPage(b.getAttribute("data-tab")); }); });
    $("meaty-toggle").addEventListener("click", function () { setMeaty(!session.meaty); });
    BrowseUI.init();
    EditorUI.init();
    SettingsUI.init();
    ChatUI.init();
    DebugUI.init();
    if (Ai.available()) { SettingsUI.setStatus("Suggestions on."); ChatUI.open(); }
    else goOffline("No connection is set up.");
  }

  return { init: init, session: function () { return session; }, showPage: showPage, syncMeaty: syncMeaty, setMeaty: setMeaty, resetSession: resetSession, goOffline: goOffline, retry: retry, eat: eat };
})();

document.addEventListener("DOMContentLoaded", App.init);
