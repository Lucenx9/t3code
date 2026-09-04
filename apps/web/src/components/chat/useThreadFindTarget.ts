import type { LegendListRef } from "@legendapp/list/react";
import type { TurnId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { CitationHistoryPage } from "./useAssistantCitationTarget";
import type { ThreadFindRequest, ThreadFindTarget } from "./ThreadFindSource";

/** Fetch, unfold, and mount a selected find result before it owns scrolling. */
export function useThreadFindTarget({
  request,
  entries,
  rows,
  listRef,
  viewport,
  historyLoading,
  loadEarlier,
  onExpandTurn,
  onManualNavigation,
}: {
  request: ThreadFindRequest | null;
  entries: ReadonlyArray<TimelineEntry>;
  rows: ReadonlyArray<MessagesTimelineRow>;
  listRef: RefObject<LegendListRef | null>;
  viewport: HTMLElement | null;
  historyLoading: boolean;
  loadEarlier: CitationHistoryPage | null;
  onExpandTurn: (turnId: TurnId) => void;
  onManualNavigation: () => void;
}) {
  const [ready, setReady] = useState<ThreadFindTarget | null>(null);
  const [positionedKey, setPositionedKey] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const onListLoad = useCallback(() => setListLoaded(true), []);
  const navigationRef = useRef<{
    target: ThreadFindTarget;
    requestedTargets: Set<string>;
    positioned: boolean;
  } | null>(null);

  useEffect(() => {
    if (navigationRef.current?.target.key !== request?.key) {
      const previous = navigationRef.current?.target;
      if (previous) {
        previous.activationRef.current.cancelled = true;
        previous.activationRef.current.cancelScroll?.();
      }
      navigationRef.current = null;
      setReady(null);
      setPositionedKey(null);
    }
    if (!request) return;
    if (navigationRef.current === null) {
      const target: ThreadFindTarget = {
        ...request,
        activationRef: {
          current: { scrolled: false, scrolledToExactRange: false, cancelled: false },
        },
        onPositioned: () => {
          if (navigationRef.current?.target !== target) return;
          navigationRef.current.positioned = true;
          setPositionedKey(target.key);
          onManualNavigation();
        },
      };
      navigationRef.current = {
        target,
        requestedTargets: new Set(),
        positioned: false,
      };
      onManualNavigation();
    }
    if (!viewport || historyLoading) return;
    const navigation = navigationRef.current;
    if (!navigation || navigation.positioned) return;
    const source = entries.find(
      (entry) => entry.kind === "message" && entry.message.id === request.match.messageId,
    );
    if (!source) {
      if (!loadEarlier) {
        navigation.positioned = true;
        setPositionedKey(navigation.target.key);
        return;
      }
      if (loadEarlier.loading) return;
      const targetPageKey = `target:${request.match.targetCursor}`;
      if (loadEarlier.onLoadWindow && !navigation.requestedTargets.has(targetPageKey)) {
        navigation.requestedTargets.add(targetPageKey);
        loadEarlier.onLoadWindow(request.match.targetCursor);
        return;
      }
      navigation.positioned = true;
      setPositionedKey(navigation.target.key);
      return;
    }
    const row = rows.find(
      (candidate) =>
        candidate.kind === "message" && candidate.message.id === request.match.messageId,
    );
    if (!row) {
      if (source.kind === "message" && source.message.turnId) onExpandTurn(source.message.turnId);
      return;
    }
    if (listLoaded && listRef.current) setReady(navigation.target);
  }, [
    entries,
    historyLoading,
    listLoaded,
    listRef,
    loadEarlier,
    onExpandTurn,
    onManualNavigation,
    request,
    rows,
    viewport,
  ]);

  const target = ready?.key === request?.key ? ready : null;
  const positioning = request !== null && positionedKey !== request.key;
  const sourceRow = target
    ? rows.find((row) => row.kind === "message" && row.message.id === target.match.messageId)
    : undefined;
  return {
    target,
    positioning,
    onListLoad,
    alwaysRender: sourceRow ? { keys: [sourceRow.id] } : undefined,
  };
}
