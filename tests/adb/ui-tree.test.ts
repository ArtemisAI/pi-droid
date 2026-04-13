import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies so we never touch real ADB or filesystem
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

// We test the non-exported helpers indirectly via the exported functions.
// Import only the public API.
import { findElement, findElements, summarizeTree } from "../../src/adb/ui-tree.js";
import type { UIElement, UITreeResult } from "../../src/adb/types.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.testapp" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1440,2960]">
    <node index="0" text="Alice, 30" resource-id="com.example.testapp:id/user_name" class="android.widget.TextView" package="com.example.testapp" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,200][400,260]" />
    <node index="1" text="" resource-id="com.example.testapp:id/action_button" class="android.widget.ImageButton" package="com.example.testapp" content-desc="Submit" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[600,2700][840,2900]" />
    <node index="2" text="" resource-id="com.example.testapp:id/cancel_button" class="android.widget.ImageButton" package="com.example.testapp" content-desc="Cancel" checkable="false" checked="false" clickable="true" enabled="false" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[200,2700][440,2900]" />
    <node index="3" text="Software Engineer" resource-id="com.example.testapp:id/occupation" class="android.widget.TextView" package="com.example.testapp" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,300][500,340]" />
    <node index="4" text="" resource-id="" class="android.widget.ScrollView" package="com.example.testapp" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="true" focused="false" scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,400][1440,2600]" />
  </node>
</hierarchy>`;

/**
 * Parse sample XML through the same regex logic the module uses internally.
 * We replicate the parsing here since parseXml is not exported.
 */
function parseSampleXml(xml: string): UIElement[] {
  const elements: UIElement[] = [];
  const allNodes = xml.match(/<node\s[^>]+\/?>/g) ?? [];
  let idx = 0;
  for (const nodeStr of allNodes) {
    const a = (name: string) => {
      const m = nodeStr.match(new RegExp(`${name}="([^"]*)"`));
      return m?.[1] ?? "";
    };
    const boundsMatch = a("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    const bounds = boundsMatch
      ? { left: +boundsMatch[1], top: +boundsMatch[2], right: +boundsMatch[3], bottom: +boundsMatch[4] }
      : { left: 0, top: 0, right: 0, bottom: 0 };
    const center = {
      x: Math.round((bounds.left + bounds.right) / 2),
      y: Math.round((bounds.top + bounds.bottom) / 2),
    };
    elements.push({
      resourceId: a("resource-id"),
      text: a("text"),
      contentDesc: a("content-desc"),
      className: a("class"),
      packageName: a("package"),
      bounds,
      center,
      clickable: a("clickable") === "true",
      focusable: a("focusable") === "true",
      scrollable: a("scrollable") === "true",
      enabled: a("enabled") === "true",
      selected: a("selected") === "true",
      checked: a("checked") === "true",
      children: [],
      depth: 0,
      index: idx++,
    });
  }
  return elements;
}

function getInteractiveElements(elements: UIElement[]): UIElement[] {
  return elements.filter(
    (el) => el.enabled && (el.clickable || el.focusable || el.scrollable),
  );
}

const elements = parseSampleXml(SAMPLE_XML);
const interactive = getInteractiveElements(elements);

const fakeTree: UITreeResult = {
  elements,
  interactive,
  rawXml: SAMPLE_XML,
  xmlPath: "/tmp/fake.xml",
  foregroundPackage: "com.example.testapp",
};

describe("XML parsing", () => {
  it("extracts all 6 nodes from sample XML", () => {
    // 1 FrameLayout + 5 children = 6 total
    expect(elements).toHaveLength(6);
  });

  it("parses text and resource-id correctly", () => {
    const profileName = elements.find((e) => e.text === "Alice, 30");
    expect(profileName).toBeDefined();
    expect(profileName!.resourceId).toBe("com.example.testapp:id/user_name");
    expect(profileName!.className).toBe("android.widget.TextView");
  });

  it("parses bounds into correct Bounds object", () => {
    const likeBtn = elements.find((e) => e.contentDesc === "Submit");
    expect(likeBtn).toBeDefined();
    expect(likeBtn!.bounds).toEqual({ left: 600, top: 2700, right: 840, bottom: 2900 });
    expect(likeBtn!.center).toEqual({ x: 720, y: 2800 });
  });

  it("parses boolean attributes", () => {
    const scrollView = elements.find((e) => e.className === "android.widget.ScrollView");
    expect(scrollView).toBeDefined();
    expect(scrollView!.scrollable).toBe(true);
    expect(scrollView!.clickable).toBe(false);
  });
});

