import { describe, expect, it } from "vite-plus/test";

import { nextThreadFindIndex, threadFindPageStart } from "./ThreadFindBar.logic";

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
});
