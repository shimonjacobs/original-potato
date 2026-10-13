# What Should I Eat? v2 (Jev + Claude Haiku)

One self-contained file: open `dist/food-chooser.html` in any browser. No install, no server.
Copy it to a memory stick and it runs anywhere.

## How it thinks

1. **Rules decide what is allowed**: milky/meaty/pareve (never relaxed) and no repeats. **Time of day is only a
   boost**: dishes that suit the current meal come first, and others (even cereal at dinnertime) appear once those
   are used up or when what you asked for points to them. Asking for a meal type outright ("dessert") does filter.
   (dishes you ate recently are skipped, and dishes you turn down are skipped for that chat only).
2. **Jev decides** (`typesafe/jev-1.13` via OpenRouter): reads each message into preferences,
   detects a vague message or a rejection, then picks the best dish with a confidence score.
3. **Claude Haiku words it**: turns the decision into a friendly reply or one clarifying question.
   It is told exactly which dish to mention.
4. **Falls back gracefully**: Jev down -> offline rules decide; Haiku down -> templates word it.
   With no key at all the app still works.

**What I'm using (right-hand panel):** every input to the decision shows as a chip you can remove with the x.
Chips are read from the real state, so a chip on screen is genuinely in use and removing it genuinely stops it.
Groups: *Right now* (time of day; removing it switches time-of-day off, click the arrow to restore), *This chat*
(what you asked for, dishes already offered, and dishes you turned down, which are forgotten when you press Start over) and *Remembered* (meals you ate recently, kept
across chats). Style shows the source: solid = you said it, dashed = Jev read it from your message, bold with an
orange ring = hard rule (milky/meaty/pareve). After removing a chip, press **Update suggestion** to re-run.

The chat card shows Jev's confidence and runner-ups. "I'll have this" and "Not this one" are
remembered in the browser, so later suggestions improve.

## Using your key

- **Easiest:** open the app, click Settings, paste your OpenRouter key, Save, then **Test connection**.
  The key stays in that browser only.
- **Built in:** put it in `OPENROUTER_API_KEY` in `src/config.js` and run `node build.js`.
  Anyone with the file can read it, so only do that for people you trust, with a dedicated,
  spend-limited key.

**Browser (CORS) caveat:** OpenRouter's docs say to keep the key server-side, and the
`/api/alpha/decisions` endpoint may refuse calls from a web page. If Test connection says the
browser blocked the request, Jev can't be used from a plain file; the app then runs on the offline
rules (Haiku replies may still work, as chat completions normally allow browser calls).

## Editing your dishes (My Dishes tab)

Add, edit and delete dishes with tick-boxes. Changes apply
straight away to the chat and Browse tab and are saved in that browser.

- **Photos:** in the Add/Edit form, choose a photo. It is shrunk to 480px (about 30-60KB) and stored with the dish,
  then shows on chat suggestions, Browse and the list. Photos are never sent to Jev or Haiku. If the browser says
  storage is full, use Save app copy or Export dishes straight away.
- **Save app copy** downloads `food-chooser-my-dishes.html` with your dish list built in. Put that file
  on the memory stick and everything travels with it, no import needed. (A key pasted into Settings is
  NOT included; a key built into `src/config.js` is.)
- **Export / Import** move just the dish list as `my-dishes.json`. Import merges: same dish = updated.
- **Reset to original list** goes back to the list built into the file you're running.
- Every dish is exactly one of **milky, meaty or pareve**, and this is a hard rule: a "meaty" request never shows a
  milky dish, a "milky" request never shows a meaty one, and "pareve" shows pareve dishes only. Pareve dishes
  also appear for milky and meaty requests (ranked below exact matches). Only classify a dish if you are sure.

## Editing the code

```
src/config.js      keys, models, thresholds
src/data.js        starter dishes + tag vocabulary (meal type, milky/meaty/pareve, weight, temperature, occasion)
src/dishes.js      editable dish list: validation (incl. photos), import/export, "save app copy"
src/editor.js      the My Dishes tab
src/engine.js      time of day, filtering, ranking
src/jev.js         OpenRouter + Jev questions
src/chat.js        Haiku prompt + fallback templates
src/controller.js  one chat turn, start to finish
src/store.js       browser memory (history, saved key)
src/memory.js      the chips panel: reads real state, removing a chip changes it
src/ui.js, styles.css, index.template.html
node build.js      -> dist/food-chooser.html
node test/test.js  logic tests against a mocked OpenRouter
```

## Debug mode

Settings, tick "Debug mode". A Debug tab appears. Each chat turn is listed with every step the app took: what it read from your words, which dishes the rules allowed, the ranking scores, the raw request and response for each Jev and Haiku call, and which wording was used. Chat replies get a small "Debug trace" link that jumps to that turn. Copy all or Download JSON to share a trace. API keys and photos are never recorded. The last 25 turns are kept in memory only (cleared on reload).

If you see "Empty reply from chat model", open the trace and look at the Haiku call: `finish_reason` and `usage` show whether the model ran out of tokens.

## Photos built into the app

Put one picture per dish in the `images/` folder, named after the dish id (the first text in the dish's line in `src/data.js`),
for example `images/chips.jpg`. Run `node build.js` and the photos are embedded in `dist/food-chooser.html`. The build prints
which dishes have a photo and which do not. Types: .jpg .jpeg .png .webp, ideally about 800 px wide (big ones are shrunk
automatically if ImageMagick is installed). A photo added in the My Dishes tab for the same dish takes priority over the built one.
Photos built in are not copied into browser storage or "Save app copy" files a second time.
