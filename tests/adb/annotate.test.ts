import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependency modules before importing the module under test
vi.mock("../../src/adb/screenshot.js", () => ({
  takeScreenshot: vi.fn(),
}));

vi.mock("../../src/adb/ui-tree.js", () => ({
  dumpUiTree: vi.fn(),
}));

import { takeScreenshot } from "../../src/adb/screenshot.js";
import { dumpUiTree } from "../../src/adb/ui-tree.js";
import {
  annotatedScreenshot,
  generateAnnotationSvg,
  type AnnotatedElement,
} from "../../src/adb/annotate.js";
import type { ScreenshotResult, UITreeResult, UIElement } from "../../src/adb/types.js";

const mockTakeScreenshot = vi.mocked(takeScreenshot);
const mockDumpUiTree = vi.mocked(dumpUiTree);

/** Helper to build a UIElement with sensible defaults. */
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

function makeScreenshot(overrides: Partial<ScreenshotResult> = {}): ScreenshotResult {
  return {
    path: "/tmp/screen.png",
    width: 1440,
    height: 2960,
    ...overrides,
  };
}

function makeUiTree(overrides: Partial<UITreeResult> = {}): UITreeResult {
  return {
    elements: [],
    interactive: [],
    rawXml: "<hierarchy></hierarchy>",
    xmlPath: "/tmp/ui.xml",
    foregroundPackage: "com.example.app",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── annotatedScreenshot ────────────────────────────────────────────

describe("annotatedScreenshot()", () => {
  it("returns annotated elements numbered sequentially from interactive elements", async () => {
    const btn = makeElement({
      text: "Login",
      className: "android.widget.Button",
      clickable: true,
      center: { x: 200, y: 400 },
      bounds: { left: 100, top: 350, right: 300, bottom: 450 },
      resourceId: "com.example:id/login_btn",
    });
    const field = makeElement({
      text: "",
      contentDesc: "Username",
      className: "android.widget.EditText",
      clickable: true,
      focusable: true,
      center: { x: 200, y: 200 },
      bounds: { left: 50, top: 150, right: 350, bottom: 250 },
      resourceId: "com.example:id/username",
    });

    mockTakeScreenshot.mockResolvedValue(makeScreenshot());
    mockDumpUiTree.mockResolvedValue(
      makeUiTree({ interactive: [btn, field], elements: [btn, field] }),
    );

    const result = await annotatedScreenshot();

    expect(result.count).toBe(2);
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0].label).toBe(0);
    expect(result.elements[0].displayText).toBe("Login");
    expect(result.elements[0].type).toBe("Button");
    expect(result.elements[1].label).toBe(1);
    expect(result.elements[1].displayText).toBe("Username"); // falls back to contentDesc
    expect(result.elements[1].type).toBe("EditText");
  });

  it("filters to interactive elements by default", async () => {
    const interactive = makeElement({ text: "OK", clickable: true });
    const nonInteractive = makeElement({ text: "Label", className: "android.widget.TextView" });

    mockTakeScreenshot.mockResolvedValue(makeScreenshot());
    mockDumpUiTree.mockResolvedValue(
      makeUiTree({
        interactive: [interactive],
        elements: [interactive, nonInteractive],
      }),
    );

    const result = await annotatedScreenshot();
    expect(result.count).toBe(1);
    expect(result.elements[0].displayText).toBe("OK");
  });

  it("includes all elements when allElements option is true", async () => {
    const interactive = makeElement({ text: "OK", clickable: true });
    const nonInteractive = makeElement({ text: "Label" });

    mockTakeScreenshot.mockResolvedValue(makeScreenshot());
    mockDumpUiTree.mockResolvedValue(
      makeUiTree({
        interactive: [interactive],
        elements: [interactive, nonInteractive],
      }),
    );

    const result = await annotatedScreenshot({ allElements: true });
    expect(result.count).toBe(2);
  });

  it("includes base64 when requested", async () => {
    mockTakeScreenshot.mockResolvedValue(
      makeScreenshot({ base64: "AAAA" }),
    );
    mockDumpUiTree.mockResolvedValue(makeUiTree({ interactive: [] }));

    const result = await annotatedScreenshot({ includeBase64: true });
    expect(result.screenshotBase64).toBe("AAAA");
    // Verify that includeBase64 was forwarded to takeScreenshot
    expect(mockTakeScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ includeBase64: true }),
    );
  });

  it("handles empty UI tree (no elements)", async () => {
    mockTakeScreenshot.mockResolvedValue(makeScreenshot());
    mockDumpUiTree.mockResolvedValue(makeUiTree({ interactive: [], elements: [] }));

    const result = await annotatedScreenshot();

    expect(result.count).toBe(0);
    expect(result.elements).toEqual([]);
    expect(result.textIndex).toContain("Interactive elements: 0");
    expect(result.foregroundPackage).toBe("com.example.app");
  });

  it("produces correct text index format", async () => {
    const btn = makeElement({
      text: "Submit",
      className: "android.widget.Button",
      clickable: true,
      center: { x: 300, y: 600 },
    });
    const scroll = makeElement({
      text: "List",
      className: "android.widget.ListView",
      scrollable: true,
      clickable: false,
      center: { x: 400, y: 1000 },
    });

    mockTakeScreenshot.mockResolvedValue(makeScreenshot());
    mockDumpUiTree.mockResolvedValue(
      makeUiTree({
        interactive: [btn, scroll],
        foregroundPackage: "com.example.testapp",
      }),
    );

    const result = await annotatedScreenshot();

    expect(result.textIndex).toContain("Screen: com.example.testapp");
    expect(result.textIndex).toContain("Interactive elements: 2");
    expect(result.textIndex).toContain('[0] Button: "Submit" → tap(300, 600)');
    expect(result.textIndex).toContain('[1] ListView: "List" → tap(400, 1000) [scrollable]');
  });

  it("falls back display text through text > contentDesc > resourceId > className", async () => {
    const withText = makeElement({ text: "Hello" });
    const withDesc = makeElement({ contentDesc: "World" });
    const withResId = makeElement({ resourceId: "com.example:id/my_btn" });
    const withClass = makeElement({ className: "android.widget.ImageView" });

    mockTakeScreenshot.mockResolvedValue(makeScreenshot());
    mockDumpUiTree.mockResolvedValue(
      makeUiTree({ interactive: [withText, withDesc, withResId, withClass] }),
    );

    const result = await annotatedScreenshot();
    expect(result.elements[0].displayText).toBe("Hello");
    expect(result.elements[1].displayText).toBe("World");
    expect(result.elements[2].displayText).toBe("my_btn");
    expect(result.elements[3].displayText).toBe("ImageView");
  });

  it("returns screenshot and XML paths", async () => {
    mockTakeScreenshot.mockResolvedValue(makeScreenshot({ path: "/tmp/shot.png" }));
    mockDumpUiTree.mockResolvedValue(makeUiTree({ xmlPath: "/tmp/dump.xml", interactive: [] }));

    const result = await annotatedScreenshot();
    expect(result.screenshotPath).toBe("/tmp/shot.png");
    expect(result.xmlPath).toBe("/tmp/dump.xml");
  });

  it("marks focusable-only elements in text index", async () => {
    const focusableOnly = makeElement({
      text: "Input",
      className: "android.widget.EditText",
      clickable: false,
      scrollable: false,
      focusable: true,
      center: { x: 100, y: 200 },
    });

    mockTakeScreenshot.mockResolvedValue(makeScreenshot());
    mockDumpUiTree.mockResolvedValue(makeUiTree({ interactive: [focusableOnly] }));

    const result = await annotatedScreenshot();
    expect(result.textIndex).toContain("[focusable]");
  });
});