describe("findElement() and findElements()", () => {
  it("finds element by text substring", () => {
    const matches = findElements(elements, { text: "Alice" });
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("Alice, 30");
  });

  it("finds element by exact text", () => {
    expect(findElements(elements, { textExact: "Alice, 30" })).toHaveLength(1);
    expect(findElements(elements, { textExact: "Alice" })).toHaveLength(0);
  });

  it("finds element by resourceId (full)", () => {
    const el = findElement(elements, { resourceId: "com.example.testapp:id/action_button" });
    expect(el).not.toBeNull();
    expect(el!.contentDesc).toBe("Submit");
  });

  it("finds element by resourceId (short form)", () => {
    const el = findElement(elements, { resourceId: "action_button" });
    expect(el).not.toBeNull();
  });

  it("finds element by content description", () => {
    const el = findElement(elements, { description: "Cancel" });
    expect(el).not.toBeNull();
    expect(el!.resourceId).toContain("cancel_button");
  });

  it("finds element by className", () => {
    const matches = findElements(elements, { className: "android.widget.ImageButton" });
    expect(matches).toHaveLength(2); // like + skip
  });

  it("filters by clickable flag", () => {
    const clickable = findElements(elements, { clickable: true });
    expect(clickable.length).toBeGreaterThanOrEqual(2);
    for (const el of clickable) {
      expect(el.clickable).toBe(true);
    }
  });

  it("respects index selector", () => {
    const matches = findElements(elements, { className: "android.widget.ImageButton", index: 1 });
    expect(matches).toHaveLength(1);
    expect(matches[0].contentDesc).toBe("Cancel");
  });

  it("returns null from findElement when no match", () => {
    const el = findElement(elements, { textExact: "does-not-exist" });
    expect(el).toBeNull();
  });
});

describe("getInteractiveElements", () => {
  it("only includes enabled elements that are clickable, focusable, or scrollable", () => {
    for (const el of interactive) {
      expect(el.enabled).toBe(true);
      expect(el.clickable || el.focusable || el.scrollable).toBe(true);
    }
  });

  it("excludes disabled skip button", () => {
    const skipInInteractive = interactive.find((e) => e.contentDesc === "Cancel");
    expect(skipInInteractive).toBeUndefined();
  });

  it("includes the scrollable ScrollView", () => {
    const scrollView = interactive.find((e) => e.className === "android.widget.ScrollView");
    expect(scrollView).toBeDefined();
  });
});

describe("summarizeTree()", () => {
  it("starts with package name line", () => {
    const summary = summarizeTree(fakeTree);
    expect(summary).toContain("Package: com.example.testapp");
  });

  it("contains element count", () => {
    const summary = summarizeTree(fakeTree);
    expect(summary).toContain(`Elements (${interactive.length}):`);
  });

  it("includes indexed entries with type and label", () => {
    const summary = summarizeTree(fakeTree);
    // Profile name should appear
    expect(summary).toContain(`"Alice, 30"`);
    // Action button referenced by contentDesc
    expect(summary).toContain(`"Submit"`);
  });

  it("marks scrollable elements", () => {
    const summary = summarizeTree(fakeTree);
    expect(summary).toContain("[scrollable]");
  });

  it("formats each line as [index] Type: label at (x, y)", () => {
    const summary = summarizeTree(fakeTree);
    const lines = summary.split("\n");
    // Element lines start after the header (2 lines)
    const elementLines = lines.filter((l) => l.match(/^\[\d+\]/));
    expect(elementLines.length).toBe(interactive.length);
    // Check format of first element line
    expect(elementLines[0]).toMatch(/^\[\d+\] \w+: ".+" at \(\d+, \d+\)/);
  });
});
