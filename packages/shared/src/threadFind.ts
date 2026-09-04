import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import {
  codexArtifactTemplatePresentationLabel,
  type CodexArtifactTemplate,
} from "./codexArtifactTemplates.ts";
import { remarkCodexDirectives } from "./codexMarkdownDirectives.ts";
import { formatWorkspaceRelativePath } from "./filePathDisplay.ts";
import {
  buildFileLinkParentSuffixByPath,
  fileBasename,
  inlineCodeFilePathCandidate,
  parseMarkdownFileLink,
  type FilePathPosition,
} from "./markdownLinks.ts";
import { remarkGithubAlerts } from "./markdownGithubAlerts.ts";

type ThreadFindHtmlNode = {
  readonly type: string;
  readonly value?: string;
  readonly tagName?: string;
  readonly children?: ReadonlyArray<ThreadFindHtmlNode>;
};

type ThreadFindMarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  data?: {
    codexArtifactTemplate?: CodexArtifactTemplate;
    hProperties?: Record<string, unknown>;
  };
  children?: ThreadFindMarkdownNode[];
};

type ThreadFindFileNode = {
  readonly node: ThreadFindMarkdownNode;
  readonly position: FilePathPosition;
  readonly path: string;
};

function threadFindFilePosition(node: ThreadFindMarkdownNode): FilePathPosition | null {
  if (node.type === "link") return node.url ? parseMarkdownFileLink(node.url) : null;
  if (node.type !== "inlineCode") return null;
  const candidate = inlineCodeFilePathCandidate(node.value ?? "");
  return candidate === null ? null : parseMarkdownFileLink(candidate);
}

function threadFindFileLabel(
  file: ThreadFindFileNode,
  suffixByPath: ReadonlyMap<string, string>,
): string {
  const parts = [fileBasename(file.position.path)];
  const parentSuffix = suffixByPath.get(file.path);
  if (parentSuffix) parts.push(parentSuffix);
  if (file.position.line) {
    parts.push(`L${file.position.line}${file.position.column ? `:C${file.position.column}` : ""}`);
  }
  return parts.join(" · ");
}

function remarkThreadFindPresentation() {
  return (tree: unknown) => {
    const fileNodes: ThreadFindFileNode[] = [];
    const visit = (node: ThreadFindMarkdownNode) => {
      const template = node.data?.codexArtifactTemplate;
      if (template) {
        node.children = [
          {
            type: "text",
            value: `${template.displayName} ${codexArtifactTemplatePresentationLabel(template.artifactKind)}`,
          },
        ];
        delete node.data;
      }

      const alertKind = node.data?.hProperties?.dataAlert;
      if (node.type === "blockquote" && typeof alertKind === "string") {
        const label = `${alertKind.slice(0, 1).toUpperCase()}${alertKind.slice(1).toLowerCase()}`;
        node.children = [
          { type: "paragraph", children: [{ type: "text", value: label }] },
          ...(node.children ?? []),
        ];
      }

      const position = threadFindFilePosition(node);
      if (position) {
        fileNodes.push({
          node,
          position,
          path: position.path.replaceAll("\\", "/"),
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree as ThreadFindMarkdownNode);

    const suffixByPath = buildFileLinkParentSuffixByPath(fileNodes.map(({ path }) => path));
    for (const file of fileNodes) {
      const label = threadFindFileLabel(file, suffixByPath);
      if (file.node.type === "link") {
        file.node.children = [{ type: "text", value: label }];
      } else {
        file.node.value = label;
      }
    }
  };
}

function createThreadFindParser(parseRawHtml: boolean) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkGithubAlerts)
    .use(remarkCodexDirectives)
    .use(remarkThreadFindPresentation)
    .use(remarkRehype, { allowDangerousHtml: true });
  if (parseRawHtml) processor.use(rehypeRaw).use(rehypeSanitize);
  return processor.freeze();
}

const userParser = createThreadFindParser(false);
const assistantParser = createThreadFindParser(true);
const BLOCK_TAG_NAMES = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "paragraph",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

const TRAILING_USER_CONTEXT =
  /\n*<(terminal_context|element_context|preview_annotation)>\n([\s\S]*?)\n<\/\1>\s*$/u;
const TERMINAL_CONTEXT_HEADER = /^(.*?)\s+line(?:s)?\s+(\d+)(?:-(\d+))?$/iu;
const REVIEW_COMMENT_BLOCK_PATTERN = /<review_comment\b([^>]*)>\s*([\s\S]*?)<\/review_comment>/giu;
const REVIEW_COMMENT_ATTRIBUTE_PATTERN = /([a-zA-Z][a-zA-Z0-9_-]*)="([^"]*)"/gu;
const REVIEW_COMMENT_FENCE_PATTERN = /(`{3,})([^\s`]*)[^\n]*\n([\s\S]*?)\n\1/gu;
const MARKDOWN_ESCAPABLE_CHARACTERS = new Set("\\!\"#$%&'()*+,-./:;<=>?@[]^_`{|}~".split(""));

