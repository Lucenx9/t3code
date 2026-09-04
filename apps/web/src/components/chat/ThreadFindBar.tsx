import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { THREAD_FIND_RESULT_LIMIT } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import type { ThreadFindRequest } from "./ThreadFindSource";
import { nextThreadFindIndex, threadFindPageStart } from "./ThreadFindBar.logic";

const QUERY_DEBOUNCE_MS = 120;

export function ThreadFindBar({
  environmentId,
  threadId,
  focusRequestId,
  onRequest,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly focusRequestId: number;
  readonly onRequest: (request: ThreadFindRequest | null) => void;
  readonly onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pageStart, setPageStart] = useState(0);

  useEffect(() => {
    if (focusRequestId === 0) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequestId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query.trim()), QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const resultAtom = useMemo(
    () =>
      settledQuery.length === 0
        ? null
        : orchestrationEnvironment.threadFind({
            environmentId,
            input: {
              threadId,
              query: settledQuery,
              startIndex: pageStart,
              limit: THREAD_FIND_RESULT_LIMIT,
            },
          }),
    [environmentId, pageStart, settledQuery, threadId],
  );
  const result = useEnvironmentQuery(resultAtom);
  const data = result.data;

  useEffect(() => {
    if (query.trim() !== settledQuery) {
      onRequest(null);
      return;
    }
    if (data === null) {
      onRequest(null);
      return;
    }
    if (revisionRef.current !== null && revisionRef.current !== data.revision && pageStart !== 0) {
      revisionRef.current = data.revision;
      setActiveIndex(0);
      setPageStart(0);
      return;
    }
    revisionRef.current = data.revision;
    if (data.total === 0) {
      onRequest(null);
      return;
    }
    const boundedIndex = Math.min(activeIndex, data.total - 1);
    const match = data.matches[boundedIndex - data.startIndex];
    if (!match) return;
    onRequest({
      key: `${settledQuery}\0${data.revision}\0${boundedIndex}\0${match.messageId}\0${match.occurrenceIndex}`,
      query: settledQuery,
      match,
    });
  }, [activeIndex, data, onRequest, pageStart, query, settledQuery]);

  const total = data?.total ?? 0;
  const displayedIndex = total === 0 ? 0 : Math.min(activeIndex, total - 1);
  const pending = query.trim() !== settledQuery || result.isPending;
  const move = (direction: 1 | -1) => {
    if (pending || total === 0) return;
    const target = nextThreadFindIndex(displayedIndex, total, direction);
    const pageEnd = (data?.startIndex ?? 0) + (data?.matches.length ?? 0);
    if (!data || target < data.startIndex || target >= pageEnd) {
      setPageStart(threadFindPageStart(target, direction));
      onRequest(null);
    }
    setActiveIndex(target);
  };

  return (
    <div
      role="search"
      aria-label="Find in conversation"
      className="pointer-events-auto absolute top-2 right-3 left-3 z-30 flex h-9 items-center gap-1 rounded-lg border border-border/70 bg-popover/95 p-1 shadow-lg backdrop-blur-md sm:left-auto"
      data-thread-find-bar="true"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <InputGroup
        variant="ghost"
        className="h-7 min-w-0 flex-1 border-0 bg-transparent shadow-none hover:bg-transparent has-[input:focus-visible]:bg-transparent has-[input:focus-visible]:ring-0 sm:w-56 sm:flex-none **:[input]:h-7 **:[input]:px-1 **:[input]:text-sm **:[input]:leading-7"
      >
        <InputGroupAddon className="ps-1 pe-0">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setPageStart(0);
            revisionRef.current = null;
            onRequest(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              move(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Find in conversation"
          aria-label="Find in conversation"
          autoComplete="off"
          spellCheck={false}
        />
      </InputGroup>
      <span
        className="min-w-14 px-1 text-right text-muted-foreground text-xs tabular-nums"
        aria-live="polite"
      >
        {result.error
          ? "Unavailable"
          : pending && query.trim().length > 0
            ? "Searching…"
            : total > 0
              ? `${displayedIndex + 1} of ${total}`
              : "0 of 0"}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Previous match"
        disabled={pending || total === 0}
        onClick={() => move(-1)}
      >
        <ChevronUpIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Next match"
        disabled={pending || total === 0}
        onClick={() => move(1)}
      >
        <ChevronDownIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Close find"
        onClick={onClose}
      >
        <XIcon className="size-3.5" />
      </Button>
      {result.error ? <span className="sr-only">Search failed: {result.error}</span> : null}
    </div>
  );
}
