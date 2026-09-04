export type ProviderSkillLabel = {
  readonly name: string;
  readonly displayName?: string | undefined;
};

function titleCaseWords(value: string): string {
  const words: string[] = [];
  for (const segment of value.split(/[\s:_-]+/u)) {
    if (segment.length === 0) continue;
    words.push(segment.charAt(0).toUpperCase() + segment.slice(1));
  }
  return words.join(" ");
}

export function formatProviderSkillDisplayName(skill: ProviderSkillLabel): string {
  const displayName = skill.displayName?.trim();
  return displayName || titleCaseWords(skill.name);
}
