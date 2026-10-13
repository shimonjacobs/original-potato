/* The My Dishes tab: add, edit and delete dishes (including the milky / meaty /
 * pareve label and photos), and "Save app copy" for the memory stick. */
const EditorUI = (function () {
  const $ = Dom.$;
  const ed = { editingId: null, pendingDelete: null, pendingReset: false, pendingImage: undefined };

  function message(text, bad) {
    $("editor-message").textContent = text || "";
    $("editor-message").className = "editor-message" + (bad ? " bad" : "");
  }

  function afterChange(msg) {
    const saved = Dishes.save();
    render();
    BrowseUI.refresh();
    if (saved) message(msg + ' Saved in this browser. Use "Save app copy" to put your dishes into a file for the memory stick.');
    else message(msg + ' NOT saved in this browser (storage is full or blocked, often because of photos). Use "Save app copy" now so you don\'t lose it.', true);
  }

  /* Photos are shrunk to a 480px JPEG so many fit in one file. */
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) { reject(new Error("That file is not an image.")); return; }
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Couldn't read that file.")); };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error("Couldn't open that image.")); };
        img.onload = function () {
          const scale = Math.min(1, 480 / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let q = 0.8, out = canvas.toDataURL("image/jpeg", q);
          while (out.length > 90000 && q > 0.3) { q -= 0.1; out = canvas.toDataURL("image/jpeg", q); }
          if (!Dishes.IMAGE_RE.test(out) || out.length > Dishes.MAX_IMAGE_CHARS) reject(new Error("That image is too large to use."));
          else resolve(out);
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function showPhoto(src) {
    $("photo-preview").innerHTML = src ? '<img class="photo-thumb" src="' + Dom.esc(src) + '" alt="">' : '<span class="muted">No photo</span>';
    $("photo-remove").style.display = src ? "inline-block" : "none";
  }

  function render() {
    const rows = Dishes.all().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (d) {
      const confirming = ed.pendingDelete === d.id;
      return '<tr><td class="thumb-cell">' + (d.image ? '<img class="photo-thumb small" src="' + Dom.esc(d.image) + '" alt="">' : "") + "</td>" +
        "<td><b>" + Dom.esc(d.name) + '</b><div class="muted">' + Dom.esc(d.description) + "</div></td>" +
        "<td>" + Dom.esc(d.tags.mealType.join(", ")) + "</td><td>" + d.tags.kosher + "</td><td>" + d.prepTimeMinutes + " min</td>" +
        '<td class="row-actions"><button type="button" class="secondary" data-edit="' + d.id + '">Edit</button> ' +
        '<button type="button" class="secondary' + (confirming ? " danger" : "") + '" data-delete="' + d.id + '">' + (confirming ? "Click again to delete" : "Delete") + "</button></td></tr>";
    });
    $("dish-table").innerHTML = '<table class="dish-table"><thead><tr><th></th><th>Dish</th><th>Meals</th><th>Milky / meaty / pareve</th><th>Prep</th><th></th></tr></thead><tbody>' + rows.join("") + "</tbody></table>";
    $("dish-total").textContent = Dishes.all().length + " dishes";
  }

  function inputs(type, name, vocab, selected) {
    return vocab.map(function (v) {
      const on = Array.isArray(selected) ? selected.indexOf(v) !== -1 : v === selected;
      return '<label class="filter-checkbox inline"><input type="' + type + '" name="' + name + '" value="' + v + '"' + (on ? " checked" : "") + "> " + v + "</label>";
    }).join("");
  }
  function select(name, vocab, selected) {
    return '<select name="' + name + '">' + vocab.map(function (v) { return '<option value="' + v + '"' + (v === selected ? " selected" : "") + ">" + v + "</option>"; }).join("") + "</select>";
  }

  function openForm(dish) {
    ed.editingId = dish ? dish.id : null;
    const d = dish || { name: "", description: "", prepTimeMinutes: 15, tags: { mealType: [], weight: "medium", temperature: "hot", kosher: "", occasion: [] } };
    const t = d.tags, V = Dishes.VOCAB;
    $("dish-form-wrap").innerHTML =
      '<form id="dish-form" class="dish-form"><h2>' + (dish ? "Edit dish" : "Add a dish") + "</h2>" +
      '<label>Name<input type="text" name="name" maxlength="60" value="' + Dom.esc(d.name) + '" /></label>' +
      '<label>Description<input type="text" name="description" maxlength="200" value="' + Dom.esc(d.description) + '" /></label>' +
      '<label>Ingredients (optional, separated by commas, so asking for "egg" finds this dish)<input type="text" name="ingredient" value="' + Dom.esc((t.ingredient || []).join(", ")) + '" /></label>' +
      '<div class="photo-field"><h3>Photo (optional)</h3><div class="photo-row"><div id="photo-preview"></div>' +
      '<div><input type="file" id="photo-input" accept="image/*" /> <button type="button" class="secondary" id="photo-remove">Remove photo</button>' +
      '<div id="photo-msg" class="form-errors"></div></div></div></div>' +
      '<div class="form-grid"><div><h3>Meal type</h3>' + inputs("checkbox", "mealType", V.mealType, t.mealType) + "</div>" +
      "<div><h3>Milky / meaty / pareve</h3>" + inputs("radio", "kosher", V.kosher, t.kosher) +
      '<p class="hint">Be sure. Milky dishes are never offered while meaty is switched on.</p></div>' +
      "<div><h3>Occasion</h3>" + inputs("checkbox", "occasion", V.occasion, t.occasion) + "</div></div>" +
      '<div class="form-grid"><label>Weight' + select("weight", V.weight, t.weight) + "</label><label>Served" + select("temperature", V.temperature, t.temperature) + "</label>" +
      '<label>Prep (minutes)<input type="number" name="prep" min="1" max="600" value="' + d.prepTimeMinutes + '" /></label></div>' +
      '<div id="form-errors" class="form-errors"></div>' +
      '<div class="row"><button type="submit" class="primary">' + (dish ? "Save changes" : "Add dish") + '</button><button type="button" class="secondary" id="form-cancel">Cancel</button></div></form>';
    ed.pendingImage = undefined;
    showPhoto(d.image || "");
    $("photo-input").addEventListener("change", function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      $("photo-msg").textContent = "";
      resizeImage(file).then(function (uri) { ed.pendingImage = uri; showPhoto(uri); }).catch(function (err) { $("photo-msg").textContent = err.message; });
    });
    $("photo-remove").addEventListener("click", function () { ed.pendingImage = ""; $("photo-input").value = ""; showPhoto(""); });
    $("dish-form").addEventListener("submit", submitForm);
    $("form-cancel").addEventListener("click", closeForm);
    $("dish-form").elements.name.focus();
  }

  function closeForm() { $("dish-form-wrap").innerHTML = ""; ed.editingId = null; }

  function formValues(form) {
    const all = function (name) { return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; }); };
    const existing = ed.editingId ? Dishes.byId(ed.editingId) : null;
    return {
      id: ed.editingId || "",
      image: ed.pendingImage !== undefined ? ed.pendingImage : (existing && existing.image) || "",
      name: form.elements.name.value, description: form.elements.description.value, prepTimeMinutes: form.elements.prep.value,
      tags: { mealType: all("mealType"), occasion: all("occasion"), ingredient: form.elements.ingredient.value.split(","), weight: form.elements.weight.value, temperature: form.elements.temperature.value, kosher: (form.querySelector('input[name="kosher"]:checked') || {}).value || "" }
    };
  }

  function submitForm(e) {
    e.preventDefault();
    const v = Dishes.validate(formValues(e.target));
    if (!v.ok) { $("form-errors").innerHTML = v.errors.map(function (m) { return "<div>" + Dom.esc(m) + "</div>"; }).join(""); return; }
    const wasEdit = !!ed.editingId;
    Dishes.upsert(v.dish);
    closeForm();
    afterChange((wasEdit ? "Updated " : "Added ") + v.dish.name + ".");
  }

  /* The current page with the live dish list baked in. */
  function standaloneHtml() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-dynamic]").forEach(function (el) { el.innerHTML = ""; });
    clone.querySelector("body").className = "";
    clone.querySelectorAll(".open").forEach(function (el) { el.classList.remove("open"); });
    clone.querySelectorAll("[aria-pressed]").forEach(function (el) { el.setAttribute("aria-pressed", "false"); });
    clone.querySelectorAll("nav button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === "chat-page"); });
    clone.querySelectorAll(".page").forEach(function (p) { p.classList.toggle("active", p.id === "chat-page"); });
    const script = clone.querySelector("script");
    script.textContent = Dishes.bake(script.textContent);
    return "<!doctype html>\n" + clone.outerHTML;
  }

  function init() {
    render();
    $("add-dish-btn").addEventListener("click", function () { openForm(null); });
    $("dish-table").addEventListener("click", function (e) {
      const edit = e.target.closest("[data-edit]"), del = e.target.closest("[data-delete]");
      if (edit) { openForm(Dishes.byId(edit.getAttribute("data-edit"))); return; }
      if (!del) return;
      const id = del.getAttribute("data-delete");
      if (ed.pendingDelete !== id) { ed.pendingDelete = id; render(); return; }
      ed.pendingDelete = null;
      if (Dishes.all().length <= 1) { message("Keep at least one dish.", true); render(); return; }
      const name = Dishes.nameOf(id);
      Dishes.remove(id);
      afterChange("Deleted " + name + ".");
    });
    $("save-copy-btn").addEventListener("click", function () {
      Dom.download("food-chooser-my-dishes.html", standaloneHtml(), "text/html");
      message("Saved food-chooser-my-dishes.html with your " + Dishes.all().length + " dishes built in. Copy that file to your memory stick.");
    });
    $("reset-dishes-btn").addEventListener("click", function () {
      const btn = $("reset-dishes-btn");
      if (!ed.pendingReset) { ed.pendingReset = true; btn.textContent = "Click again to reset"; btn.classList.add("danger"); return; }
      ed.pendingReset = false;
      btn.textContent = "Reset to original list"; btn.classList.remove("danger");
      Dishes.reset();
      closeForm();
      render();
      BrowseUI.refresh();
      message("Back to the original list of " + Dishes.all().length + " dishes.");
    });
  }

  return { init: init, render: render, message: message };
})();