// ── generateAnnotationSvg ──────────────────────────────────────────

describe("generateAnnotationSvg()", () => {
  it("generates valid SVG with correct dimensions", () => {
    const svg = generateAnnotationSvg([], 1440, 2960);
    expect(svg).toContain('width="1440"');
    expect(svg).toContain('height="2960"');
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("creates rect and label for each element", () => {
    const elements: AnnotatedElement[] = [
      {
        label: 0,
        displayText: "OK",
        type: "Button",
        center: { x: 200, y: 400 },
        bounds: { left: 100, top: 350, right: 300, bottom: 450 },
        clickable: true,
        scrollable: false,
        resourceId: "com.example:id/ok",
      },
    ];

    const svg = generateAnnotationSvg(elements, 1440, 2960);

    // Should have a rect at the bounds
    expect(svg).toContain('x="100"');
    expect(svg).toContain('y="350"');
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="100"');
    // Should have a circle at center
    expect(svg).toContain('cx="200"');
    expect(svg).toContain('cy="400"');
    // Should have label text
    expect(svg).toContain(">0</text>");
  });

  it("generates empty SVG body for no elements", () => {
    const svg = generateAnnotationSvg([], 800, 600);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    // Only the svg open/close tags, no rects
    expect(svg).not.toContain("<rect");
  });

  it("assigns different hues to different elements", () => {
    const elements: AnnotatedElement[] = [
      {
        label: 0, displayText: "A", type: "Button",
        center: { x: 50, y: 50 }, bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        clickable: true, scrollable: false, resourceId: "",
      },
      {
        label: 1, displayText: "B", type: "Button",
        center: { x: 150, y: 150 }, bounds: { left: 100, top: 100, right: 200, bottom: 200 },
        clickable: true, scrollable: false, resourceId: "",
      },
    ];

    const svg = generateAnnotationSvg(elements, 400, 400);

    // Both elements should have label text
    expect(svg).toContain(">0</text>");
    expect(svg).toContain(">1</text>");
    // hue for label 0: (0*137)%360 = 0, hue for label 1: (1*137)%360 = 137
    expect(svg).toContain("hsl(0,");
    expect(svg).toContain("hsl(137,");
  });
});
