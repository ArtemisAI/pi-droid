/**
 * UI hierarchy dumping and parsing.
 *
 * Uses `uiautomator dump` to capture the UI tree, parses XML into
 * structured UIElement objects, and supports selector-based element finding.
 */

import { mkdir, readFile, readdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { adb, adbShell, getForegroundPackage, type AdbExecOptions } from "./exec.js";
import type { UIElement, UITreeResult, ElementSelector, Bounds } from "./types.js";
import { getCachedTree, setCachedTree } from "./cache.js";
import { runOcrOnCurrentScreen } from "./ocr.js";

const REMOTE_XML = "/sdcard/pi-droid-ui.xml";
let uiDumpDir = "/tmp/pi-droid/ui-dumps";

export function setUiDumpDir(dir: string): void {
  uiDumpDir = dir;
}

const DUMP_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Remove UI dump files older than 5 minutes to prevent disk fill.
 */
async function cleanOldDumps(): Promise<void> {
  try {
    if (!existsSync(uiDumpDir)) return;
    const files = await readdir(uiDumpDir);
    const now = Date.now();
    await Promise.all(
      files.map(async (f) => {
        const filePath = join(uiDumpDir, f);
        try {
          const s = await stat(filePath);
          if (now - s.mtimeMs > DUMP_MAX_AGE_MS) {
            await unlink(filePath);
          }
        } catch {
          // Ignore errors on individual files
        }
      }),
    );
  } catch {
    // Best-effort cleanup — don't fail the dump
  }
}

/**
 * Parse Android bounds string "[left,top][right,bottom]" into Bounds object.
 */
function parseBounds(boundsStr: string): Bounds {
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: parseInt(match[1]),
    top: parseInt(match[2]),
    right: parseInt(match[3]),
    bottom: parseInt(match[4]),
  };
}

/**
 * Decode standard XML entities in attribute values.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Attributes whose values should be XML-entity-decoded. */
const DECODED_ATTRS = new Set(["text", "content-desc", "resource-id"]);

/**
 * Extract attribute value from an XML node string.
 */
function attr(node: string, name: string): string {
  const match = node.match(new RegExp(`${name}="([^"]*)"`));
  const raw = match?.[1] ?? "";
  return DECODED_ATTRS.has(name) ? decodeXmlEntities(raw) : raw;
}

/**
 * Parse raw XML into UIElement array.
 * Uses regex parsing (no XML lib dependency) — works for uiautomator output.
 */
function parseXml(xml: string): UIElement[] {
  const elements: UIElement[] = [];
  let index = 0;

  // Simple approach: extract all <node> elements with their attributes
  const allNodes = xml.match(/<node\s[^>]+\/?>/g) ?? [];

  for (const nodeStr of allNodes) {
    const bounds = parseBounds(attr(nodeStr, "bounds"));
    const center = {
      x: Math.round((bounds.left + bounds.right) / 2),
      y: Math.round((bounds.top + bounds.bottom) / 2),
    };

    elements.push({
      resourceId: attr(nodeStr, "resource-id"),
      text: attr(nodeStr, "text"),
      contentDesc: attr(nodeStr, "content-desc"),
      className: attr(nodeStr, "class"),
      packageName: attr(nodeStr, "package"),
      bounds,
      center,
      clickable: attr(nodeStr, "clickable") === "true",
      focusable: attr(nodeStr, "focusable") === "true",
      scrollable: attr(nodeStr, "scrollable") === "true",
      enabled: attr(nodeStr, "enabled") === "true",
      selected: attr(nodeStr, "selected") === "true",
      checked: attr(nodeStr, "checked") === "true",
      children: [],
      depth: 0,
      index: index++,
      source: "uiautomator",
      confidence: 100,
    });
  }

  return elements;
}

/**
 * Filter elements that are interactive (clickable, focusable, or scrollable).
 */
function getInteractiveElements(elements: UIElement[]): UIElement[] {
  return elements.filter(
    (el) => el.enabled && (el.clickable || el.focusable || el.scrollable),
  );
}

function isMinimalUiDump(rawXml: string, elements: UIElement[], interactive: UIElement[]): boolean {
  if (!rawXml.includes("<node")) return true;
  if (elements.length <= 1) return true;
  if (interactive.length > 0) return false;
  const informative = elements.filter((el) => el.text || el.contentDesc || el.resourceId);
  return informative.length < 2;
}

function overlapRatio(a: Bounds, b: Bounds): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const overlap = width * height;
  if (overlap <= 0) return 0;
  const areaA = Math.max(1, (a.right - a.left) * (a.bottom - a.top));
  const areaB = Math.max(1, (b.right - b.left) * (b.bottom - b.top));
  return overlap / Math.min(areaA, areaB);
}

function mergeElements(uiElements: UIElement[], ocrElements: UIElement[]): UIElement[] {
  const merged = [...uiElements];
  for (const ocrEl of ocrElements) {
    const ocrText = ocrEl.text.trim().toLowerCase();
    const match = merged.find((uiEl) => {
      if (overlapRatio(uiEl.bounds, ocrEl.bounds) < 0.6) return false;
      if (!ocrText) return true;
      return uiEl.text.trim().toLowerCase() === ocrText || uiEl.contentDesc.trim().toLowerCase() === ocrText;
    });

    if (match) {
      if (!match.text && ocrEl.text) {
        match.text = ocrEl.text;
        match.contentDesc = match.contentDesc || ocrEl.text;
        match.source = "merged";
        match.confidence = ocrEl.confidence;
      }
      continue;
    }

    merged.push({
      ...ocrEl,
      index: merged.length,
      source: "ocr",
    });
  }
  return merged;
}

