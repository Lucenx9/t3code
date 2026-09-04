const THREAD_FIND_OPEN_EVENT = "t3code:open-thread-find";

export function openThreadFind(): void {
  window.dispatchEvent(new CustomEvent(THREAD_FIND_OPEN_EVENT));
}

export function onOpenThreadFind(listener: () => void): () => void {
  window.addEventListener(THREAD_FIND_OPEN_EVENT, listener);
  return () => window.removeEventListener(THREAD_FIND_OPEN_EVENT, listener);
}
