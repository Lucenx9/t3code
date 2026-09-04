import {
  THREAD_FIND_RESULT_LIMIT,
  THREAD_FIND_SKILL_LIMIT,
  THREAD_FIND_SKILL_TEXT_MAX_LENGTH,
  type OrchestrationThreadFindMatch,
  type ServerProviderSkill,
} from "@t3tools/contracts";

type ThreadFindSkill = Pick<ServerProviderSkill, "name" | "displayName">;
type PresentedThreadFindSkill = {
  readonly name: string;
  readonly displayName?: string;
};

export function presentThreadFindSkills(
  skills: ReadonlyArray<ThreadFindSkill>,
): ReadonlyArray<PresentedThreadFindSkill> {
  const presented: PresentedThreadFindSkill[] = [];
  for (const skill of skills) {
    if (presented.length >= THREAD_FIND_SKILL_LIMIT) break;
    const name = skill.name.trim();
    if (name.length === 0 || name.length > THREAD_FIND_SKILL_TEXT_MAX_LENGTH) continue;
    const displayName = skill.displayName?.trim();
    presented.push({
      name,
      ...(displayName
        ? { displayName: displayName.slice(0, THREAD_FIND_SKILL_TEXT_MAX_LENGTH) }
        : {}),
    });
  }
  return presented;
}

export function nextThreadFindIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + direction + total) % total;
}

export function threadFindPageStart(targetIndex: number, direction: 1 | -1): number {
  return direction === 1 ? targetIndex : Math.max(0, targetIndex - THREAD_FIND_RESULT_LIMIT + 1);
}

export function threadFindTargetKey(
  query: string,
  match: Pick<OrchestrationThreadFindMatch, "messageId" | "occurrenceIndex">,
): string {
  return `${query}\0${match.messageId}\0${match.occurrenceIndex}`;
}
