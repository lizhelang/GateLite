import { describe, expect, it } from "vitest";
import { diffText } from "../server/config-preview";

describe("diffText", () => {
  it("returns added and removed lines with nearby context", () => {
    const diff = diffText("a\nb\nc\n", "a\nb2\nc\nd\n");

    expect(diff).toContainEqual({ type: "removed", line: "b" });
    expect(diff).toContainEqual({ type: "added", line: "b2" });
    expect(diff).toContainEqual({ type: "added", line: "d" });
    expect(diff.some((line) => line.type === "context" && line.line === "a")).toBe(true);
  });

  it("returns an empty diff for identical text", () => {
    expect(diffText("same\n", "same\n")).toEqual([]);
  });
});