export interface ThreadFindMessageOptions {
  readonly workspaceRoot?: string | undefined;
}

function unescapeReviewCommentAttribute(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&");
}

function readReviewCommentAttributes(rawAttributes: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of rawAttributes.matchAll(REVIEW_COMMENT_ATTRIBUTE_PATTERN)) {
    const name = match[1];
    if (name) attributes[name] = unescapeReviewCommentAttribute(match[2] ?? "");
  }
  return attributes;
}

function readNonNegativeInteger(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/u.test(value) ? Number(value) : null;
}

function markdownPlainText(value: string): string {
  return Array.from(value, (character) =>
    MARKDOWN_ESCAPABLE_CHARACTERS.has(character) ? `\\${character}` : character,
  ).join("");
}

function fencedReviewCommentText(language: string, contents: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(contents.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [`${fence}${language}`, contents.trimEnd(), fence].join("\n");
}

function projectReviewCommentCards(prompt: string, workspaceRoot?: string): string {
  return prompt.replace(
    REVIEW_COMMENT_BLOCK_PATTERN,
    (source, rawAttributes: string, rawBody: string) => {
      const attributes = readReviewCommentAttributes(rawAttributes);
      const filePath = attributes.filePath?.trim();
      const sectionId = attributes.sectionId?.trim();
      const startIndex = readNonNegativeInteger(attributes.startIndex);
      const endIndex = readNonNegativeInteger(attributes.endIndex);
      if (!filePath || !sectionId || startIndex === null || endIndex === null) return source;

      const fenceMatches = Array.from(rawBody.matchAll(REVIEW_COMMENT_FENCE_PATTERN));
      const fenceMatch = fenceMatches.at(-1);
      const fenceIndex = fenceMatch?.index;
      const comment = rawBody.slice(0, fenceIndex ?? rawBody.length).trim();
      const language = fenceMatch?.[2]?.trim() || "diff";
      const contents = fenceMatch?.[3] ?? "";
      const path = formatWorkspaceRelativePath(filePath, workspaceRoot);
      const heading = `${attributes.sectionTitle?.trim() || "Review"} · ${
        attributes.rangeLabel?.trim() || "line"
      }`;
      return [
        markdownPlainText(path),
        markdownPlainText(heading),
        ...(comment.length > 0 ? [markdownPlainText(comment)] : []),
        ...(contents.trim().length > 0 ? [fencedReviewCommentText(language, contents)] : []),
      ].join("\n\n");
    },
  );
}

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
export function threadFindMessageMarkdown(
  role: "user" | "assistant",
  text: string,
  options: ThreadFindMessageOptions = {},
): string {
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
  const visiblePrompt = projectReviewCommentCards(prompt, options.workspaceRoot);
  const terminalLabels = summaries
    .filter(({ kind }) => kind === "terminal_context")
    .flatMap(({ text: summary }) => summary.split("\n").filter(Boolean));
  let terminalSearchStart = 0;
  const hasEmbeddedTerminalLabels = terminalLabels.every((label) => {
    const index = visiblePrompt.indexOf(label, terminalSearchStart);
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
  return [...visibleSummaries, visiblePrompt].filter((part) => part.length > 0).join("\n\n");
}

function appendHtmlText(node: ThreadFindHtmlNode, parts: string[]): void {
  const block = node.type === "root" || BLOCK_TAG_NAMES.has(node.tagName ?? "");
  if (block) parts.push("\n");

  if (node.type === "text" || node.type === "raw") {
    parts.push(node.value ?? "");
  } else if (node.tagName === "br") {
    parts.push("\n");
  } else {
    for (const child of node.children ?? []) appendHtmlText(child, parts);
  }

  if (block) parts.push("\n");
}

/** Text users can actually find in rendered message bodies, with layout whitespace collapsed. */
export function threadFindVisibleText(
  role: "user" | "assistant",
  text: string,
  options: ThreadFindMessageOptions = {},
): string {
  const markdown = threadFindMessageMarkdown(role, text, options);
  const parser = role === "user" ? userParser : assistantParser;
  const markdownRoot = parser.parse(markdown);
  const root = parser.runSync(markdownRoot, { value: markdown }) as ThreadFindHtmlNode;
  const parts: string[] = [];
  appendHtmlText(root, parts);
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
