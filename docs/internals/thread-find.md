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
and zero-based occurrence within that message. Response size therefore stays bounded even when a
short query occurs thousands of times.

The projection query reads only settled user messages and canonical final assistant messages for
the selected thread. [`threadFind.ts`][text] converts Markdown to rendered text, condenses
composer-only context blocks, collapses layout whitespace, and counts case-insensitive,
non-overlapping matches. No index or backfill is required. If profiling shows that parsing a single
large thread is material, a derived searchable-text projection can be added behind the same RPC.
Repeated queries reuse a 2,000-entry in-process LRU keyed by message revision; the bound prevents a
long-running remote server from retaining every message it has ever searched.

[`ThreadFindBar`][bar] owns the query, selected ordinal, bounded result window, and stale-revision
restart. [`useThreadFindTarget`][target] uses the existing adjacent history cursor until the selected
message is loaded, expands a folded turn, and pins one virtualized row. [`ThreadFindSource`][source]
resolves the same occurrence from the rendered DOM stream, scrolls only after Legend has measured
the row, and keeps one CSS Highlight active. Long user messages are temporarily expanded while
they own the selected result. Opening find suppresses citation positioning so the two navigation
systems never compete for the list.

[text]: ../../packages/shared/src/threadFind.ts
[bar]: ../../apps/web/src/components/chat/ThreadFindBar.tsx
[target]: ../../apps/web/src/components/chat/useThreadFindTarget.ts
[source]: ../../apps/web/src/components/chat/ThreadFindSource.tsx
