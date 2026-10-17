/**
 * AP-style Title Case for UI labels (headings, nav items, buttons, tabs, field labels, table headers).
 * Words of four or more letters are capitalized; short articles, conjunctions and prepositions are
 * lowercase unless first or last ("up" and "off" in "Set Up" or "Sign Off" are
 * capitalized: there they are part of the verb). Sentences, descriptions and helper text stay in sentence case.
 */
const MINOR = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'for',
  'so',
  'yet',
  'as',
  'at',
  'by',
  'in',
  'of',
  'on',
  'per',
  'to',
  'via',
  'vs',
]);

function capitalize(word: string): string {
  return word.replace(/\p{L}/u, (c) => c.toUpperCase());
}

export function apTitleCase(text: string): string {
  const words = text.split(' ');
  return words
    .map((word, i) => {
      if (/[A-Z].*[A-Z]|\d|\//.test(word) || /^[A-Z]/.test(word)) return word;
      const bare = word.toLowerCase().replace(/[^\p{L}]/gu, '');
      const edge = i === 0 || i === words.length - 1;
      if (!edge && MINOR.has(bare)) return word.toLowerCase();
      return word.split('-').map(capitalize).join('-');
    })
    .join(' ');
}

export function isApTitleCase(text: string): boolean {
  return apTitleCase(text) === text;
}
