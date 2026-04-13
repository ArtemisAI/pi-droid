import { describe, it, expect, vi } from "vitest";
import { DefaultStuckDetector } from "../../src/adb/stuck-detector.js";
import type { UIElement } from "../../src/adb/types.js";

function makeElement(overrides: Partial<UIElement> = {}): UIElement {
  return {
    resourceId: "",
    text: "",
    contentDesc: "",
    className: "android.widget.View",
    packageName: "com.example",
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    center: { x: 50, y: 50 },
    clickable: false,
    focusable: false,
    scrollable: false,
    enabled: true,
    selected: false,
    checked: false,
    children: [],
    depth: 0,
    index: 0,
    ...overrides,
  };
}

describe("DefaultStuckDetector", () => {
  it("flags screen_loop when the same fingerprint repeats", () => {
    const detector = new DefaultStuckDetector({ screenRepeatThreshold: 3 });
    const tree = [makeElement({ resourceId: "id/title", text: "Home" })];

    detector.recordScreenState(tree);
    detector.recordScreenState(tree);
    detector.recordScreenState(tree);

    expect(detector.isStuck()).toEqual({
      stuck: true,
      reason: "screen_loop",
      count: 3,
    });
  });

  it("flags action_loop when identical actions repeat", () => {
    const detector = new DefaultStuckDetector({ actionRepeatThreshold: 3 });

    detector.recordAction("android_tap", { x: 100, y: 200 });
    detector.recordAction("android_tap", { x: 100, y: 200 });
    detector.recordAction("android_tap", { x: 100, y: 200 });

    expect(detector.isStuck()).toEqual({
      stuck: true,
      reason: "action_loop",
      count: 3,
    });
  });

  it("emits a structured event via onStuck callback", () => {
    const onStuck = vi.fn();
    const detector = new DefaultStuckDetector({
      actionRepeatThreshold: 2,
      onStuck,
    });

    detector.recordAction("android_key", { key: "KEYCODE_BACK" });
    detector.recordAction("android_key", { key: "KEYCODE_BACK" });

    expect(onStuck).toHaveBeenCalledWith({
      reason: "action_loop",
      count: 2,
      action: {
        action: "android_key",
        params: { key: "KEYCODE_BACK" },
      },
    });
  });
});
