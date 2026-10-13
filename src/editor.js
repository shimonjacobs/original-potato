/* ===================================================================
 * DISH EDITOR (the "My Dishes" tab)
 * =================================================================== */
const editor = { editingId: null, pendingDelete: null, pendingReset: false, pendingImage: undefined };

function editorMessage(text, bad) {
  const el = $("editor-message");
  el.textContent = text || "";
  el.className = "editor-message" + (bad ? " bad" : "");
}

function afterDishChange(msg) {
  const saved = persistDishes();
  renderDishTable();
  refreshBrowse();
  if (saved) editorMessage(msg + " Saved in this browser. Use \"Save app copy\" to put your dishes into a file for a memory stick.");
  else editorMessage(msg + " NOT saved in this browser (storage is full or blocked, often because of photos). Use \"Save app copy\" or \"Export dishes\" now so you don't lose it.", true);
}

/* ---- photos: shrink to <= 480px JPEG so many fit in one file ---- */
function resizeImage(file) {
  return new Promise(function (resolve, reject) {
    if (!/^image\//.test(file.type)) { reject(new Error("That file is not an image.")); return; }
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error("Couldn't read that file.")); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error("Couldn't open that image.")); };
      img.onload = function () {
        const max = 480;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // flatten transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let q = 0.8, out = canvas.toDataURL("image/jpeg", q);
        while (out.length > 90000 && q > 0.3) { q -= 0.1; out = canvas.toDataURL("image/jpeg", q); }
        if (!IMAGE_RE.test(out) || out.length > MAX_IMAGE_CHARS) { reject(new Error("That image is too large to use.")); return; }
        resolve(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function showPhotoPreview(src) {
  $("photo-preview").innerHTML = src ? '<img class="photo-thumb" src="' + escapeHtml(src) + '" alt="">' : '<span class="muted">No photo</span>';
  $("photo-remove").style.display = src ? "inline-block" : "none";
}

function renderDishTable() {
  const rows = DISHES.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (d) {
    const t = d.tags;
    const confirming = editor.pendingDelete === d.id;
    return '<tr><td class="thumb-cell">' + (d.image ? '<img class="photo-thumb small" src="' + escapeHtml(d.image) + '" alt="">' : "") + "</td><td><b>" + escapeHtml(d.name) + "</b><div class=\"muted\">" + escapeHtml(d.description) + "</div></td>" +
      "<td>" + escapeHtml(t.mealType.join(", ")) + "</td>" +
      "<td>" + escapeHtml(t.kosher) + "</td>" +
      "<td>" + d.prepTimeMinutes + " min</td>" +
      '<td class="row-actions"><button type="button" class="secondary" data-edit="' + d.id + '">Edit</button> ' +
      '<button type="button" class="secondary' + (confirming ? " danger" : "") + '" data-delete="' + d.id + '">' + (confirming ? "Click again to delete" : "Delete") + "</button></td></tr>";
  });
  $("dish-table").innerHTML = '<table class="dish-table"><thead><tr><th></th><th>Dish</th><th>Meals</th><th>Milky / meaty / pareve</th><th>Prep</th><th></th></tr></thead><tbody>' + rows.join("") + "</tbody></table>";
  $("dish-total").textContent = DISHES.length + " dishes";
}

function checkboxes(name, vocab, selected) {
  return vocab.map(function (v) {
    return '<label class="filter-checkbox inline"><input type="checkbox" name="' + name + '" value="' + v + '"' + (selected.indexOf(v) !== -1 ? " checked" : "") + "> " + v + "</label>";
  }).join("");
}
function radios(name, vocab, selected) {
  return vocab.map(function (v) {
    return '<label class="filter-checkbox inline"><input type="radio" name="' + name + '" value="' + v + '"' + (v === selected ? " checked" : "") + "> " + v + "</label>";
  }).join("");
}
function selectHtml(name, vocab, selected) {
  return '<select name="' + name + '">' + vocab.map(function (v) { return '<option value="' + v + '"' + (v === selected ? " selected" : "") + ">" + v + "</option>"; }).join("") + "</select>";
}

function openForm(dish) {
  editor.editingId = dish ? dish.id : null;
  const d = dish || { name: "", description: "", prepTimeMinutes: 15, tags: { mealType: [], weight: "medium", temperature: "hot", kosher: "", occasion: [] } };
  const t = d.tags;
  $("dish-form-wrap").innerHTML =
    '<form id="dish-form" class="dish-form"><h2>' + (dish ? "Edit dish" : "Add a dish") + "</h2>" +
    '<label>Name<input type="text" name="name" maxlength="60" value="' + escapeHtml(d.name) + '" /></label>' +
    '<label>Description<input type="text" name="description" maxlength="200" value="' + escapeHtml(d.description) + '" /></label>' +
    '<div class="photo-field"><h3>Photo (optional)</h3><div class="photo-row"><div id="photo-preview"></div>' +
    '<div><input type="file" id="photo-input" accept="image/*" /> <button type="button" class="secondary" id="photo-remove">Remove photo</button>' +
    '<div id="photo-msg" class="form-errors"></div></div></div></div>' +
    '<div class="form-grid">' +
    "<div><h3>Meal type</h3>" + checkboxes("mealType", TAG_VOCAB.mealType, t.mealType) + "</div>" +
    "<div><h3>Milky / meaty / pareve</h3>" + radios("kosher", TAG_VOCAB.kosher, t.kosher) +
    '<p class="hint">Be sure. A "meaty" request never shows a milky dish and vice versa. Pareve goes with either.</p></div>' +
    "<div><h3>Occasion</h3>" + checkboxes("occasion", TAG_VOCAB.occasion, t.occasion) + "</div>" +
    "</div>" +
    '<div class="form-grid">' +
    "<label>Weight" + selectHtml("weight", TAG_VOCAB.weight, t.weight) + "</label>" +
    "<label>Served" + selectHtml("temperature", TAG_VOCAB.temperature, t.temperature) + "</label>" +
    '<label>Prep (minutes)<input type="number" name="prep" min="1" max="600" value="' + d.prepTimeMinutes + '" /></label>' +
    "</div>" +
    '<div id="form-errors" class="form-errors"></div>' +
    '<div class="row"><button type="submit" class="primary">' + (dish ? "Save changes" : "Add dish") + '</button><button type="button" class="secondary" id="form-cancel">Cancel</button></div></form>';
  editor.pendingImage = undefined;
  showPhotoPreview(d.image || "");
  $("photo-input").addEventListener("change", function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    $("photo-msg").textContent = "";
    resizeImage(file).then(function (uri) {
      editor.pendingImage = uri;
      showPhotoPreview(uri);
    }).catch(function (err) { $("photo-msg").textContent = err.message; });
  });
  $("photo-remove").addEventListener("click", function () {
    editor.pendingImage = "";
    $("photo-input").value = "";
    showPhotoPreview("");
  });
  $("dish-form").addEventListener("submit", submitForm);
  $("form-cancel").addEventListener("click", closeForm);
  $("dish-form").elements.name.focus();
  $("dish-form-wrap").scrollIntoView && $("dish-form-wrap").scrollIntoView({ block: "nearest" });
}

function closeForm() {
  $("dish-form-wrap").innerHTML = "";
  editor.editingId = null;
}

function formValues(form) {
  const all = function (name) { return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; }); };
  return {
    id: editor.editingId || "",
    image: editor.pendingImage !== undefined ? editor.pendingImage : ((editor.editingId && (dishById(editor.editingId) || {}).image) || ""),
    name: form.elements.name.value, description: form.elements.description.value, prepTimeMinutes: form.elements.prep.value,
    tags: {
      mealType: all("mealType"), occasion: all("occasion"),
      weight: form.elements.weight.value, temperature: form.elements.temperature.value,
      kosher: (form.querySelector('input[name="kosher"]:checked') || {}).value || ""
    }
  };
}

