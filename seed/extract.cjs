// Extracts UNITS + SOLUTIONS arrays from the live single-file app into content.json.
// Run once (or whenever the source content changes): node seed/extract.cjs
const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "..", "..", "finfluency-deploy", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

function grab(name) {
  const start = html.indexOf("const " + name + "=[");
  if (start < 0) throw new Error("could not find const " + name);
  // find the matching closing of the array by bracket counting from the first '['
  const open = html.indexOf("[", start);
  let depth = 0, i = open, inStr = false, strCh = "";
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = true; strCh = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { i++; break; } }
  }
  const arrText = html.slice(open, i);
  return eval(arrText); // trusted local source
}

const units = grab("UNITS");
const solutions = grab("SOLUTIONS");
fs.writeFileSync(path.join(__dirname, "content.json"), JSON.stringify({ units, solutions }, null, 2));
const count = (a) => a.reduce((n, d) => n + d.cards.length, 0);
console.log(`Extracted: ${units.length} path units (${count(units)} cards), ${solutions.length} solutions decks (${count(solutions)} cards)`);
