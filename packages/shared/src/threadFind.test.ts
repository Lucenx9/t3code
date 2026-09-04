import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";

import { serializeAssistantCitation } from "./assistantCitations.ts";
import { reviewDiffVisibleText } from "./reviewDiffPresentation.ts";
import {
  countThreadFindOccurrences,
  findThreadFindOccurrence,
  threadFindMessageMarkdown,
  threadFindVisibleText,
} from "./threadFind.ts";

describe("threadFindVisibleText", () => {
  it("searches rendered markdown text instead of formatting syntax and link destinations", () => {
    expect(
      threadFindVisibleText(
        "assistant",
        "## Result\nUse **thread search** in [T3 Code](https://example.test/private-path).",
      ),
    ).toBe("Result Use thread search in T3 Code.");
  });

  it("collapses layout whitespace like the transcript DOM reader", () => {
    expect(threadFindVisibleText("assistant", "one\n\n- two\n- three")).toBe("one two three");
  });

  it("includes sanitized text rendered from raw HTML", () => {
    expect(threadFindVisibleText("assistant", "<div>deploy <strong>failed</strong></div>")).toBe(
      "deploy failed",
    );
    expect(threadFindVisibleText("assistant", "<script>hidden()</script><p>visible</p>")).toBe(
      "visible",
    );
  });

  it("projects chips inside raw assistant HTML like the rendered transcript", () => {
    expect(
      threadFindVisibleText(
        "assistant",
        '<p>Use $show-me and <a href="/workspace/src/a.ts">Open source</a>.</p>',
        {
          workspaceRoot: "/workspace",
          skills: [{ name: "show-me", displayName: "Show Me" }],
        },
      ),
    ).toBe("Use Show Me and a.ts.");
    expect(
      threadFindVisibleText(
        "assistant",
        '<a href="src/index.ts">first</a> <a href="test/index.ts">second</a>',
      ),
    ).toBe("index.ts index.ts");
  });

  it("keeps raw HTML literal in user messages", () => {
    expect(threadFindVisibleText("user", "<Widget>hello</Widget>")).toBe("<Widget>hello</Widget>");
  });

  it("projects local file links and inline paths as their rendered chip labels", () => {
    expect(
      threadFindVisibleText(
        "assistant",
        "[Open source](/workspace/src/main.ts) and `/workspace/src/worker.ts:12`",
      ),
    ).toBe("main.ts and worker.ts · L12");
    expect(
      threadFindVisibleText("assistant", "[first](src/alpha/main.ts) [second](src/beta/main.ts)"),
    ).toBe("main.ts · src/alpha main.ts · src/beta");
    expect(threadFindVisibleText("assistant", "[source](src/index.ts) and `test/index.ts`")).toBe(
      "index.ts · src and index.ts · test",
    );
  });

  it("projects Codex directives and GitHub alerts like the transcript", () => {
    const fileCitation = ':codex-file-citation{path="outputs/report.xlsx" purpose="output"}';
    const template =
      '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}';

    expect(threadFindVisibleText("assistant", `Created ${fileCitation}.\n\n${template}`)).toBe(
      "Created report.xlsx. Hello World Document template",
    );
    expect(threadFindVisibleText("assistant", "> [!NOTE]\n> Keep this visible.")).toBe(
      "Note Keep this visible.",
    );
  });

  it("projects assistant citations, known skill chips, and empty responses like the transcript", () => {
    const citation = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("message"),
      text: "Original quote",
      comment: "Please revise this quote",
      start: 0,
      end: 14,
      prefix: "",
      suffix: "",
    });

    expect(threadFindVisibleText("user", `Review ${citation}.`)).toBe(
      "Review Please revise this quote.",
    );
    expect(
      threadFindVisibleText("user", "Use $show-me but keep `$show-me` literal.", {
        skills: [{ name: "show-me", displayName: "Show Me" }],
      }),
    ).toBe("Use Show Me but keep $show-me literal.");
    expect(threadFindVisibleText("assistant", "")).toBe("(empty response)");
    expect(threadFindVisibleText("assistant", "", { streaming: true })).toBe("");
  });

  it("projects skill chips only where the transcript renders them", () => {
    const options = { skills: [{ name: "show-me", displayName: "Show Me" }] } as const;

    expect(
      threadFindVisibleText("assistant", "# $show-me\n\n| Tool |\n| --- |\n| $show-me |", options),
    ).toBe("$show-me Tool $show-me");
    expect(
      threadFindVisibleText("assistant", "Paragraph $show-me\n\n-       list $show-me", options),
    ).toBe("Paragraph Show Me list Show Me");
  });

  it("includes the visible metadata and body of review-comment cards", () => {
    const prompt = [
      "Before",
      '<review_comment sectionId="turn:2" sectionTitle="Turn 2" filePath="/workspace/src/app.ts" startIndex="3" endIndex="4" rangeLabel="+47 to +48">',
      "Please fix *this*.",
      "```Diff",
      "-old",
      "+new",
      "```",
      "</review_comment>",
      "After",
    ].join("\n");

    expect(threadFindVisibleText("user", prompt, { workspaceRoot: "/workspace" })).toBe(
      "Before workspace/src/app.ts Turn 2 · +47 to +48 Please fix *this*. old new After",
    );
  });

  it("reduces terminal payloads to their visible chip labels and retains element labels", () => {
    const prompt = [
      "Please fix the button",
      "",
      "<terminal_context>",
      "- Terminal lines 1-2:",
      "  private token",
      "</terminal_context>",
      "",
      "<element_context>",
      "- <SubmitButton> (Form.tsx:20):",
      "  selector: #submit",
      "</element_context>",
    ].join("\n");

    expect(threadFindMessageMarkdown("user", prompt)).toBe(
      "&lt;SubmitButton> (Form.tsx:20)\n\n@terminal:1-2\n\nPlease fix the button",
    );
    expect(threadFindVisibleText("user", prompt)).toBe(
      "<SubmitButton> (Form.tsx:20) @terminal:1-2 Please fix the button",
    );
  });

  it("does not duplicate terminal labels already embedded in the prompt", () => {
    const prompt = [
      "Check @terminal:3 before continuing",
      "",
      "<terminal_context>",
      "- Terminal line 3:",
      "  private output",
      "</terminal_context>",
    ].join("\n");

    expect(threadFindVisibleText("user", prompt)).toBe("Check @terminal:3 before continuing");
  });

  it("orders preview and element summaries like the user message bubble", () => {
    const prompt = [
      "Body text",
      "",
      "<element_context>",
      "- <Card> (Card.tsx:4):",
      "  selector: .card",
      "</element_context>",
      "",
      "<preview_annotation>",
      "Preview annotation:",
      "Id: preview-1",
      "Page: Dashboard",
      "Comment: Tighten spacing",
      "Targets: 1 selected element.",
      "Requested visual changes:",
      "- color: red → blue",
      "- padding: 4px → 8px",
      "</preview_annotation>",
    ].join("\n");

    expect(threadFindVisibleText("user", prompt)).toBe(
      "Tighten spacing 1 selected element. 2 <Card> (Card.tsx:4) Body text",
    );
  });

  it("keeps synthesized context-card text literal", () => {
    const prompt = [
      "Body text",
      "",
      "<preview_annotation>",
      "Preview annotation:",
      "Id: preview-1",
      "Page: Dashboard",
      "Comment: Use **$show-me** exactly",
      "Targets: [one](target) selected element.",
      "</preview_annotation>",
    ].join("\n");

    expect(
      threadFindVisibleText("user", prompt, {
        skills: [{ name: "show-me", displayName: "Show Me" }],
      }),
    ).toBe("Use **$show-me** exactly [one](target) selected element. Body text");
  });
});

