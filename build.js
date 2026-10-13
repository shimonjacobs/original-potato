#!/usr/bin/env node
/**
 * Bundles src/ into one self-contained file: dist/food-chooser.html
 * Only Node's built-in fs/path are used, no npm install needed.
 *   node build.js
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "dist", "food-chooser.html");
const IMG_DIR = path.join(__dirname, "images");

// Each file defines one object. Order matters: a file may only use the ones above it at load time.
const LOGIC_FILES = ["config.js", "store.js", "debug.js", "dishes.js", "rules.js", "ai.js", "picker.js", "wording.js", "turn.js", "chips.js"];
const UI_FILES = ["dom.js", "ui-chat.js", "ui-browse.js", "ui-editor.js", "ui-settings.js", "ui-debug.js", "app.js"];

const read = function (name) { return fs.readFileSync(path.join(SRC, name), "utf8"); };

/* Photos: one picture per dish in images/, named after the dish id (images/chips.jpg).
 * If ImageMagick is installed, big photos are shrunk; otherwise they are embedded as they are. */
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const MAX_DATA_URI = 200000; // what the dish editor accepts for photos

function shrink(file) {
  const args = [file, "-auto-orient", "-resize", "800x800>", "-strip", "-quality", "78", "jpeg:-"];
  for (const bin of ["magick", "convert"]) {
    try { return require("child_process").execFileSync(bin, args, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }); } catch (e) { /* try the next one */ }
  }
  return null;
}

function buildImages() {
  const out = {};
  if (!fs.existsSync(IMG_DIR)) return out;
  const ids = (read("dishes.js").match(/\bD\(\s*"([a-z0-9-]+)"/g) || []).map(function (m) { return m.replace(/^D\(\s*"/, "").replace(/"$/, ""); });
  fs.readdirSync(IMG_DIR).sort().forEach(function (f) {
    const ext = path.extname(f).toLowerCase();
    if (!MIME[ext]) return;
    const id = path.basename(f, path.extname(f)).toLowerCase();
    let buf = fs.readFileSync(path.join(IMG_DIR, f)), mime = MIME[ext];
    if (buf.length * 4 / 3 > MAX_DATA_URI) {
      const small = shrink(path.join(IMG_DIR, f));
      if (small && small.length < buf.length) { buf = small; mime = "image/jpeg"; }
    }
    if (buf.length > 400 * 1024) console.log("  Warning: images/" + f + " is " + Math.round(buf.length / 1024) + " KB. Resize it to about 800 px wide.");
    if (ids.indexOf(id) === -1) console.log("  Note: images/" + f + " does not match any dish id in dishes.js.");
    out[id] = "data:" + mime + ";base64," + buf.toString("base64");
  });
  const missing = ids.filter(function (id) { return !out[id]; });
  console.log("Photos: " + Object.keys(out).length + " embedded" + (missing.length ? ", no photo for: " + missing.join(", ") : "") + ".");
  return out;
}

function build() {
  const template = fs.readFileSync(path.join(__dirname, "index.template.html"), "utf8");
  const images = "const BUILT_IMAGES = " + JSON.stringify(buildImages()).replace(/</g, "\\u003c") + ";";
  const js = [images].concat(LOGIC_FILES.concat(UI_FILES).map(function (n) { return "/* ---- src/" + n + " ---- */\n" + read(n); })).join("\n\n");
  // Function replacers: the code contains "$" characters that a plain string replacement would misread.
  const html = template.replace("<!--STYLES-->", function () { return read("styles.css"); }).replace("<!--SCRIPT-->", function () { return js; });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");
  console.log("Built " + path.relative(__dirname, OUT) + " (" + (Buffer.byteLength(html) / 1024).toFixed(1) + " KB)");
}

if (require.main === module) build();
module.exports = { LOGIC_FILES: LOGIC_FILES, SRC: SRC };
