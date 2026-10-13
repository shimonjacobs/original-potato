# What Should I Eat?

A food picker for someone who finds it hard to choose what to eat. It only ever suggests dishes from their own list.

One self-contained file: open `dist/food-chooser.html` in any browser. No install, no server. Copy it to a memory stick and it runs anywhere.

## How it works

1. Nothing is suggested until the user presses **I'm hungry**. Then they can tap **I'll have this**, **Not this one**, or optionally type what they fancy.
2. **Rules** (`src/rules.js`) decide what is allowed. There is one hard rule: when **I'm meaty** is switched on (top right), milky dishes are never offered. What the user asks for ("cold", "light") narrows the choice while any matching dish is left. If all of them have been offered, the app says so and offers **Show me anything** or **Choose from the list**, rather than offering something they ruled out. If nothing on the list matches everything they asked for, it offers the closest dish and says so. Time of day and meals eaten recently only change the ranking (recent meals are a weak nudge, never an exclusion).
3. **Jev** (`typesafe/jev-1.13` via OpenRouter) reads typed words into preferences and picks one dish from the ranked shortlist. The user's words are also matched against the dish list: a whole dish name ("pizza", "fish and chips") or a single word that is in a dish's name or its ingredient tags ("eggs" finds every dish tagged egg). Those dishes are what gets offered, and the request is remembered, so **Not this one** keeps going through the matches and Jev is reminded what was originally asked. If the matching dish is blocked by the meaty rule, the reply says so and offers an **I'm not meaty now** button.
4. **Claude Haiku** only words the reply: one dish, short and neutral. If Haiku is down, a template does it. If the user asks for a food that isn't on the list (Jev flags that a dish was named, and no list dish matches the name), the reply says "That isn't on your list" before suggesting something.
5. After 3 "Not this one" the reply also offers **Choose from the list**.
6. If Jev can't be reached (no internet, school network blocking it), the first press of I'm hungry switches the app to just the dish list with photos, no chat. Settings has **Try suggestions again**.

The meaty switch is not remembered: reloading clears it, like the text box. Meals are only remembered when **I'll have this** is pressed, and only in that browser.

## Dishes

Settings, **My Dishes**: add, edit and delete dishes, including their milky / meaty / pareve label, a photo, and optional ingredient keywords (comma separated, such as `egg, potato`) so that asking for an ingredient finds the dish. Note that a browser which already has saved dish edits keeps its own copy of the list, so new starter tags (like `egg`) only appear there once added in the editor. Edit on one computer, then **Save app copy** to make a new file for the memory stick. The stick's file is the one that counts; browsers on different computers don't share edits or history.

Photos can also be built in: put `images/<dish-id>.jpg` in the folder (the id is the first text in the dish's line in `src/dishes.js`) and run `node build.js`.

## Settings

- **Show "What I'm using"**: chips showing what is shaping the suggestions (time of day, meaty, preferences, recent meals); each can be removed. On by default, and can be switched off here.
- **Forget recent meals.**
- **Developer settings**: Debug mode (adds a Debug tab with every step, each Jev and Haiku request, and Jev's confidence), a manual OpenRouter key (overrides the shared proxy), and dish Export / Import as JSON.

## Code

Each file in `src/` defines one object. `build.js` joins them, in this order, into one HTML file.

```
config.js    Config    settings and thresholds
store.js     Store     localStorage: meals eaten, edited dishes, flags
debug.js     Debug     records each turn (nothing reads it while deciding)
dishes.js    Dishes    starter list, validation, editing, "Save app copy"
rules.js     Rules     pure: meaty rule, time of day, ranking, named dishes
ai.js        Ai        every network call (proxy or developer key)
picker.js    Picker    the two Jev questions: read typed words, pick a dish
wording.js   Wording   pure: Haiku prompt and offline templates
turn.js      Turn      one chat turn; the only file that joins the above
chips.js     Chips     the optional "What I'm using" chips
dom.js, ui-*.js, app.js   the screens and startup
```

```
node build.js       builds dist/food-chooser.html
node test/test.js   logic tests against a fake Jev and Haiku
```

The proxy URL is in `src/config.js`. Keep a spend cap on the OpenRouter key behind it.
