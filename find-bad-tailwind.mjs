import fs from "fs";
import path from "path";

const TARGETS = [
  path.join(process.cwd(), "app", "globals.css"),
  path.join(process.cwd(), "src", "app", "globals.css"),
];

const patterns = [
  { name: "BAD_SELECTOR", re: /\.\\\[-\\:\\\|\\\]/g },     // .\[-:\|\]
  { name: "BAD_PROPERTY", re: /^\s*-:\s*\|;\s*$/gm },      // -: |;
  { name: "JS_IN_CSS", re: /const\s+nextConfig|export\s+default\s+nextConfig/g },
  { name: "JSON_IN_CSS", re: /"name"\s*:\s*"assistant-candidatures"/g },
];

function contextLines(lines, idx, span = 3) {
  const start = Math.max(0, idx - span);
  const end = Math.min(lines.length, idx + span + 1);
  return lines
    .slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(5, " ")} | ${l}`)
    .join("\n");
}

let foundAny = false;

for (const file of TARGETS) {
  if (!fs.existsSync(file)) continue;

  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  console.log(`\n▶ Scan: ${path.relative(process.cwd(), file)}`);

  for (const p of patterns) {
    const matches = [...text.matchAll(p.re)];
    if (matches.length === 0) continue;

    foundAny = true;
    console.log(`\n❌ Found ${p.name} (${matches.length} match(es))`);

    // Affiche le contexte des 3 premiers hits
    for (const m of matches.slice(0, 3)) {
      const pos = m.index ?? 0;
      const before = text.slice(0, pos);
      const lineIdx = before.split(/\r?\n/).length - 1;
      console.log("\n" + contextLines(lines, lineIdx, 4));
    }
  }
}

if (foundAny) {
  console.error("\n⛔ CSS invalide détecté. Corrige globals.css (ou lance fix-globals).");
  process.exit(1);
} else {
  console.log("\n✅ Aucun pattern suspect trouvé.");
}
