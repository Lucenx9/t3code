import { THREAD_FIND_RESULT_LIMIT } from "@t3tools/contracts";

export function nextThreadFindIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + direction + total) % total;
}

export function threadFindPageStart(targetIndex: number, direction: 1 | -1): number {
  return direction === 1 ? targetIndex : Math.max(0, targetIndex - THREAD_FIND_RESULT_LIMIT + 1);
}
