/* The Browse tab: every dish with photos, filters and search. Also the fallback
 * when suggestions are unavailable. Milky dishes grey out while meaty is on. */
const BrowseUI = (function () {
  const $ = Dom.$;
  const MULTI = ["mealType", "occasion"];
  const SINGLE = ["kosher", "weight", "temperature"];
  const LABELS = { mealType: "Meal type", occasion: "Occasion", kosher: "Milky / meaty / pareve", weight: "Weight", temperature: "Temperature" };
  const state = { filters: {}, search: "" };

  function matches(dish) {
    for (const dim in state.filters) {
      const wanted = state.filters[dim];
      if (!wanted || !wanted.length) continue;
      const v = dish.tags[dim];
      if (Array.isArray(v) ? !wanted.some(function (w) { return v.indexOf(w) !== -1; }) : wanted.indexOf(v) === -1) return false;
    }
    if (state.search) {
      const n = state.search.toLowerCase();
      if (dish.name.toLowerCase().indexOf(n) === -1 && dish.description.toLowerCase().indexOf(n) === -1) return false;
    }
    return true;
  }

  function render() {
    const shown = Dishes.all().filter(matches);
    const meaty = App.session().meaty;
    $("dish-grid").innerHTML = shown.length
      ? '<div class="dish-grid">' + shown.map(function (d) {
        const blocked = Rules.isBlocked(d, meaty);
        return Dom.dishCard(d, { tags: true, blocked: blocked, note: blocked ? "Dairy: not while meaty is on" : "", actions: [{ action: "eat", label: "I'll have this", primary: true, disabled: blocked }] });
      }).join("") + "</div>"
      : "<p>No dishes match those filters.</p>";
    $("dish-count").textContent = shown.length + " of " + Dishes.all().length + " dishes";
  }

  function buildFilters() {
    let html = "";
    MULTI.forEach(function (dim) {
      html += '<div class="filter-group"><h3>' + LABELS[dim] + "</h3>" + Dishes.VOCAB[dim].map(function (v) {
        return '<label class="filter-checkbox"><input type="checkbox" data-dimension="' + dim + '" data-value="' + v + '"> ' + v + "</label>";
      }).join("") + "</div>";
    });
    SINGLE.forEach(function (dim) {
      html += '<div class="filter-group"><h3>' + LABELS[dim] + '</h3><select data-dimension="' + dim + '"><option value="">Any</option>' +
        Dishes.VOCAB[dim].map(function (v) { return '<option value="' + v + '">' + v + "</option>"; }).join("") + "</select></div>";
    });
    $("filter-groups").innerHTML = html;
  }

  /* Rebuilds the filters from scratch and clears them (also used after the dish list changes). */
  function refresh() {
    state.filters = {};
    state.search = "";
    $("search-box").value = "";
    buildFilters();
    render();
  }

  function init() {
    $("filter-groups").addEventListener("change", function (e) {
      const el = e.target, dim = el.getAttribute("data-dimension");
      if (!dim) return;
      if (el.type === "checkbox") {
        const cur = state.filters[dim] || [], val = el.getAttribute("data-value");
        state.filters[dim] = el.checked ? cur.concat([val]) : cur.filter(function (x) { return x !== val; });
      } else state.filters[dim] = el.value ? [el.value] : [];
      render();
    });
    $("filters-toggle").addEventListener("click", function () {
      const open = !document.querySelector(".filter-panel").classList.contains("open");
      document.querySelector(".filter-panel").classList.toggle("open", open);
      $("filters-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    });
    $("search-box").addEventListener("input", function (e) { state.search = e.target.value; render(); });
    $("clear-filters-btn").addEventListener("click", refresh);
    $("dish-grid").addEventListener("click", function (e) {
      const btn = e.target.closest('[data-action="eat"]');
      if (btn) App.eat(btn);
    });
    refresh();
  }

  return { init: init, refresh: refresh, render: render };
})();
