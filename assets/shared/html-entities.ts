const character = (...codePoints: number[]) => String.fromCodePoint(...codePoints);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: character(0xa0),
  zwnj: "",
  zwj: "",
  shy: "",
  rarr: character(0x2192),
  larr: character(0x2190),
  bull: character(0x2022),
  middot: character(0xb7),
  mdash: character(0x2014),
  ndash: character(0x2013),
  hellip: character(0x2026),
  copy: character(0xa9),
  lsquo: character(0x2018),
  rsquo: character(0x2019),
  ldquo: character(0x201c),
  rdquo: character(0x201d),
  laquo: character(0xab),
  raquo: character(0xbb),
};

/**
 * The text a character reference stands for, such as `R&amp;D` or `&#39;`. One pass, so
 * `&amp;lt;` reads as the literal `&lt;` and never as `<`.
 */
export function decodeCharacterReferences(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (match, decimal, hex, name) => {
    if (name) return NAMED_ENTITIES[name] ?? match;
    const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}
