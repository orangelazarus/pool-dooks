// Acronyms and checking answers against them. Shared by the server, which
// enforces the rule, and the browser, which shows it as you type.

/** First letter of each word: skips leading punctuation, so "(Very) 'Big' Dogs" is VBD. */
export function initials(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.match(/[a-z]/i)?.[0]?.toUpperCase() ?? "");
}

/**
 * Why an answer doesn't fit, or null when it does: one word per letter, each
 * starting with its letter. A hyphenated word is one word.
 */
export function misfit(acronym: string, text: string): string | null {
  const got = initials(text);
  const letters = acronym.split("");
  if (got.length !== letters.length) {
    return `${acronym} needs ${letters.length} words — you wrote ${got.length}`;
  }
  const wrong = letters.findIndex((letter, i) => got[i] !== letter);
  if (wrong >= 0) return `Word ${wrong + 1} should start with ${letters[wrong]}`;
  return null;
}

/** How a backronym is stored and shown: as typed, with the spacing tidied. */
export function tidy(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
