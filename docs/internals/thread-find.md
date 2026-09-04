# In-thread find

In-thread find is a server-backed locator query with client-owned navigation. It searches one
durable thread without widening the normal thread snapshot or sending the entire history to the
client.

The server advertises `threadFind: 1` in `ServerConfig`. Web and desktop expose the command only
when that capability is present, so a newer client can connect to an older remote environment
without invoking an unknown RPC. Mobile does not expose the command yet; it can reuse the same
contract when its native keyboard and feed navigation are implemented.

`orchestration.findThread` accepts a thread ID, a one-to-200-character query, a result start index,
and a limit capped at 100. It returns the exact occurrence count, a deterministic revision, and a
bounded window of message locators. Each locator contains the message ID, optional turn ID, role,
zero-based occurrence within that message, and an opaque cursor for a bounded history page around
the target. Response size therefore stays bounded even when a short query occurs thousands of
times. Provider skill metadata is capped before crossing the wire, using the same limits as the
contract.

The projection query reads user messages and canonical assistant messages for the selected thread,
including the currently streaming assistant response. [`threadFind.ts`][text] converts Markdown to
rendered text, condenses composer-only context blocks, applies the active skill labels, collapses
layout whitespace, projects review diffs to their visible code column, and counts case-insensitive,
non-overlapping matches. No index or backfill is
required. If profiling shows that scanning a single large thread is material, a derived searchable-
text projection can be added behind the same RPC. A lightweight counter on the thread projection
advances when searchable message state can change. Repeated queries read that row directly, then
reuse complete derived projections plus the last query's counts while the revision is stable.
Cache hits also compare the canonical skill metadata, rather than trusting its compact revision
hash alone.
Unrelated thread activity does not invalidate the cache. The in-process LRU is bounded to four
threads and 16 million UTF-16 characters, so a thread larger than the cache limit does not displace
every other entry while a long-running remote server keeps a fixed memory ceiling.

[`ThreadFindBar`][bar] owns the query, selected ordinal, and bounded result window. While it is open,
the thread shell's searchable-message revision throttles refreshes to at most once per 120 ms, so
new and streaming text becomes searchable without reopening the bar or scheduling an unbounded
trailing debounce. [`useThreadFindTarget`][target] first requests the bounded page named by the
selected result. The client merges that non-adjacent window without consuming its normal “load
earlier” cursor. If the direct cursor has gone stale, navigation stops instead of downloading
unrelated adjacent history; the authoritative message revision refreshes the result set. It then
expands a folded turn and pins one virtualized row. [`ThreadFindSource`][source] temporarily expands
Markdown details, resolves the same occurrence from the rendered DOM stream, scrolls only after
Legend has measured the row, and keeps one CSS Highlight active. Long user messages are temporarily
expanded while they own the selected result. Opening find suppresses citation positioning so the
two navigation systems never compete for the list.

[text]: ../../packages/shared/src/threadFind.ts
[bar]: ../../apps/web/src/components/chat/ThreadFindBar.tsx
[target]: ../../apps/web/src/components/chat/useThreadFindTarget.ts
[source]: ../../apps/web/src/components/chat/ThreadFindSource.tsx
