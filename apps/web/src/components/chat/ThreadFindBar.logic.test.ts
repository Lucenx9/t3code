import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@t3tools/contracts";

import {
  nextThreadFindIndex,
  presentThreadFindSkills,
  threadFindPageStart,
  threadFindTargetKey,
} from "./ThreadFindBar.logic";

describe("thread find navigation", () => {
  it("wraps in both directions", () => {
    expect(nextThreadFindIndex(2, 3, 1)).toBe(0);
    expect(nextThreadFindIndex(0, 3, -1)).toBe(2);
    expect(nextThreadFindIndex(0, 0, 1)).toBe(0);
  });

  it("opens a result window around the requested direction", () => {
    expect(threadFindPageStart(100, 1)).toBe(100);
    expect(threadFindPageStart(100, -1)).toBe(1);
  });

  it("identifies navigation by the selected locator, independent of result refreshes", () => {
    const locator = { messageId: MessageId.make("message-1"), occurrenceIndex: 2 };

    expect(threadFindTargetKey("needle", locator)).toBe(threadFindTargetKey("needle", locator));
    expect(threadFindTargetKey("needle", { ...locator, occurrenceIndex: 3 })).not.toBe(
      threadFindTargetKey("needle", locator),
    );
  });

  it("bounds provider metadata before sending a find request", () => {
    const skills = Array.from({ length: 502 }, (_, index) => ({
      name: `skill-${index}`,
      displayName: index === 0 ? `  ${"x".repeat(240)}  ` : `Skill ${index}`,
    }));
    skills[1] = { name: "y".repeat(201), displayName: "Skipped" };

    const presented = presentThreadFindSkills(skills);

    expect(presented).toHaveLength(500);
    expect(presented[0]).toEqual({ name: "skill-0", displayName: "x".repeat(200) });
    expect(presented.some((skill) => skill.name.length > 200)).toBe(false);
  });
});
