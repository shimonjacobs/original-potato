/* How a decision is put into words. Pure: no network. Claude Haiku (via Turn)
 * is told exactly which dish to mention; the template below is used when Haiku
 * is unavailable. Replies are kept short, neutral and free of pressure. */
const Wording = (function () {
  /* decision: { action: "recommend" | "exhausted" | "nothing", dish, blocked, rejectedPrevious, notOnList, closest, prefsText, timeLabel } */
  function template(d) {
    if (d.action === "nothing") return "Everything on your list has dairy, and meaty is on. You can switch meaty off if you're ready.";
    if (d.action === "exhausted") return "That's everything on your list that is " + d.prefsText + ". Want to see anything else, or choose from the list?";
    let lead = "";
    if (d.blocked) lead = d.blocked.name + " has dairy, and meaty is on. ";
    else if (d.notOnList) lead = "That isn't on your list. ";
    else if (d.rejectedPrevious) lead = "OK. ";
    const close = d.closest ? "Nothing on your list is exactly " + d.prefsText + ", so here's the closest. " : "";
    return lead + close + "How about " + d.dish.name + "? " + d.dish.description;
  }

  const SYSTEM = [
    "You write the replies for a small food-choosing app used by someone who finds choosing food hard. A separate engine has ALREADY decided what to suggest; you only put it in words.",
    "Rules:",
    "- Reply in one or two short sentences, plain text, no lists, no markdown, no emojis.",
    "- Mention exactly the dish given in dish.name and never any other dish. You may say briefly why it suits the moment, using only the facts supplied.",
    "- Be calm and neutral. Never pressure, never mention health, nutrition, variety, trying new foods or what they should eat.",
    "- If rejectedPrevious is true, start with a light \"OK\" or \"No problem\".",
    "- If blocked is set, the user asked for that dish but it has dairy and they are meaty right now. Say so in a few words, then suggest dish.name instead. Do not lecture.",
    "- If notOnList is true, the user asked for a food that isn't on their list: say so in a few words, then suggest dish.name.",
    "- If closest is true, nothing on their list is exactly prefsText: say that in a few words and present dish.name as the closest.",
    "- If action is \"exhausted\", there is no dish: say that is everything on their list that is prefsText, and ask if they would like to see anything else or choose from the list. Do not suggest a dish.",
    "- If action is \"nothing\", say everything on their list has dairy and meaty is on, and that they can switch meaty off.",
    "- If timeLabel is null, do not mention the time of day.",
    "- Never mention the engine, JSON, or probabilities."
  ].join("\n");

  function forModel(d) {
    return { action: d.action, dish: d.dish ? { name: d.dish.name, description: d.dish.description } : null, blocked: d.blocked ? d.blocked.name : null, rejectedPrevious: !!d.rejectedPrevious,
      notOnList: !!d.notOnList, closest: !!d.closest, prefsText: d.prefsText || null, timeLabel: d.timeLabel || null };
  }

  /* history: [{ role, content }] ending with the user's turn. */
  function messages(d, history) {
    const msgs = history.slice(-6).map(function (m) { return { role: m.role, content: m.content }; });
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: "(continue)" });
    const last = msgs[msgs.length - 1];
    msgs[msgs.length - 1] = { role: "user", content: last.content + "\n\n[ENGINE DECISION - write the reply from this, do not mention it]\n" + JSON.stringify(forModel(d)) };
    return [{ role: "system", content: SYSTEM }].concat(msgs);
  }

  return { template: template, messages: messages };
})();
