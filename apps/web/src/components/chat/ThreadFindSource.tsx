import type { LegendListRef } from "@legendapp/list/react";
import type { OrchestrationThreadFindMatch } from "@t3tools/contracts";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { resolveThreadFindRange } from "~/lib/assistantTextSelection";

const THREAD_FIND_HIGHLIGHT = "t3-thread-find";

export interface ThreadFindRequest {
  readonly key: string;
  readonly query: string;
  readonly match: OrchestrationThreadFindMatch;
}

export interface ThreadFindTarget extends ThreadFindRequest {
  readonly activationRef: RefObject<{
    scrolled: boolean;
    cancelled: boolean;
    cancelScroll?: () => void;
  }>;
  readonly onPositioned: () => void;
}

export function observeThreadFindSource({
  root,
  itemKey,
  request,
  list,
}: {
  root: HTMLElement;
  itemKey: string;
  request: ThreadFindTarget;
  list: LegendListRef;
}): () => void {
  const activation = request.activationRef.current;
  const scrollNode = list.getScrollableNode();
  if (!(scrollNode instanceof HTMLElement)) return () => {};
  let frame: number | null = null;
  let stopped = false;
  let scrolling = false;
  let highlight: Highlight | null = null;

  const clear = () => {
    if (
      highlight &&
      typeof CSS !== "undefined" &&
      CSS.highlights?.get(THREAD_FIND_HIGHLIGHT) === highlight
    ) {
      CSS.highlights.delete(THREAD_FIND_HIGHLIGHT);
    }
    highlight = null;
    delete root.dataset.threadFindActive;
  };
  const schedule = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  };
  const position = () => {
    frame = null;
    if (stopped || activation.cancelled || !root.isConnected || !scrollNode.contains(root)) {
      clear();
      return;
    }
    const state = list.getState();
    const index = state.indexByKey(itemKey);
    if (index === undefined || !(state.sizeAtIndex(index) > 0)) return;
    const range = resolveThreadFindRange(root, request.query, request.match.occurrenceIndex);
    const rect = (range ?? root).getBoundingClientRect();
    if (rect.height <= 0 || scrollNode.clientHeight <= 0) return;

    if (!activation.scrolled) {
      if (scrolling) return;
      const viewportRect = scrollNode.getBoundingClientRect();
      const offset = Math.max(
        0,
        Math.min(
          scrollNode.scrollHeight - scrollNode.clientHeight,
          state.scroll + rect.top - viewportRect.top - Math.min(120, scrollNode.clientHeight / 3),
        ),
      );
      if (Math.abs(offset - state.scroll) > 1) {
        scrolling = true;
        void list.scrollToOffset({ offset, animated: false }).then(
          () => {
            scrolling = false;
            if (!stopped && !activation.cancelled) schedule();
          },
          () => {
            scrolling = false;
            if (stopped || activation.cancelled) return;
            activation.scrolled = true;
            request.onPositioned();
            schedule();
          },
        );
        return;
      }
      activation.scrolled = true;
      request.onPositioned();
    }

    clear();
    if (range && typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights) {
      highlight = new Highlight(range);
      CSS.highlights.set(THREAD_FIND_HIGHLIGHT, highlight);
    } else {
      root.dataset.threadFindActive = "true";
    }
  };
  const cancelScroll = () => {
    if (!scrolling) return;
    scrolling = false;
    void list.scrollToOffset({ offset: list.getState().scroll, animated: false });
  };
  activation.cancelScroll = cancelScroll;

  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(root);
  resizeObserver.observe(scrollNode);
  const state = list.getState();
  const unsubscribe = [
    state.listenToPosition(itemKey, schedule),
    state.listen("totalSize", schedule),
    state.listen("headerSize", schedule),
  ];
  schedule();

  return () => {
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    resizeObserver.disconnect();
    for (const stop of unsubscribe) stop();
    if (activation.cancelScroll === cancelScroll) delete activation.cancelScroll;
    clear();
  };
}

export function ThreadFindSource({
  messageId,
  itemKey,
  request,
  listRef,
  children,
}: {
  readonly messageId: string;
  readonly itemKey: string;
  readonly request: ThreadFindTarget | null;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list || !request || request.match.messageId !== messageId) return;
    return observeThreadFindSource({ root, itemKey, request, list });
  }, [itemKey, listRef, messageId, request]);

  return (
    <div ref={rootRef} data-thread-find-source={messageId}>
      {children}
    </div>
  );
}
