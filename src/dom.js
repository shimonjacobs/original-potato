/* Small DOM helpers shared by the UI files. */
const Dom = (function () {
  function $(id) { return document.getElementById(id); }

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function download(filename, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* actions: [{ action, id, label, primary, disabled }]; an action without its own id gets `defaultId`. */
  function actions(list, defaultId) {
    if (!list || !list.length) return "";
    return '<div class="card-actions">' + list.map(function (a) {
      return '<button type="button" class="' + (a.primary ? "primary" : "secondary") + '" data-action="' + a.action + '" data-id="' + esc(a.id || defaultId || "") + '"' + (a.disabled ? " disabled" : "") + ">" + esc(a.label) + "</button>";
    }).join("") + "</div>";
  }

  /* o: { highlight, blocked, tags, note, actions: [...] } */
  function dishCard(dish, o) {
    o = o || {};
    const t = dish.tags;
    const img = dish.image ? '<img class="dish-img" src="' + esc(dish.image) + '" alt="' + esc(dish.name) + '">' : "";
    const tags = o.tags
      ? '<div class="tag-row">' + t.mealType.map(function (v) { return '<span class="tag tag-meal">' + v + "</span>"; }).join("") +
        '<span class="tag tag-' + t.kosher + '">' + t.kosher + '</span><span class="tag">' + t.weight + '</span><span class="tag">' + t.temperature + "</span>" +
        t.occasion.map(function (v) { return '<span class="tag tag-occ">' + v + "</span>"; }).join("") +
        (t.ingredient || []).map(function (v) { return '<span class="tag tag-ing">' + esc(v) + "</span>"; }).join("") + "</div>" +
        '<div class="dish-meta">About ' + dish.prepTimeMinutes + " min</div>"
      : "";
    return '<div class="dish-card' + (o.highlight ? " highlight" : "") + (o.blocked ? " blocked" : "") + '">' + img +
      "<h3>" + esc(dish.name) + "</h3>" +
      '<p class="dish-description">' + esc(dish.description) + "</p>" +
      tags + (o.note ? '<div class="card-note">' + esc(o.note) + "</div>" : "") + actions(o.actions, dish.id) + "</div>";
  }

  return { $: $, esc: esc, download: download, actions: actions, dishCard: dishCard };
})();
