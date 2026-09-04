export function normalizeThreadFindQuery(query: string): string {
  return query.replace(/\s+/gu, " ").trim();
}

function compileThreadFindQuery(query: string): RegExp | null {
  const needle = normalizeThreadFindQuery(query);
  if (needle.length === 0) return null;
  return new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
}

export function findThreadFindOccurrence(
  text: string,
  query: string,
  occurrenceIndex: number,
): { readonly start: number; readonly end: number } | null {
  if (!Number.isSafeInteger(occurrenceIndex) || occurrenceIndex < 0) return null;
  const matcher = compileThreadFindQuery(query);
  if (!matcher) return null;
  let foundIndex = 0;
  for (const match of text.matchAll(matcher)) {
    if (foundIndex === occurrenceIndex) {
      const start = match.index;
      return { start, end: start + match[0].length };
    }
    foundIndex += 1;
  }
  return null;
}

/** Browser-find style, case-insensitive, non-overlapping occurrence count. */
export function countThreadFindOccurrences(text: string, query: string): number {
  const matcher = compileThreadFindQuery(query);
  if (!matcher) return 0;
  let count = 0;
  for (const _match of text.matchAll(matcher)) count += 1;
  return count;
}