function submitForm(e) {
  e.preventDefault();
  const v = validateDish(formValues(e.target));
  if (!v.ok) {
    $("form-errors").innerHTML = v.errors.map(function (m) { return "<div>" + escapeHtml(m) + "</div>"; }).join("");
    return;
  }
  const dish = v.dish;
  const idx = editor.editingId ? DISHES.findIndex(function (d) { return d.id === editor.editingId; }) : -1;
  if (idx >= 0) {
    dish.id = editor.editingId;
    DISHES[idx] = dish;
  } else {
    dish.id = uniqueId(slugify(dish.name), DISHES.map(function (d) { return d.id; }));
    DISHES.push(dish);
  }
  closeForm();
  afterDishChange(idx >= 0 ? "Updated " + dish.name + "." : "Added " + dish.name + ".");
}

function initEditor() {
  renderDishTable();
  $("add-dish-btn").addEventListener("click", function () { openForm(null); });

  $("dish-table").addEventListener("click", function (e) {
    const edit = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-delete]");
    if (edit) { openForm(dishById(edit.getAttribute("data-edit"))); return; }
    if (del) {
      const id = del.getAttribute("data-delete");
      if (editor.pendingDelete !== id) { editor.pendingDelete = id; renderDishTable(); return; }
      editor.pendingDelete = null;
      if (DISHES.length <= 1) { editorMessage("Keep at least one dish.", true); renderDishTable(); return; }
      const name = dishById(id).name;
      DISHES.splice(DISHES.findIndex(function (d) { return d.id === id; }), 1);
      afterDishChange("Deleted " + name + ".");
    }
  });

  $("export-btn").addEventListener("click", function () {
    downloadText("my-dishes.json", exportDishesJson(), "application/json");
    editorMessage("Exported " + DISHES.length + " dishes to my-dishes.json.");
  });

  $("import-btn").addEventListener("click", function () { $("import-file").click(); });
  $("import-file").addEventListener("change", function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const r = importDishesJson(String(reader.result));
      if (r.ok) { renderDishTable(); refreshBrowse(); }
      editorMessage(r.message, !r.ok);
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  $("save-copy-btn").addEventListener("click", function () {
    downloadText("food-chooser-my-dishes.html", buildStandaloneHtml(), "text/html");
    editorMessage("Saved food-chooser-my-dishes.html with your " + DISHES.length + " dishes built in. Copy that file to your memory stick.");
  });

  $("reset-dishes-btn").addEventListener("click", function () {
    const btn = $("reset-dishes-btn");
    if (!editor.pendingReset) { editor.pendingReset = true; btn.textContent = "Click again to reset"; btn.classList.add("danger"); return; }
    editor.pendingReset = false;
    btn.textContent = "Reset to original list"; btn.classList.remove("danger");
    Store.setDishes(null);
    setLiveDishes(builtinDishes());
    closeForm();
    renderDishTable();
    refreshBrowse();
    editorMessage("Back to the original list of " + DISHES.length + " dishes.");
  });
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

document.addEventListener("DOMContentLoaded", initEditor);
