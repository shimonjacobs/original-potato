#!/usr/bin/env node
/**
 * Bundles src/ into one self-contained file: dist/food-chooser.html
 * Only Node's built-in fs/path are used - no npm install needed.
 *   node build.js
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const OUT_DIR = path.join(__dirname, "dist");
const OUT = path.join(OUT_DIR, "food-chooser.html");

// Order matters: everything shares one global scope once concatenated.
const JS_FILES = ["config.js", "store.js", "trace.js", "data.js", "engine.js", "dishes.js", "jev.js", "chat.js", "controller.js", "memory.js", "ui.js", "editor.js", "debug.js"];
const read = function (n) { return fs.readFileSync(path.join(SRC, n), "utf8"); };

/* ---- photos: put one picture per dish in images/, named after the dish id (e.g. images/chips.jpg).
 * They are embedded into the finished file. If ImageMagick ("convert" or "magick") is installed,
 * big photos are shrunk automatically; otherwise they are embedded as they are. */
const IMG_DIR = path.join(__dirname, "images");
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const MAX_DATA_URI = 200000; // what the dish editor accepts for photos
function shrink(file) {
  const cp = require("child_process");
  const args = [file, "-auto-orient", "-resize", "800x800>", "-strip", "-quality", "78", "jpeg:-"];
  for (const bin of ["magick", "convert"]) {
    try { return cp.execFileSync(bin, args, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }); } catch (e) { /* try next / fall back */ }
  }
  return null;
}
function buildImages() {
  const out = {};
  if (!fs.existsSync(IMG_DIR)) return out;
  const ids = [];
  (read("data.js").match(/\bD\(\s*"([a-z0-9-]+)"/g) || []).forEach(function (m) { ids.push(m.replace(/^D\(\s*"/, "").replace(/"$/, "")); });
  fs.readdirSync(IMG_DIR).sort().forEach(function (f) {
    const ext = path.extname(f).toLowerCase();
    if (!MIME[ext]) return;
    const id = path.basename(f, path.extname(f)).toLowerCase();
    const file = path.join(IMG_DIR, f);
    let buf = fs.readFileSync(file), mime = MIME[ext];
    if (buf.length * 4 / 3 > MAX_DATA_URI) {
      const small = shrink(file);
      if (small && small.length < buf.length) { buf = small; mime = "image/jpeg"; }
    }
    const kb = Math.round(buf.length / 1024);
    if (buf.length > 400 * 1024) console.log("  Warning: images/" + f + " is " + kb + " KB. Resize it to about 800 px wide to keep the app small.");
    if (ids.length && ids.indexOf(id) === -1) console.log("  Note: images/" + f + " does not match any dish id in data.js (it will only show if a dish with the id \"" + id + "\" exists).");
    out[id] = "data:" + mime + ";base64," + buf.toString("base64");
  });
  const missing = ids.filter(function (id) { return !out[id]; });
  console.log("Photos: " + Object.keys(out).length + " embedded" + (missing.length ? ", no photo for: " + missing.join(", ") : "") + ".");
  return out;
}

const template = fs.readFileSync(path.join(__dirname, "index.template.html"), "utf8");
const css = read("styles.css");
const builtImages = "/* ---- images/ (generated) ---- */\nconst BUILT_IMAGES = " + JSON.stringify(buildImages()).replace(/</g, "\\u003c") + ";";
const js = builtImages + "\n\n" + JS_FILES.map(function (n) { return "/* ---- src/" + n + " ---- */\n" + read(n); }).join("\n\n");

// Function replacers: the code contains "$" characters that a plain
// string replacement would misinterpret.
let html = template.replace("<!--STYLES-->", function () { return css; });
html = html.replace("<!--SCRIPT-->", function () { return js; });

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html, "utf8");
console.log("Built " + path.relative(__dirname, OUT) + " (" + (Buffer.byteLength(html) / 1024).toFixed(1) + " KB)");
