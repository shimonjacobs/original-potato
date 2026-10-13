/* ===================================================================
 * DISH DATA
 * -------------------------------------------------------------------
 * Add/remove dishes here. D(id, name, description, tags, prepMinutes).
 * IMPORTANT: "kosher" is milky, meaty or pareve and is treated as a hard
 * rule by the app (a "meaty" request never shows a milky dish, and a
 * "milky" request never shows a meaty one). Only classify a dish if you
 * are sure. New tag VALUES must also be added to TAG_VOCAB below.
 * =================================================================== */
function D(id, name, description, tags, prepTimeMinutes) {
  return { id: id, name: name, description: description, tags: tags, prepTimeMinutes: prepTimeMinutes };
}

const DISHES = [
  /* ---- original dishes ---- */
  D("cereal", "Cereal", "A bowl of cereal with cold milk.",
    { mealType: ["breakfast", "snack"], kosher: "milky", weight: "light", temperature: "cold", occasion: ["quick"] }, 2),
  D("mahash-hash", "Mahash-Hash", "Fried potato and egg omelette, cooked together until crisp and golden.",
    { mealType: ["breakfast", "brunch"], kosher: "pareve", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 20),
  D("scrambled-eggs", "Scrambled Eggs", "Soft, creamy scrambled eggs.",
    { mealType: ["breakfast", "brunch"], kosher: "pareve", weight: "light", temperature: "hot", occasion: ["quick", "healthy"] }, 8),
  D("sunny-side-up", "Sunny Side Up Eggs", "Fried eggs with a runny yolk, cooked on one side.",
    { mealType: ["breakfast", "brunch"], kosher: "pareve", weight: "light", temperature: "hot", occasion: ["quick"] }, 6),
  D("toast", "Toast", "Toasted bread with butter.",
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

  /* ---- added in v2 ---- */
  D("pancakes", "Pancakes", "Fluffy pancakes with maple syrup.",
    { mealType: ["breakfast", "brunch", "dessert"], kosher: "milky", weight: "medium", temperature: "hot", occasion: ["comfort"] }, 20),
  D("cheese-toastie", "Cheese Toastie", "A crisp toasted sandwich oozing melted cheese.",
    { mealType: ["lunch", "snack"], kosher: "milky", weight: "medium", temperature: "hot", occasion: ["quick", "comfort"] }, 10),
  D("fish-and-chips", "Fish and Chips", "Battered fish with thick chips.",
    { mealType: ["dinner"], kosher: "pareve", weight: "heavy", temperature: "hot", occasion: ["comfort"] }, 40),
  D("pizza", "Pizza", "Tomato, mozzarella and basil on a crisp base.",
    { mealType: ["lunch", "dinner"], kosher: "milky", weight: "heavy", temperature: "hot", occasion: ["comfort"] }, 20),
  D("schnizel", "Schnizel", "Chicken Breast, breaded and fried.",
    { mealType: ["dinner"], kosher: "meaty", weight: "heavy", temperature: "hot", occasion: ["fancy", "comfort"] }, 20),
 ];

const TAG_VOCAB = {
  mealType: ["breakfast", "brunch", "lunch", "dinner", "snack", "dessert"],
  kosher: ["milky", "meaty", "pareve"],
  weight: ["light", "medium", "heavy"],
  temperature: ["hot", "cold"],
  occasion: ["healthy", "quick", "comfort", "fancy"]
};

function dishById(id) {
  for (let i = 0; i < DISHES.length; i++) if (DISHES[i].id === id) return DISHES[i];
  return null;
}

/* ===================================================================
 * KEYWORD -> TAG MAP
 * -------------------------------------------------------------------
 * Fast, offline reading of free text ("something meaty and quick").
 * This is the safety net for milky/meaty/pareve requests and the whole brain when
 * there is no API key. When Jev is on, it reads the text as well and
 * the two are combined.
 * =================================================================== */
const KEYWORD_TO_TAG = {};

function registerKeyword(keyword, dimension, value) {
  KEYWORD_TO_TAG[keyword] = { dimension: dimension, value: value };
}

(function buildBaseKeywords() {
  for (const dimension in TAG_VOCAB) {
    TAG_VOCAB[dimension].forEach(function (value) { registerKeyword(value, dimension, value); });
  }
})();

const SYNONYMS = {
  breakfast: ["morning"],
  lunch: ["midday"],
  dinner: ["supper", "evening meal"],
  snack: ["snacky", "something small", "peckish"],
  dessert: ["sweet", "pudding", "something sweet"],
  milky: ["dairy", "milk", "milchig", "milchik", "chalavi"],
  meaty: ["meat", "fleishig", "fleishik", "fleishyk", "basari"],
  pareve: ["parve", "parev", "neutral"],
  light: ["something light", "not too heavy", "small"],
  heavy: ["filling", "big", "hearty", "substantial"],
  cold: ["chilled", "cool"],
  quick: ["fast", "in a hurry", "no time", "quickly"],
  healthy: ["health conscious", "diet", "light and healthy"],
  comfort: ["comforting", "comfort food", "cosy", "cozy"],
  fancy: ["special occasion", "date night", "celebration"]
};

(function buildSynonyms() {
  for (const value in SYNONYMS) {
    let dimension = null;
    for (const key in KEYWORD_TO_TAG) {
      if (KEYWORD_TO_TAG[key].value === value) { dimension = KEYWORD_TO_TAG[key].dimension; break; }
    }
    if (!dimension) continue;
    SYNONYMS[value].forEach(function (s) { registerKeyword(s.toLowerCase(), dimension, value); });
  }
})();

// "hot" bare word means temperature.
registerKeyword("hot", "temperature", "hot");
