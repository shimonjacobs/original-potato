/* The dish list: starter dishes, tag vocabulary, validation, editing, and the
 * "Save app copy" bake-in. The live list comes from, highest priority first:
 *   1. edits saved in this browser (Store)
 *   2. a list baked into this file by "Save app copy"
 *   3. the starter list below
 * Each dish has exactly one of milky / meaty / pareve in tags.kosher. */
const Dishes = (function () {
  const VOCAB = {
    mealType: ["breakfast", "brunch", "lunch", "dinner", "snack", "dessert"],
    kosher: ["milky", "meaty", "pareve"],
    weight: ["light", "medium", "heavy"],
    temperature: ["hot", "cold"],
    occasion: ["healthy", "quick", "comfort", "fancy"]
  };

  // D(id, name, description, tags, prepMinutes). The id also names its photo: images/<id>.jpg
  function D(id, name, description, tags, prepTimeMinutes) {
    return { id: id, name: name, description: description, tags: tags, prepTimeMinutes: prepTimeMinutes };
  }

  const STARTER = [
    D("cereal", "Cereal", "A bowl of cereal with cold milk.",
      { mealType: ["breakfast", "snack"], kosher: "milky", weight: "light", temperature: "cold", occasion: ["quick"] }, 2),
    D("mahash-hash", "Mahash-Hash", "Fried potato and egg omelette, cooked together until crisp and golden.",
      { mealType: ["breakfast", "brunch"], kosher: "pareve", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 20),
    D("scrambled-eggs", "Scrambled Eggs", "Soft, creamy scrambled eggs.",
      { mealType: ["breakfast", "brunch"], kosher: "pareve", weight: "light", temperature: "hot", occasion: ["quick", "healthy"] }, 8),
    D("sunny-side-up", "Sunny Side Up Eggs", "Fried eggs with a runny yolk, cooked on one side.",
      { mealType: ["breakfast", "brunch"], kosher: "pareve", weight: "light", temperature: "hot", occasion: ["quick"] }, 6),
    D("toast", "Toast with Margarine", "Toasted bread with margarine.",
      { mealType: ["breakfast", "snack"], kosher: "pareve", weight: "light", temperature: "hot", occasion: ["quick"] }, 3),
    D("chicken-and-rice", "Chicken and Rice", "Simple cooked chicken served over rice.",
      { mealType: ["lunch", "dinner"], kosher: "meaty", weight: "medium", temperature: "hot", occasion: ["healthy", "comfort"] }, 30),
    D("crispy-roast-potatoes", "Crispy Roast Potatoes", "Roast potatoes, crisp on the outside and fluffy inside.",
      { mealType: ["lunch", "dinner"], kosher: "pareve", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 45),
    D("jacket-potato", "Jacket Potato", "Baked potato with a crisp skin and fluffy centre.",
      { mealType: ["lunch", "dinner"], kosher: "pareve", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 60),
    D("chips", "Chips", "Classic fried potato chips.",
      { mealType: ["lunch", "dinner", "snack"], kosher: "pareve", weight: "medium", temperature: "hot", occasion: ["comfort", "quick"] }, 20),
    D("jacket-potato-with-cheese", "Jacket Potato with Cheese", "Baked potato with a crisp skin and fluffy centre, topped with cheese.",
      { mealType: ["lunch", "dinner"], kosher: "milky", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 60),
    D("mashed-potatoes", "Mashed Potatoes", "Creamy mashed potatoes with butter.",
      { mealType: ["dinner"], kosher: "milky", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 25),
    D("steak", "Steak", "Pan-seared or grilled steak.",
      { mealType: ["dinner"], kosher: "meaty", weight: "heavy", temperature: "hot", occasion: ["fancy", "comfort"] }, 15),
    D("steak-burgers", "Steak Burgers", "Beef burgers in a bun, cooked to order.",
      { mealType: ["lunch", "dinner"], kosher: "meaty", weight: "heavy", temperature: "hot", occasion: ["comfort"] }, 20),
    D("pot-noodle", "Pot Noodle", "Instant noodles in a pot, just add hot water.",
      { mealType: ["lunch", "dinner", "snack"], kosher: "pareve", weight: "light", temperature: "hot", occasion: ["quick"] }, 5),
    D("pancakes", "Pancakes", "Fluffy pancakes with maple syrup.",
      { mealType: ["breakfast", "brunch", "dessert"], kosher: "milky", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 20),
    D("cheese-toastie", "Cheese Toastie", "A crisp toasted sandwich oozing melted cheese.",
      { mealType: ["lunch", "snack"], kosher: "milky", weight: "medium", temperature: "hot", occasion: ["quick", "comfort"] }, 10),
    D("fish-and-chips", "Fish and Chips", "Battered fish with thick chips.",
      { mealType: ["dinner"], kosher: "pareve", weight: "heavy", temperature: "hot", occasion: ["comfort"] }, 40),
    D("pizza", "Pizza", "Tomato, mozzarella and basil on a crisp base.",
      { mealType: ["lunch", "dinner"], kosher: "milky", weight: "heavy", temperature: "hot", occasion: ["comfort"] }, 20),
    D("schnizel", "Schnizel", "Chicken Breast, breaded and fried.",
      { mealType: ["dinner"], kosher: "meaty", weight: "heavy", temperature: "hot", occasion: ["fancy", "comfort"] }, 20)
  ];

  const BAKED_DISHES = null; /*BAKED_MARKER*/

  const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
  const MAX_IMAGE_CHARS = 200000; // about 150KB of picture

  let list = [];

  /* Photos in images/ are embedded by build.js as BUILT_IMAGES = { dishId: dataUri }. */
  function builtImage(id) {
    return typeof BUILT_IMAGES !== "undefined" && id && BUILT_IMAGES[id] ? BUILT_IMAGES[id] : "";
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dish";
  }

  function uniqueId(base, taken) {
    let id = base, n = 2;
    while (taken.indexOf(id) !== -1) { id = base + "-" + n; n += 1; }
    return id;
  }

  /* Checks one dish (from the form or an imported file): { ok, errors, dish } with a cleaned copy. */
  function validate(raw) {
    if (!raw || typeof raw !== "object") return { ok: false, errors: ["Not a dish object"], dish: null };
    const errors = [];
    const t = raw.tags || {};
    const name = String(raw.name || "").trim();
    const description = String(raw.description || "").trim();
    if (!name) errors.push("Name is required");
    if (name.length > 60) errors.push("Name is too long (60 characters max)");
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
    const tags = {
      mealType: subset(t.mealType, VOCAB.mealType, "meal type", true),
      kosher: single(t.kosher, VOCAB.kosher, "milky / meaty / pareve choice"),
      weight: single(t.weight, VOCAB.weight, "weight"),
      temperature: single(t.temperature, VOCAB.temperature, "temperature"),
      occasion: subset(t.occasion, VOCAB.occasion, "occasion", false)
    };

    let image = "";
    if (typeof raw.image === "string" && raw.image) {
      if (raw.image === builtImage(String(raw.id || "").trim())) image = raw.image;
      else if (IMAGE_RE.test(raw.image) && raw.image.length <= MAX_IMAGE_CHARS) image = raw.image;
      else errors.push("Photo is not a valid image or is too large");
    }

    const prep = Number(raw.prepTimeMinutes);
    if (!isFinite(prep) || Math.round(prep) < 1 || Math.round(prep) > 600) errors.push("Prep time must be 1 to 600 minutes");

    if (errors.length) return { ok: false, errors: errors, dish: null };
    return { ok: true, errors: [], dish: { id: String(raw.id || "").trim(), name: name, description: description, tags: tags, prepTimeMinutes: Math.round(prep), image: image } };
  }

  /* Returns the cleaned list, or null if nothing usable. */
  function cleanList(raw) {
    if (!Array.isArray(raw)) return null;
    const out = [], taken = [];
    raw.forEach(function (r) {
      const v = validate(r);
      if (!v.ok) return;
      v.dish.id = uniqueId(v.dish.id || slugify(v.dish.name), taken);
      taken.push(v.dish.id);
      out.push(v.dish);
    });
    return out.length ? out : null;
  }

  function setList(dishes) {
    list = dishes;
    list.forEach(function (d) { if (!d.image) d.image = builtImage(d.id); }); // a dish with no photo of its own gets the built-in one
  }

  function builtinList() {
    return clone(Array.isArray(BAKED_DISHES) && BAKED_DISHES.length ? BAKED_DISHES : STARTER);
  }

  /* Built-in photos are already inside the app file, so saved lists leave them out. */
  function withoutBuiltImages() {
    return list.map(function (d) { return d.image && d.image === builtImage(d.id) ? Object.assign({}, d, { image: "" }) : d; });
  }

  function byId(id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  return {
    VOCAB: VOCAB,
    validate: validate,
    all: function () { return list; },
    byId: byId,
    nameOf: function (id) { const d = byId(id); return d ? d.name : id; },

    load: function () { setList(cleanList(Store.dishes()) || builtinList()); },
    /* Returns false if the browser refused to save (storage full or blocked). */
    save: function () { return Store.setDishes(withoutBuiltImages()); },
    reset: function () { Store.setDishes(null); setList(builtinList()); },

    /* Adds a validated dish, or replaces the one with the same id. */
    upsert: function (dish) {
      const i = list.findIndex(function (d) { return d.id === dish.id; });
      if (i >= 0) { list[i] = dish; return dish; }
      dish.id = uniqueId(slugify(dish.name), list.map(function (d) { return d.id; }));
      list.push(dish);
      return dish;
    },
    remove: function (id) { list = list.filter(function (d) { return d.id !== id; }); },

    /* ---- developer export / import of just the dish list ---- */
    exportJson: function () { return JSON.stringify({ app: "what-should-i-eat", version: 1, dishes: list }, null, 2); },
    importJson: function (text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, message: "That file isn't valid JSON." }; }
      const incoming = Array.isArray(parsed) ? parsed : parsed && parsed.dishes;
      if (!Array.isArray(incoming)) return { ok: false, message: "No dish list found in that file." };
      let added = 0, replaced = 0, skipped = 0;
      incoming.forEach(function (raw) {
        const v = validate(raw);
        if (!v.ok) { skipped += 1; return; }
        v.dish.id = v.dish.id || slugify(v.dish.name);
        if (byId(v.dish.id)) replaced += 1; else added += 1;
        const i = list.findIndex(function (d) { return d.id === v.dish.id; });
        if (i >= 0) list[i] = v.dish; else list.push(v.dish);
      });
      if (!added && !replaced) return { ok: false, message: "No valid dishes found" + (skipped ? " (" + skipped + " skipped)." : ".") };
      const saved = Store.setDishes(withoutBuiltImages());
      return { ok: true, message: (saved ? "" : "Imported but NOT saved in this browser (storage full or blocked). ") + "Imported: " + added + " new, " + replaced + " updated" + (skipped ? ", " + skipped + " skipped as invalid" : "") + "." };
    },

    /* "Save app copy": the page script with the live dish list written into it. */
    bake: function (scriptText) {
      const json = JSON.stringify(withoutBuiltImages()).replace(/</g, "\\u003c");
      return scriptText.replace(/const BAKED_DISHES = [\s\S]*?; \/\*BAKED_MARKER\*\//, function () {
        return "const BAKED_DISHES = " + json + "; /*BAKED_MARKER*/";
      });
    },

    IMAGE_RE: IMAGE_RE,
    MAX_IMAGE_CHARS: MAX_IMAGE_CHARS
  };
})();
