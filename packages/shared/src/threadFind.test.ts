import { describe, expect, it } from "vite-plus/test";

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
