/* Every network call goes through here: Jev (decisions) and Claude Haiku
 * (wording). Calls go to the proxy worker, or straight to OpenRouter when a
 * developer key is set. Failures reject with an ApiError whose kind is one of
 * nokey | network | auth | credits | http. */
const Ai = (function () {
  function ApiError(kind, message, status) {
    const e = new Error(message);
    e.name = "ApiError";
    e.kind = kind;
    e.status = status || null;
    return e;
  }

  function available() { return !!(Store.devKey() || Config.PROXY_URL); }

  /* A dead link (bad key, no credits, no network) won't recover mid-chat. */
  function isDead(e) { return !!e && (e.kind === "nokey" || e.kind === "network" || e.kind === "auth" || e.kind === "credits"); }

  function explain(e) {
    if (!e) return "Unknown error";
    if (e.kind === "nokey") return "No connection is set up.";
    if (e.kind === "network") return "The request was blocked or there is no internet (often a school network or a browser CORS block).";
    if (e.kind === "auth") return "OpenRouter rejected the key (" + e.message + ").";
    if (e.kind === "credits") return "Out of OpenRouter credits.";
    return e.message || String(e);
  }

  function post(url, proxyPath, body, label) {
    const key = Store.devKey();
    const headers = { "Content-Type": "application/json" };
    let target = url;
    if (key) headers["Authorization"] = "Bearer " + key;
    else if (Config.PROXY_URL) target = Config.PROXY_URL.replace(/\/+$/, "") + proxyPath;
    else { Debug.step("API call: " + label, "error", "No key or proxy, request not sent."); return Promise.reject(ApiError("nokey", "No connection set up")); }

    const t0 = Date.now();
    return fetch(target, { method: "POST", headers: headers, body: JSON.stringify(body) }).then(function (res) {
      return res.text().then(function (raw) {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { /* not JSON */ }
        const ms = Date.now() - t0;
        if (res.ok && parsed !== null) {
          Debug.step("API call: " + label, "ok", "HTTP " + res.status + " in " + ms + " ms", { url: target, request: body, response: parsed });
          return parsed;
        }
        Debug.step("API call: " + label, "error", "HTTP " + res.status + " in " + ms + " ms", { url: target, request: body, responseText: String(raw).slice(0, 4000) });
        if (res.ok) throw ApiError("http", "Response was not JSON: " + String(raw).slice(0, 120), res.status);
        const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 402 ? "credits" : "http";
        throw ApiError(kind, "HTTP " + res.status + ": " + String(raw).slice(0, 200), res.status);
      });
    }, function (err) {
      Debug.step("API call: " + label, "error", "Network error after " + (Date.now() - t0) + " ms: " + (err && err.message), { url: target, request: body });
      throw ApiError("network", "Request blocked or offline: " + (err && err.message));
    });
  }

  /* Jev: a state plus typed questions in, typed answers with probabilities out. */
  function jev(state, questions, label) {
    return post(Config.JEV_URL, "/decisions", { model: Config.JEV_MODEL, state: state, questions: questions }, label).then(function (data) {
      if (!data || !data.answers) throw ApiError("http", "Unexpected Jev response");
      return data.answers;
    });
  }

  function readChatText(data) {
    const ch = data && data.choices && data.choices[0];
    const msg = ch && ch.message;
    let content = msg && msg.content;
    if (Array.isArray(content)) content = content.map(function (b) { return typeof b === "string" ? b : (b && b.text) || ""; }).join("");
    return { text: content && String(content).trim() ? String(content).trim() : "", finish: ch && (ch.finish_reason || ch.native_finish_reason) || null };
  }

  /* Haiku: messages in, reply text out. Retries once with more room if it ran out of tokens. */
  function chat(messages, label) {
    const request = function (maxTokens) {
      return post(Config.CHAT_URL, "/chat", { model: Config.CHAT_MODEL, max_tokens: maxTokens, temperature: 0.7, messages: messages }, label).then(readChatText);
    };
    return request(700).then(function (r) {
      if (r.text) return r.text;
      if (r.finish !== "length") throw ApiError("http", "Empty reply from chat model (finish_reason: " + (r.finish || "unknown") + ")");
      return request(1500).then(function (r2) {
        if (r2.text) return r2.text;
        throw ApiError("http", "Empty reply from chat model (hit the token limit twice)");
      });
    });
  }

  /* ---- Jev question builders and answer readers ---- */
  function noulQ(instructions, yes, no) { return { type: "noul", instructions: instructions, criteria: { "true": yes, "false": no } }; }
  function choiceQ(instructions, criteria) { return { type: "choice", instructions: instructions, criteria: criteria }; }
  function yes(answers, name) {
    const a = answers && answers[name];
    return a && typeof a.noul === "number" ? a.noul : 0;
  }
  function choice(answers, name) {
    const a = answers && answers[name];
    return a && a.choice ? { value: a.choice, confidence: typeof a.confidence === "number" ? a.confidence : 0, probabilities: a.probabilities || {} } : null;
  }

  return { ApiError: ApiError, available: available, isDead: isDead, explain: explain, jev: jev, chat: chat, noulQ: noulQ, choiceQ: choiceQ, yes: yes, choice: choice };
})();
