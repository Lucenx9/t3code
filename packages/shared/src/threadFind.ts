import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type MarkdownNode = {
  readonly type: string;
  readonly value?: string;
  readonly children?: ReadonlyArray<MarkdownNode>;
};

const parser = unified().use(remarkParse).use(remarkGfm);
const BLOCK_NODE_TYPES = new Set([
  "blockquote",
  "code",
  "definition",
  "footnoteDefinition",
  "heading",
  "list",
  "listItem",
  "paragraph",
  "root",
  "table",
  "tableCell",
  "tableRow",
  "thematicBreak",
]);

const TRAILING_USER_CONTEXT =
  /\n*<(terminal_context|element_context|preview_annotation)>\n([\s\S]*?)\n<\/\1>\s*$/u;
const TERMINAL_CONTEXT_HEADER = /^(.*?)\s+line(?:s)?\s+(\d+)(?:-(\d+))?$/iu;

function formatTerminalContextLabel(header: string): string {
  const trimmed = header.trim();
  const match = TERMINAL_CONTEXT_HEADER.exec(trimmed);
  if (!match) return `@${trimmed.toLowerCase().replace(/\s+/gu, "-")}`;
  const terminal = (match[1] ?? "terminal").trim().toLowerCase().replace(/\s+/gu, "-");
  const start = match[2] ?? "";
  const end = match[3] ?? start;
  return `@${terminal}:${start}${end === start ? "" : `-${end}`}`;
}

function visibleContextSummary(kind: string, body: string): string {
  if (kind === "terminal_context") {
    return Array.from(body.matchAll(/^- (.+):$/gmu), (match) =>
      formatTerminalContextLabel(match[1] ?? ""),
    ).join("\n");
  }
  if (kind === "element_context") {
    return Array.from(body.matchAll(/^- (.+):$/gmu), (match) =>
      (match[1] ?? "").replaceAll("<", "&lt;"),
    ).join("\n");
  }
  const lines = body.split("\n");
  const visibleLines = lines
    .filter((line) => /^(?:Comment|Targets?):\s/u.test(line))
    .map((line) => line.replace(/^[^:]+:\s*/u, ""));
  const styleHeadingIndex = lines.indexOf("Requested visual changes:");
  if (styleHeadingIndex >= 0) {
    const firstStyleLine = styleHeadingIndex + 1;
    const elementContextOffset = lines
      .slice(firstStyleLine)
      .findIndex((line) => line === "<element_context>");
    const styleLines = lines
      .slice(
        firstStyleLine,
        elementContextOffset < 0 ? undefined : firstStyleLine + elementContextOffset,
      )
      .filter((line) => line.startsWith("- "));
    if (styleLines.length > 0) visibleLines.push(String(styleLines.length));
  }
  return visibleLines.join("\n");
}

/** Mirrors the transcript's removal/condensing of composer-only context blocks. */
export function threadFindMessageMarkdown(role: "user" | "assistant", text: string): string {
  if (role === "assistant") return text;
  let prompt = text;
  const summaries: Array<{ readonly kind: string; readonly text: string }> = [];
  while (true) {
    const match = TRAILING_USER_CONTEXT.exec(prompt);
    if (!match) break;
    const kind = match[1] ?? "";
    const summary = visibleContextSummary(kind, match[2] ?? "");
    if (summary.length > 0) summaries.unshift({ kind, text: summary });
    prompt = prompt.slice(0, match.index).replace(/\n+$/u, "");
  }
  // Review comments are rendered as cards. Their attributes are metadata, but
  // the comment and diff between the tags are visible transcript content.
  const withoutReviewTags = prompt.replace(/<\/?review_comment\b[^>]*>/giu, "");
  const terminalLabels = summaries
    .filter(({ kind }) => kind === "terminal_context")
    .flatMap(({ text: summary }) => summary.split("\n").filter(Boolean));
  let terminalSearchStart = 0;
  const hasEmbeddedTerminalLabels = terminalLabels.every((label) => {
    const index = withoutReviewTags.indexOf(label, terminalSearchStart);
    if (index < 0) return false;
    terminalSearchStart = index + label.length;
    return true;
  });
  const visibleSummaries = [
    ...summaries.filter(({ kind }) => kind === "preview_annotation"),
    ...summaries.filter(({ kind }) => kind === "element_context"),
    ...(hasEmbeddedTerminalLabels
      ? []
      : summaries.filter(({ kind }) => kind === "terminal_context")),
  ].map(({ text: summary }) => summary);
  return [...visibleSummaries, withoutReviewTags].filter((part) => part.length > 0).join("\n\n");
}

function appendMarkdownText(node: MarkdownNode, parts: string[]): void {
  const block = BLOCK_NODE_TYPES.has(node.type);
  if (block) parts.push("\n");

  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") {
    parts.push(node.value ?? "");
  } else if (node.type === "break") {
    parts.push("\n");
  } else if (node.type !== "image" && node.type !== "imageReference" && node.type !== "html") {
    for (const child of node.children ?? []) appendMarkdownText(child, parts);
  }

  if (block) parts.push("\n");
}

/** Text users can actually find in rendered message bodies, with layout whitespace collapsed. */
export function threadFindVisibleText(role: "user" | "assistant", text: string): string {
  const root = parser.parse(threadFindMessageMarkdown(role, text)) as MarkdownNode;
  const parts: string[] = [];
  appendMarkdownText(root, parts);
  return parts.join("").replace(/\s+/gu, " ").trim();
}

export function normalizeThreadFindQuery(query: string): string {
  return query.replace(/\s+/gu, " ").trim();
}

function compileThreadFindQuery(query: string): RegExp | null {
  const needle = normalizeThreadFindQuery(query);
  if (needle.length === 0) return null;
  return new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
}

export function findThreadFindOccurrence(
  text: string,
  query: string,
  occurrenceIndex: number,
): { readonly start: number; readonly end: number } | null {
  if (!Number.isSafeInteger(occurrenceIndex) || occurrenceIndex < 0) return null;
  const matcher = compileThreadFindQuery(query);
  if (!matcher) return null;
  let foundIndex = 0;
  for (const match of text.matchAll(matcher)) {
    if (foundIndex === occurrenceIndex) {
      const start = match.index;
      return { start, end: start + match[0].length };
    }
    foundIndex += 1;
  }
  return null;
}

/** Browser-find style, case-insensitive, non-overlapping occurrence count. */
export function countThreadFindOccurrences(text: string, query: string): number {
  const matcher = compileThreadFindQuery(query);
  if (!matcher) return 0;
  let count = 0;
  for (const _match of text.matchAll(matcher)) count += 1;
  return count;
}
