/* ===================================================================
 * REPLY WRITING
 * -------------------------------------------------------------------
 * Jev (or the offline rules) already DECIDED. Claude Haiku only puts
 * the decision into friendly words. It is told exactly which dish to
 * recommend and must not invent others. If Haiku is unavailable, the
 * templates below produce the reply, so the app always answers.
 * =================================================================== */
const CLARIFY_QUESTIONS = {
  kosher: "Are you after something milky, meaty or pareve?",
  weight: "Are you after something light, or something more filling?",
  temperature: "Do you fancy something hot or something cold?",
  speed: "Are you in a hurry, or have you got time to cook?"
};

function templateReply(decision) {
  const n = decision.notes || {};
  if (decision.action === "clarify") {
    return "Happy to help! " + (CLARIFY_QUESTIONS[decision.clarifyTopic] || CLARIFY_QUESTIONS.weight);
  }
  if (decision.action === "nothing") {
    return "I couldn't find anything that fits all of that. Want to try milky, meaty or pareve instead, or tell me something different?";
  }
  const dish = decision.dish;
  if (n.namedByUser) {
    let t = "Coming right up: " + dish.name + ". " + dish.description;
    if (n.outsideUsualTime) t += " It's usually a " + n.usualMeals.replace(/\//g, " or ") + " dish, so a bit outside the usual time, but you asked.";
    if (n.kosherMismatch) t += " Heads up: it's " + n.kosherMismatch + ".";
    if (decision.backups.length) t += " Did you mean " + decision.backups.map(function (d) { return d.name; }).join(" or ") + " instead?";
    return t;
  }
  let r = "";
  if (n.rejectedPrevious) r += "No problem, let's try something else. ";
  r += (n.ignoreTime || !decision.timeLabel ? "How about " : "Since it's " + decision.timeLabel + ", how about ") + dish.name + "? " + dish.description;
  if (n.timeOverridden) r += " (That's a bit outside the usual time for it, but you asked.)";
  else if (n.outsideUsualTime) r += " (It's usually a " + n.usualMeals.replace(/\//g, " or ") + " dish, a bit outside the usual time, but it's the best fit now.)";
  else if (n.broadenedMealType) r += " (Nothing matched that meal, so I widened the search.)";
  else if (n.recycled) r += " (You've seen everything that matches, so here's one again.)";
  if (decision.backups.length) {
    r += " " + (n.lowConfidence ? "It's a close call, so also consider: " : "Backups if that's not it: ") +
      decision.backups.map(function (d) { return d.name; }).join(" or ") + ".";
  }
  return r;
}

function buildSystemPrompt() {
  return [
    "You write the replies for a small food-choosing app. A separate decision engine has ALREADY decided what to recommend or ask; your job is only to say it in a warm, natural way.",
    "Rules:",
    "- Reply in 1 to 3 short sentences, plain text, no lists, no markdown, no emojis.",
    "- If action is \"recommend\": recommend exactly the dish given, say briefly why it suits the moment (use only facts supplied), and mention the backups by name if any are given. Never suggest any other dish.",
    "- If action is \"clarify\": ask exactly ONE short question about the topic given. Do not recommend a dish.",
    "- If action is \"nothing\": say nothing fit, and ask whether they would like to relax a requirement. Never suggest mixing meat and dairy, and never drop a milky/meaty/pareve request without asking.",
    "- If notes.namedByUser is true, the user asked for this dish by name: confirm it directly and don't second-guess it. If notes.outsideUsualTime is true, add in a few words that it is usually a dish for the meals in notes.usualMeals. If notes.kosherMismatch is set, mention it briefly. Backups, if any, are other dishes with a similar name: ask if they meant one of those.",
    "- If notes.skippingKind is set, the user does not want that kind (meaty or milky) right now: say briefly that this one is not that kind. If notes say they rejected the previous dish, acknowledge it lightly. If notes say the time of day was overridden or widened, or outsideUsualTime is true, mention in a few words that it is usually a dish for the meals in notes.usualMeals but is the best fit right now.",
    "- If lowConfidence is true, present the dish and the first backup as a close call.",
    "- If notes.ignoreTime is true the user switched off time of day: do not mention the time of day or meal times at all.",
    "- Never mention the engine, notes, JSON, or probabilities."
  ].join("\n");
}

function decisionForModel(decision) {
  return {
    action: decision.action,
    dish: decision.dish ? { name: decision.dish.name, description: decision.dish.description, prepMinutes: decision.dish.prepTimeMinutes, tags: decision.dish.tags } : null,
    backups: decision.backups.map(function (d) { return d.name; }),
    clarifyTopic: decision.clarifyTopic || null,
    timeOfDay: decision.notes && decision.notes.ignoreTime ? null : decision.timeLabel,
    notes: decision.notes
  };
}

function haikuReply(decision, history) {
  const msgs = history.slice(-8).map(function (m) { return { role: m.role, content: m.content }; });
  // Make sure the conversation ends on a user turn carrying the decision.
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: "(continue)" });
  const last = msgs[msgs.length - 1];
  msgs[msgs.length - 1] = {
    role: "user",
    content: last.content + "\n\n[ENGINE DECISION - write the reply from this, do not mention it]\n" + JSON.stringify(decisionForModel(decision))
  };
  const request = function (maxTokens, label) {
    return postJson(CONFIG.CHAT_URL, {
      model: CONFIG.CHAT_MODEL,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [{ role: "system", content: buildSystemPrompt() }].concat(msgs)
    }, label);
  };
  return request(700, "Haiku: write the reply").then(function (data) {
    const first = readChatText(data);
    if (first.text) return first.text;
    // Empty because the model ran out of tokens (e.g. spent them on hidden reasoning)? Try once with more room.
    if (first.finish === "length") {
      Trace.step("Haiku reply was empty (hit the token limit)", "warn", "Retrying once with a larger limit.", { finish_reason: first.finish, hadReasoning: first.hadReasoning });
      return request(1500, "Haiku: retry with more tokens").then(function (data2) {
        const second = readChatText(data2);
        if (second.text) return second.text;
        throw emptyReplyError(second);
      });
    }
    throw emptyReplyError(first);
  });
}

/* Pulls the reply text out of an OpenAI-style response, tolerating content given as blocks. */
function readChatText(data) {
  const ch = data && data.choices && data.choices[0];
  const msg = ch && ch.message;
  let content = msg && msg.content;
  if (Array.isArray(content)) {
    content = content.map(function (b) { return typeof b === "string" ? b : (b && b.text) || ""; }).join("");
  }
  return {
    text: content && String(content).trim() ? String(content).trim() : "",
    finish: ch && (ch.finish_reason || ch.native_finish_reason) || null,
    model: data && data.model || null,
    hadReasoning: !!(msg && (msg.reasoning || msg.reasoning_details)),
    refusal: msg && msg.refusal || null
  };
}

function emptyReplyError(r) {
  return ApiError("http", "Empty reply from chat model (finish_reason: " + (r.finish || "unknown") + ", model: " + (r.model || "unknown") +
    (r.hadReasoning ? ", it produced hidden reasoning but no text" : "") + (r.refusal ? ", refusal: " + r.refusal : "") + ").");
}