/**
 * Dump and parse the current UI hierarchy.
 * Uses cache if available and fresh (avoids redundant ~500ms dumps).
 */
export async function dumpUiTree(
  options: AdbExecOptions & { skipCache?: boolean; ocrConfidenceThreshold?: number; debug?: boolean } = {},
): Promise<UITreeResult> {
  // Check cache first
  if (!options.skipCache) {
    const cached = getCachedTree();
    if (cached) return cached;
  }

  if (!existsSync(uiDumpDir)) {
    await mkdir(uiDumpDir, { recursive: true });
  }

  // Remove stale dump files to prevent disk fill
  await cleanOldDumps();

  let rawXml = "";
  let localXml = "";
  let elements: UIElement[] = [];
  let interactive: UIElement[] = [];

  try {
    // Dump UI hierarchy on device
    await adbShell(`uiautomator dump ${REMOTE_XML}`, options);

    // Pull XML
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    localXml = join(uiDumpDir, `ui_${ts}.xml`);
    await adb(["pull", REMOTE_XML, localXml], options);

    // Read and parse
    rawXml = await readFile(localXml, "utf-8");
    elements = parseXml(rawXml);
    interactive = getInteractiveElements(elements);
  } catch (err) {
    if (options.debug) {
      console.warn("uiautomator dump failed, trying OCR fallback:", err);
    }
  }

  const foregroundPackage = await getForegroundPackage(options);

  const needsOcrFallback = elements.length === 0 || isMinimalUiDump(rawXml, elements, interactive);
  if (needsOcrFallback) {
    try {
      const ocrResult = await runOcrOnCurrentScreen({
        ...options,
        confidenceThreshold: options.ocrConfidenceThreshold,
      });
      const ocrElements = ocrResult.elements.map((el, i) => ({ ...el, index: i }));

      if (elements.length === 0) {
        const ocrOnly: UITreeResult = {
          elements: ocrElements,
          interactive: getInteractiveElements(ocrElements),
          rawXml,
          xmlPath: localXml,
          foregroundPackage,
          source: "ocr",
        };
        setCachedTree(ocrOnly);
        return ocrOnly;
      }

      const mergedElements = mergeElements(elements, ocrElements);
      const merged: UITreeResult = {
        elements: mergedElements,
        interactive: getInteractiveElements(mergedElements),
        rawXml,
        xmlPath: localXml,
        foregroundPackage,
        source: "merged",
      };
      setCachedTree(merged);
      return merged;
    } catch (ocrErr) {
      console.warn("OCR fallback skipped (Tesseract not available):", (ocrErr as Error).message);
    }
  }

  const result: UITreeResult = {
    elements,
    interactive,
    rawXml,
    xmlPath: localXml,
    foregroundPackage,
    source: "uiautomator",
  };
  setCachedTree(result);
  return result;
}

/**
 * Find elements matching a selector.
 */
export function findElements(elements: UIElement[], selector: ElementSelector): UIElement[] {
  let matches = elements.filter((el) => {
    if (selector.text && !el.text.includes(selector.text) && !el.contentDesc.includes(selector.text)) {
      return false;
    }
    if (selector.textExact && el.text !== selector.textExact) return false;
    if (selector.resourceId) {
      // Support short resource IDs (auto-expand with package)
      if (
        el.resourceId !== selector.resourceId &&
        !el.resourceId.endsWith(`/${selector.resourceId}`)
      ) {
        return false;
      }
    }
    if (selector.className && el.className !== selector.className) return false;
    if (selector.description && !el.contentDesc.includes(selector.description)) return false;
    if (selector.clickable !== undefined && el.clickable !== selector.clickable) return false;
    if (selector.scrollable !== undefined && el.scrollable !== selector.scrollable) return false;
    return true;
  });

  if (selector.index !== undefined && selector.index < matches.length) {
    matches = [matches[selector.index]];
  }

  return matches;
}

/**
 * Find a single element matching a selector, or null.
 */
export function findElement(elements: UIElement[], selector: ElementSelector): UIElement | null {
  const matches = findElements(elements, selector);
  return matches[0] ?? null;
}

/**
 * Wait for an element matching a selector to appear.
 */
export async function waitForElement(
  selector: ElementSelector,
  options: AdbExecOptions & { timeout?: number; interval?: number } = {},
): Promise<UIElement | null> {
  const timeout = options.timeout ?? 10_000;
  const interval = options.interval ?? 500;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const tree = await dumpUiTree(options);
    const el = findElement(tree.elements, selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, interval));
  }

  return null;
}

/**
 * Get a text summary of interactive elements (for LLM context).
 */
export function summarizeTree(tree: UITreeResult): string {
  const lines = tree.interactive.map((el, i) => {
    const label = el.text || el.contentDesc || el.resourceId.split("/").pop() || el.className.split(".").pop();
    const type = el.className.split(".").pop() ?? "View";
    return `[${i}] ${type}: "${label}" at (${el.center.x}, ${el.center.y})${el.scrollable ? " [scrollable]" : ""}`;
  });
  return `Package: ${tree.foregroundPackage}\nElements (${tree.interactive.length}):\n${lines.join("\n")}`;
}
