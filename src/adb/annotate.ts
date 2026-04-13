/**
 * Annotated screenshots — overlay numbered element labels for LLM understanding.
 *
 * Takes a screenshot and UI dump in parallel, then generates:
 * 1. A text index mapping element numbers to their info
 * 2. Annotation data (coordinates + labels) that can be overlaid on the image
 *
 * Note: Actual image rendering is optional (requires canvas/sharp).
 * The text index alone is often sufficient for LLM understanding.
 */

import type { AdbExecOptions } from "./exec.js";
import { takeScreenshot } from "./screenshot.js";
import { dumpUiTree } from "./ui-tree.js";
import type { ScreenshotResult, UITreeResult, UIElement } from "./types.js";

export interface AnnotatedElement {
  /** Sequential label number */
  label: number;
  /** Element display text (text > contentDesc > resourceId > className) */
  displayText: string;
  /** Element type (last part of className) */
  type: string;
  /** Center coordinates */
  center: { x: number; y: number };
  /** Bounding box */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Interaction flags */
  clickable: boolean;
  scrollable: boolean;
  /** Raw resource ID */
  resourceId: string;
}

export interface AnnotatedScreenshot {
  /** Screenshot file path */
  screenshotPath: string;
  /** Screenshot as base64 (if requested) */
  screenshotBase64?: string;
  /** UI dump XML path */
  xmlPath: string;
  /** Foreground package */
  foregroundPackage: string;
  /** Annotated interactive elements */
  elements: AnnotatedElement[];
  /** Human-readable text index for LLM consumption */
  textIndex: string;
  /** Total interactive elements found */
  count: number;
}

function getDisplayText(el: UIElement): string {
  return (
    el.text ||
    el.contentDesc ||
    el.resourceId.split("/").pop() ||
    el.className.split(".").pop() ||
    "?"
  );
}

function getType(el: UIElement): string {
  return el.className.split(".").pop() ?? "View";
}

/**
 * Capture an annotated screenshot — screenshot + UI dump in parallel.
 *
 * Returns the screenshot, a numbered list of interactive elements,
 * and a text index the LLM can use to identify elements by number.
 */
export async function annotatedScreenshot(
  options: AdbExecOptions & { includeBase64?: boolean; allElements?: boolean } = {},
): Promise<AnnotatedScreenshot> {
  // Parallel capture: screenshot + UI dump at the same time
  const [screenshot, uiTree] = await Promise.all([
    takeScreenshot({ ...options, includeBase64: options.includeBase64 }),
    dumpUiTree(options),
  ]);

  // Filter to interactive elements unless allElements requested
  const sourceElements = options.allElements ? uiTree.elements : uiTree.interactive;

  // Build annotated elements
  const elements: AnnotatedElement[] = sourceElements.map((el, i) => ({
    label: i,
    displayText: getDisplayText(el),
    type: getType(el),
    center: el.center,
    bounds: el.bounds,
    clickable: el.clickable,
    scrollable: el.scrollable,
    resourceId: el.resourceId,
  }));

  // Generate text index for LLM
  const lines = elements.map((el) => {
    const flags: string[] = [];
    if (el.scrollable) flags.push("scrollable");
    if (!el.clickable && !el.scrollable) flags.push("focusable");
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    return `[${el.label}] ${el.type}: "${el.displayText}" → tap(${el.center.x}, ${el.center.y})${flagStr}`;
  });

  const textIndex = [
    `Screen: ${uiTree.foregroundPackage}`,
    `Interactive elements: ${elements.length}`,
    "",
    ...lines,
  ].join("\n");

  return {
    screenshotPath: screenshot.path,
    screenshotBase64: screenshot.base64,
    xmlPath: uiTree.xmlPath,
    foregroundPackage: uiTree.foregroundPackage,
    elements,
    textIndex,
    count: elements.length,
  };
}

/**
 * Generate annotation overlay data as SVG (can be composited on the screenshot).
 * Returns SVG string with numbered rectangles at element positions.
 */
export function generateAnnotationSvg(
  elements: AnnotatedElement[],
  width: number,
  height: number,
): string {
  const rects = elements.map((el) => {
    const { left, top, right, bottom } = el.bounds;
    const w = right - left;
    const h = bottom - top;
    // Random hue per element for visual distinction
    const hue = (el.label * 137) % 360;
    return [
      `<rect x="${left}" y="${top}" width="${w}" height="${h}" `,
      `fill="hsla(${hue}, 80%, 50%, 0.15)" stroke="hsl(${hue}, 80%, 50%)" stroke-width="3"/>`,
      `<circle cx="${el.center.x}" cy="${el.center.y}" r="18" fill="hsl(${hue}, 80%, 40%)" opacity="0.9"/>`,
      `<text x="${el.center.x}" y="${el.center.y + 6}" text-anchor="middle" `,
      `font-size="16" font-weight="bold" fill="white">${el.label}</text>`,
    ].join("");
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...rects,
    "</svg>",
  ].join("\n");
}
