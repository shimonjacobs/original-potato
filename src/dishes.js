/* ===================================================================
 * EDITABLE DISH DATABASE
 * -------------------------------------------------------------------
 * Which list is live, highest priority first:
 *   1. edits saved in this browser (Store)
 *   2. a list baked into this file by "Save app copy"  (BAKED_DISHES)
 *   3. the starter list in data.js
 * DISHES (data.js) is edited in place, so the rest of the app always
 * sees the live list.
 * =================================================================== */
const BAKED_DISHES = null; /*BAKED_MARKER*/
const STARTER_DISHES = DISHES.slice();

function builtinDishes() {
  return Array.isArray(BAKED_DISHES) && BAKED_DISHES.length ? BAKED_DISHES : STARTER_DISHES;
}

/* Photos put in the images/ folder are embedded by build.js as BUILT_IMAGES = { dishId: dataUri }.
 * (When that isn't defined, e.g. in tests, there are simply none.) */
function builtImageFor(id) {
  return typeof BUILT_IMAGES !== "undefined" && id && BUILT_IMAGES[id] ? BUILT_IMAGES[id] : "";
}

const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
const MAX_IMAGE_CHARS = 200000; // about 150KB of picture

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dish";
}

function uniqueId(base, taken) {
  let id = base, n = 2;
  while (taken.indexOf(id) !== -1) { id = base + "-" + n; n += 1; }
  return id;
}

/* Checks one dish object (from the form or an imported file) and
 * returns { ok, errors, dish } with a cleaned copy. */
function validateDish(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["Not a dish object"], dish: null };
  const t = raw.tags || {};
  const name = String(raw.name || "").trim();
  if (!name) errors.push("Name is required");
  if (name.length > 60) errors.push("Name is too long (60 characters max)");
  const description = String(raw.description || "").trim();
  if (description.length > 200) errors.push("Description is too long (200 characters max)");

  const subset = function (value, vocab, label, required) {
    const arr = Array.isArray(value) ? value : [];
    const bad = arr.filter(function (v) { return vocab.indexOf(v) === -1; });
    if (bad.length) errors.push(label + ": unknown value " + bad.join(", "));
    if (required && !arr.length) errors.push("Pick at least one " + label);
    return arr.filter(function (v) { return vocab.indexOf(v) !== -1; });
  };
  const single = function (value, vocab, label) {
    if (vocab.indexOf(value) === -1) { errors.push("Pick a " + label); return vocab[0]; }
    return value;
  };

  const mealType = subset(t.mealType, TAG_VOCAB.mealType, "meal type", true);
  const occasion = subset(t.occasion, TAG_VOCAB.occasion, "occasion", false);
  const weight = single(t.weight, TAG_VOCAB.weight, "weight");
  const temperature = single(t.temperature, TAG_VOCAB.temperature, "temperature");
  const kosher = single(t.kosher, TAG_VOCAB.kosher, "milky / meaty / pareve choice");

  // Optional photo: only small base64 image data URIs are accepted.
  let image = "";
  if (typeof raw.image === "string" && raw.image) {
    if (raw.image === builtImageFor(String(raw.id || "").trim())) image = raw.image; // a photo built into the app
    else if (IMAGE_RE.test(raw.image) && raw.image.length <= MAX_IMAGE_CHARS) image = raw.image;
    else errors.push("Photo is not a valid image or is too large");
  }

  const prep = Number(raw.prepTimeMinutes);
  if (!isFinite(prep) || Math.round(prep) < 1 || Math.round(prep) > 600) errors.push("Prep time must be 1 to 600 minutes");

  if (errors.length) return { ok: false, errors: errors, dish: null };
  return {
    ok: true, errors: [],
    dish: {
      id: String(raw.id || "").trim() || "", name: name, description: description,
      tags: { mealType: mealType, kosher: kosher, weight: weight, temperature: temperature, occasion: occasion },
      prepTimeMinutes: Math.round(prep),
      image: image
    }
  };
}

