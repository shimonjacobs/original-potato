/* The Chat tab: a suggestion card on open, "Not this one", and optional typing. */
const ChatUI = (function () {
  const $ = Dom.$;
  let busy = false;

  function eatOrReject(dish) {
    return [{ action: "eat", label: "I'll have this", primary: true }, { action: "reject", label: "Not this one" }];
  }

  function cardFor(decision) {
    const actions = eatOrReject(decision.dish);
    if (decision.blocked) actions.push({ action: "unblock", id: decision.blocked.id, label: "I'm not meaty now" });
    if (decision.offerList) actions.push({ action: "list", label: "Choose from the list" });
    let note = "";
    if (Debug.isOn() && typeof decision.confidence === "number") {
      note = "Jev confidence " + Math.round(decision.confidence * 100) + "%" + (decision.runnersUp && decision.runnersUp.length ? ". Runners-up: " + decision.runnersUp.map(function (d) { return d.name; }).join(", ") : "");
    }
    return Dom.dishCard(decision.dish, { highlight: true, actions: actions, note: note });
  }

  function bubble(role, text, cardHtml, traceId) {
    const win = $("chat-window");
    const b = document.createElement("div");
    b.className = "chat-bubble " + role;
    const t = document.createElement("div");
    t.textContent = text;
    b.appendChild(t);
    if (cardHtml) {
      const wrap = document.createElement("div");
      wrap.innerHTML = cardHtml;
      b.appendChild(wrap.firstChild);
    }
    if (traceId) {
      const l = document.createElement("button");
      l.type = "button"; l.className = "debug-link"; l.setAttribute("data-trace", traceId); l.textContent = "Debug trace";
      b.appendChild(l);
    }
    win.appendChild(b);
    win.scrollTop = win.scrollHeight;
  }

  function setBusy(on) {
    busy = on;
    document.querySelectorAll("#chat-input, #chat-send-btn, #hungry-btn, .chip-mood").forEach(function (el) { el.disabled = on; });
    const waiting = $("thinking");
    if (on && !waiting) {
      const b = document.createElement("div");
      b.id = "thinking";
      b.className = "chat-bubble assistant chat-loading";
      b.textContent = "Thinking…";
      $("chat-window").appendChild(b);
      $("chat-window").scrollTop = $("chat-window").scrollHeight;
    } else if (!on && waiting) waiting.remove();
  }

  async function send(text, opts) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await Turn.run(App.session(), text, opts);
      if (res.offline) App.goOffline(res.errors.length ? Ai.explain(res.errors[0]) : "Suggestions aren't available.");
      else bubble("assistant", res.reply, res.decision.dish ? cardFor(res.decision) : null, res.traceId);
    } catch (err) {
      App.goOffline("Something went wrong: " + (err && err.message));
    }
    setBusy(false);
    DebugUI.render();
    renderChips();
  }

  /* ---- optional chips panel ---- */
  function renderChips() {
    if (!document.body.classList.contains("show-chips")) return;
    $("chips").innerHTML = Chips.list(App.session()).map(function (c) {
      return '<span class="mchip' + (c.hard ? " hard" : "") + (c.restore ? " restore" : "") + '" title="' + Dom.esc(c.hint || "") + '"><span>' + Dom.esc(c.label) + "</span>" +
        '<button type="button" class="mx" data-chip="' + Dom.esc(c.id) + '" aria-label="' + (c.restore ? "Use again" : "Remove") + '">' + (c.restore ? "&#8635;" : "&times;") + "</button></span>";
    }).join("");
  }

  function onChipClick(e) {
    const btn = e.target.closest("[data-chip]");
    if (!btn || busy) return;
    if (Chips.remove(App.session(), btn.getAttribute("data-chip"))) {
      App.syncMeaty();
      renderChips();
      $("chips-update").hidden = false;
    }
  }

  function onChatClick(e) {
    const trace = e.target.closest("[data-trace]");
    if (trace) { DebugUI.show(Number(trace.getAttribute("data-trace"))); return; }
    const btn = e.target.closest("[data-action]");
    if (!btn || busy) return;
    const action = btn.getAttribute("data-action");
    const dish = Dishes.byId(btn.getAttribute("data-id"));
    if (action === "eat") App.eat(btn);
    else if (action === "list") App.showPage("browse-page");
    else if (action === "reject") {
      btn.closest(".card-actions").remove();
      bubble("user", "Not this one.");
      send("", { action: "reject" });
    } else if (action === "unblock" && dish) {
      App.setMeaty(false);
      btn.closest(".card-actions").remove();
      const reply = "OK, meaty is off. Here's " + dish.name + ".";
      Turn.offerDirect(App.session(), dish, reply);
      bubble("assistant", reply, Dom.dishCard(dish, { highlight: true, actions: eatOrReject(dish) }));
    }
  }

  /* Nothing is suggested until the user asks. */
  function hungry() {
    if (busy) return;
    bubble("user", "I'm hungry");
    send("", { action: "open" });
  }

  function reset() {
    $("chat-window").innerHTML = "";
    $("chips-update").hidden = true;
    renderChips();
  }

  function init() {
    $("hungry-btn").addEventListener("click", hungry);
    $("chat-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const text = $("chat-input").value.trim();
      if (!text || busy) return;
      $("chat-input").value = "";
      bubble("user", text);
      send(text);
    });
    $("chat-reset-btn").addEventListener("click", function () { if (!busy) { App.resetSession(); reset(); } });
    $("chat-window").addEventListener("click", onChatClick);
    $("chips").addEventListener("click", onChipClick);
    $("chips-update").addEventListener("click", function () {
      if (busy) return;
      $("chips-update").hidden = true;
      bubble("user", "Update the suggestion.");
      send("", { action: "refresh" });
    });
    document.querySelectorAll(".chip-mood").forEach(function (c) {
      c.addEventListener("click", function () {
        if (busy) return;
        bubble("user", c.getAttribute("data-text"));
        send(c.getAttribute("data-text"));
      });
    });
  }

  return { init: init, reset: reset, renderChips: renderChips };
})();