describe("reviewDiffVisibleText", () => {
  it("projects only the code column rendered for unified hunks", () => {
    expect(
      reviewDiffVisibleText(
        [
          "diff --git a/src/app.ts b/src/app.ts",
          "index 123..456 100644",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1,2 +1,2 @@",
          "-old value",
          "+new value",
          " context",
          "\\ No newline at end of file",
        ].join("\n"),
      ),
    ).toBe("old value\nnew value\ncontext");
  });

  it("keeps code lines that resemble patch metadata inside a hunk", () => {
    expect(
      reviewDiffVisibleText(
        [
          "--- a/query.sql",
          "+++ b/query.sql",
          "@@ -1,2 +1,2 @@",
          "--- deleted SQL comment",
          "+++ added content",
        ].join("\n"),
      ),
    ).toBe("-- deleted SQL comment\n++ added content");
  });
});

describe("countThreadFindOccurrences", () => {
  it("counts case-insensitive, non-overlapping matches", () => {
    expect(countThreadFindOccurrences("Find find FIND", "find")).toBe(3);
    expect(countThreadFindOccurrences("aaaa", "aa")).toBe(2);
  });

  it("locates an occurrence with the same matching rules", () => {
    expect(findThreadFindOccurrence("Find find FIND", "find", 1)).toEqual({
      start: 5,
      end: 9,
    });
    expect(findThreadFindOccurrence("Find", "find", 1)).toBeNull();
  });

  it("returns offsets in the original text when Unicode case folding changes length", () => {
    expect(findThreadFindOccurrence("İx", "x", 0)).toEqual({ start: 1, end: 2 });
  });

  it("treats regex syntax in the query as literal text", () => {
    expect(countThreadFindOccurrences("a.b A.B", "a.b")).toBe(2);
  });
});
