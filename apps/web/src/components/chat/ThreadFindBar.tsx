import type { EnvironmentId, ServerProviderSkill, ThreadId } from "@t3tools/contracts";
import { THREAD_FIND_QUERY_MAX_LENGTH, THREAD_FIND_RESULT_LIMIT } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import type { ThreadFindRequest } from "./ThreadFindSource";
import {
  nextThreadFindIndex,
  presentThreadFindSkills,
  threadFindPageStart,
  threadFindTargetKey,
} from "./ThreadFindBar.logic";

const QUERY_DEBOUNCE_MS = 120;
const INITIAL_RESULT_INDEX = Number.MAX_SAFE_INTEGER;
const ESCAPE_BLOCKING_LAYER_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '[data-slot="alert-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="command-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="sheet-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

export function ThreadFindBar({
  environmentId,
  threadId,
  skills,
  messageRevision,
  focusRequestId,
  onRequest,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  readonly messageRevision: string;
  readonly focusRequestId: number;
  readonly onRequest: (request: ThreadFindRequest | null) => void;
  readonly onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const messageRevisionRef = useRef(messageRevision);
  const refreshTimerRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pageStart, setPageStart] = useState(0);
  const presentedSkills = useMemo(() => presentThreadFindSkills(skills), [skills]);

  useEffect(() => {
    if (focusRequestId === 0) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequestId]);

  useEffect(() => {
    const onEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(ESCAPE_BLOCKING_LAYER_SELECTOR)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onEscapeKeyDown);
    return () => window.removeEventListener("keydown", onEscapeKeyDown);
  }, [onClose]);

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
              skills: presentedSkills,
            },
          }),
    [environmentId, pageStart, presentedSkills, settledQuery, threadId],
  );
  const result = useEnvironmentQuery(resultAtom);
  const data = result.data;

  useEffect(() => {
    refreshRef.current = result.refresh;
  }, [result.refresh]);

  useEffect(() => {
    if (messageRevisionRef.current === messageRevision) return;
    messageRevisionRef.current = messageRevision;
    if (settledQuery.length === 0) return;
    if (refreshTimerRef.current !== null) return;
    const elapsed = Date.now() - lastRefreshAtRef.current;
    refreshTimerRef.current = window.setTimeout(
      () => {
        refreshTimerRef.current = null;
        lastRefreshAtRef.current = Date.now();
        refreshRef.current();
      },
      Math.max(0, QUERY_DEBOUNCE_MS - elapsed),
    );
  }, [messageRevision, settledQuery]);

  useEffect(() => {
    if (settledQuery.length > 0 || refreshTimerRef.current === null) return;
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, [settledQuery]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (query.trim() !== settledQuery) {
      onRequest(null);
      return;
    }
    if (data === null) {
      onRequest(null);
      return;
    }
    if (data.total === 0) {
      onRequest(null);
      return;
    }
    const boundedIndex = Math.min(activeIndex, data.total - 1);
    const match = data.matches[boundedIndex - data.startIndex];
    if (!match) return;
    onRequest({
      key: threadFindTargetKey(settledQuery, match),
      query: settledQuery,
      match,
    });
  }, [activeIndex, data, onRequest, query, settledQuery]);

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
        if (event.nativeEvent.isComposing || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <InputGroup variant="ghost" className="h-7 min-w-0 flex-1 sm:w-56 sm:flex-none">
        <InputGroupAddon className="ps-1 pe-0">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          size="sm"
          ref={inputRef}
          type="search"
          maxLength={THREAD_FIND_QUERY_MAX_LENGTH}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(INITIAL_RESULT_INDEX);
            setPageStart(INITIAL_RESULT_INDEX);
            onRequest(null);
          }}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && event.key === "Enter") {
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
