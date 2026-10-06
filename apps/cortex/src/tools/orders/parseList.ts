/**
 * Pasted product list → candidate product names. Pure (no React, no I/O), so the
 * cleaning rules can be checked on their own.
 *
 * One line = one product. Blank lines are skipped. From the START of each line we
 * strip, repeatedly (so "1. - 🍅 עגבניות" → "עגבניות"):
 *   - numbering: digits followed by "." or ")" — "1.", "2)", "10." — and keycap
 *     emoji numbers ("1️⃣"). A number WITHOUT that punctuation stays, because it
 *     is part of the name or a quantity: "3% חלב", "5 ק"ג תפוחים".
 *   - dashes and bullets: - – — • · * ▪ ◦ ● ○ ► ▶ ✓ ✔ ☐ ☑ > +
 *   - emoji
 * Whitespace is then collapsed (`normalizeName`). Anything left over is visible
 * in the preview and can be removed there.
 */
import { normalizeName } from "./catalog";

/** Hard cap on lines per paste — a whole chat pasted by mistake must not create
 * hundreds of products. */
export const MAX_LIST_LINES = 200;

const NUMBERING = /^\d+[.)](?=\s|$|\D)/u;
const KEYCAP = /^\d️?⃣/u;
const BULLETS = /^[-–—•·*▪◦●○►▶✓✔☐☑>+]+/u;
const EMOJI = /^[\p{Extended_Pictographic}️‍]+/u;

function cleanLine(raw: string): string {
  let line = raw.trim();
  // Loop until nothing more comes off the front.
  for (;;) {
    const next = line
      .replace(KEYCAP, "")
      .replace(NUMBERING, "")
      .replace(BULLETS, "")
      .replace(EMOJI, "")
      .trimStart();
    if (next === line) break;
    line = next;
  }
  return normalizeName(line);
}

export interface ParsedList {
  /** Cleaned, non-empty names, in paste order (duplicates kept — the preview marks them). */
  names: string[];
  /** True when the paste has more than MAX_LIST_LINES non-empty lines. */
  tooMany: boolean;
}

export function parseList(text: string): ParsedList {
  const names = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((name) => name !== "");
  return { names, tooMany: names.length > MAX_LIST_LINES };
}
