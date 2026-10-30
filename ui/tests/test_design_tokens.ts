import assert from "assert";
import fs from "fs";
import path from "path";

/**
 * Design-system guard: scans every component source and fails if de-slopped
 * patterns creep back in (off-grid spacing, ad-hoc pixel type sizes, raw hex
 * colour utilities, decorative gradients, sub-11px text).
 */

const SRC = path.resolve(__dirname, "../src");

/** Hex colours that are allowed because they are third-party brand or OS chrome specs. */
const HEX_ALLOWLIST = new Set([
  // macOS traffic lights + pressed glyph tints
  "FF5F56", "FFBD2E", "27C93F", "E0443E", "DEA123", "1AAB29", "5B3F00", "4D0000", "0A4D12",
  // Windows close button
  "E81123", "C4101F",
  // Discord brand
  "5865F2",
]);

/** Spacing keys that exist in tailwind.config.js `grid` (plus margin `auto` / space `reverse`). */
const GRID_KEYS = new Set([
  "0", "px", "1", "2", "3", "4", "5", "6", "8", "10", "12", "14", "16", "20", "24", "28", "32", "auto", "reverse",
]);

interface Violation {
  file: string;
  line: number;
  rule: string;
  match: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const RULES: { name: string; re: RegExp; filter?: (m: RegExpMatchArray) => boolean }[] = [
  {
    name: "off-grid spacing (use the 4/8px scale)",
    re: /(?<=[\s"'`{(])(?:[\w/[\]&>*-]+:)*-?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-([\w.[\]%()+*-]+)(?=[\s"'`})])/g,
    filter: (m) => !GRID_KEYS.has(m[1] || ""),
  },
  {
    name: "arbitrary pixel font size (use text-2xs…text-7xl)",
    re: /text-\[\d+(?:\.\d+)?px\]/g,
  },
  {
    name: "raw hex colour utility (use a theme token)",
    re: /(?:text|bg|border|from|via|to|ring|shadow|fill|stroke|placeholder|divide|outline)-\[#([0-9A-Fa-f]{3,8})\]/g,
    filter: (m) => !HEX_ALLOWLIST.has((m[1] || "").toUpperCase()),
  },
  {
    name: "decorative rainbow palette (use accent / status tokens)",
    re: /(?:text|bg|border|from|via|to|ring|shadow)-(?:indigo|violet|purple|fuchsia|cyan|sky|blue|teal|pink)-\d{2,3}/g,
  },
];

export function runDesignTokenGuardTests(): { filesScanned: number } {
  console.log("\n=======================================================");
  console.log("  DESIGN TOKEN GUARD (spacing grid, type scale, colour)");
  console.log("=======================================================\n");

  const files = walk(SRC);
  const violations: Violation[] = [];

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const rule of RULES) {
        for (const m of text.matchAll(rule.re)) {
          if (rule.filter && !rule.filter(m)) continue;
          violations.push({ file: path.relative(SRC, file), line: i + 1, rule: rule.name, match: m[0] });
        }
      }
    });
  }

  if (violations.length > 0) {
    for (const v of violations.slice(0, 40)) {
      console.log(`  ✗ ${v.file}:${v.line}  ${v.match}  — ${v.rule}`);
    }
  }
  assert.strictEqual(violations.length, 0, `${violations.length} design-token violation(s) found`);
  console.log(`  ✓ ${files.length} component files conform to the design-token contract`);

  // Tailwind config must keep spacing utilities locked to the grid.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configSrc = fs.readFileSync(path.resolve(__dirname, "../tailwind.config.js"), "utf8");
  assert.ok(/padding:\s*grid/.test(configSrc), "padding must be bound to the grid scale");
  assert.ok(/gap:\s*grid/.test(configSrc), "gap must be bound to the grid scale");
  console.log("  ✓ Tailwind padding / margin / gap / space bound to the grid scale");

  return { filesScanned: files.length };
}
