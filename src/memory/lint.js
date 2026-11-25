// Anti-cliché rules for the log voice (spec §9): understated, observant,
// concrete. These phrases never appear in an entry; tests run hundreds of
// generated logs through this list.
export const BANNED = [
  /\bvast(ness)?\b/i, /\binfinite\b/i, /\binfinity\b/i, /\bcosmic\b/i, /\bcosmos\b/i, /\bendless\b/i, /\beternal\b/i, /\beternity\b/i,
  /\bunfathomable\b/i, /\bincomprehensible\b/i, /\bmajestic\b/i, /\bethereal\b/i, /\bbreathtaking\b/i, /\bawe-?inspiring\b/i,
  /\btapestry\b/i, /\bsymphony\b/i, /\bdance of\b/i, /\btestament\b/i, /\bbeacon of\b/i, /\bjourney of a lifetime\b/i,
  /\balone in the universe\b/i, /\bthe stars (whisper|call|sing)\b/i, /\bsea of stars\b/i, /\bvoid (stares|calls|beckons)\b/i,
  /\bmere mortal\b/i, /\bfinal frontier\b/i, /\bwhere no one\b/i, /\bin the grand scheme\b/i, /\bsoul\b/i, /\bdestiny\b/i,
  /\bheart (soared|sank|pounded)\b/i, /\btears? (streamed|welled)\b/i, /\bmeaning of (it all|life)\b/i, /\bspeck\b/i, /\binsignificant\b/i,
  /\bhumbling\b/i, /\bnever (be|feel) the same\b/i, /\bwords cannot\b/i, /\bindescribable\b/i, /\bunimaginabl/i, /\bmagical\b/i,
  /!/, /\.\.\./, /\bsuddenly\b/i, /\bdeafening silence\b/i, /\bcold embrace\b/i, /\bdarkness (closes|swallows)\b/i,
];

export const MAX_WORDS = 26;

/** Returns a list of problems (empty when the text is clean). */
export function lintLog(text) {
  const problems = [];
  for (const re of BANNED) if (re.test(text)) problems.push(`cliché: ${re}`);
  for (const s of text.split(/(?<=[.?])\s+/)) {
    const words = s.trim().split(/\s+/).filter(Boolean).length;
    if (words > MAX_WORDS) problems.push(`too long (${words} words): ${s}`);
  }
  return problems;
}