function setLiveDishes(list) {
  DISHES.splice(0, DISHES.length);
  list.forEach(function (d) {
    // a dish with no photo of its own gets the one built into the app, if there is one
    if (!d.image) { const b = builtImageFor(d.id); if (b) d.image = b; }
    DISHES.push(d);
  });
}

/* Built-in photos are already inside the app file, so they are left out of saved lists
 * (browser storage and "Save app copy") instead of being stored twice. */
function withoutBuiltImages(list) {
  return list.map(function (d) { return d.image && d.image === builtImageFor(d.id) ? Object.assign({}, d, { image: "" }) : d; });
}

function persistDishes() {
  return Store.setDishes(withoutBuiltImages(DISHES));
}

/* Returns the cleaned list, or null if nothing usable. */
function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const out = [], taken = [];
  list.forEach(function (raw) {
    const v = validateDish(raw);
    if (!v.ok) return;
    v.dish.id = uniqueId(v.dish.id || slugify(v.dish.name), taken);
    taken.push(v.dish.id);
    out.push(v.dish);
  });
  return out.length ? out : null;
}

function loadDishes() {
  setLiveDishes(builtinDishes());
  const saved = cleanList(Store.getDishes());
  if (saved) setLiveDishes(saved);
}

/* ---- export / import ---- */
function exportDishesJson() {
  return JSON.stringify({ app: "what-should-i-eat", version: 1, dishes: DISHES }, null, 2);
}

/* Merge imported dishes into the live list (same id = replace). */
function importDishesJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, message: "That file isn't valid JSON." }; }
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.dishes;
  if (!Array.isArray(list)) return { ok: false, message: "No dish list found in that file." };
  let added = 0, replaced = 0, skipped = 0;
  const next = DISHES.slice();
  list.forEach(function (raw) {
    const v = validateDish(raw);
    if (!v.ok) { skipped += 1; return; }
    const id = v.dish.id || slugify(v.dish.name);
    const idx = next.findIndex(function (d) { return d.id === id; });
    v.dish.id = id;
    if (idx >= 0) { next[idx] = v.dish; replaced += 1; } else { v.dish.id = uniqueId(id, next.map(function (d) { return d.id; })); next.push(v.dish); added += 1; }
  });
  if (!added && !replaced) return { ok: false, message: "No valid dishes found" + (skipped ? " (" + skipped + " skipped)." : ".") };
  setLiveDishes(next);
  const saved = persistDishes();
  return { ok: true, message: (saved ? "" : "Imported but NOT saved in this browser (storage full or blocked): use Save app copy now. ") + "Imported: " + added + " new, " + replaced + " updated" + (skipped ? ", " + skipped + " skipped as invalid" : "") + "." };
}

/* ---- "Save app copy": the current page with the live dish list baked in ---- */
function bakeIntoSource(scriptText, dishes) {
  const json = JSON.stringify(dishes).replace(/</g, "\\u003c");
  return scriptText.replace(/const BAKED_DISHES = [\s\S]*?; \/\*BAKED_MARKER\*\//, function () {
    return "const BAKED_DISHES = " + json + "; /*BAKED_MARKER*/";
  });
}

function buildStandaloneHtml() {
  const clone = document.documentElement.cloneNode(true);
  ["chat-window", "filter-groups", "dish-grid", "dish-count", "test-result", "memory-note", "dish-table", "dish-form-wrap", "editor-message"].forEach(function (id) {
    const el = clone.querySelector("#" + id);
    if (el) el.innerHTML = "";
  });
  clone.querySelectorAll(".open").forEach(function (e) { e.classList.remove("open"); });
  clone.querySelectorAll("nav button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === "chat-page"); });
  clone.querySelectorAll(".page").forEach(function (p) { p.classList.toggle("active", p.id === "chat-page"); });
  const err = clone.querySelector("#chat-error");
  if (err) err.setAttribute("style", "display:none;");
  const script = clone.querySelector("script");
  script.textContent = bakeIntoSource(script.textContent, withoutBuiltImages(DISHES));
  return "<!doctype html>\n" + clone.outerHTML;
}

loadDishes();
