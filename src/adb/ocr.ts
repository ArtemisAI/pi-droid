/**
 * OCR text extraction using Tesseract.
 *
 * Converts TSV OCR output into UIElement-compatible entries so OCR data can
 * be used as a fallback (or merged) in the same screen understanding pipeline.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { takeScreenshot } from "./screenshot.js";
import type { AdbExecOptions } from "./exec.js";
import type { Bounds, UIElement } from "./types.js";

const execAsync = promisify(execFile);
const DEFAULT_OCR_CONFIDENCE = 50;
const MISSING_TESSERACT_ERROR =
  "Tesseract is not installed. Install with: apt install tesseract-ocr";
let tesseractAvailable: boolean | null = null;

/** Non-throwing check for Tesseract availability. Result is cached after first call. */
export async function isTesseractAvailable(timeout = 30_000): Promise<boolean> {
  if (tesseractAvailable !== null) return tesseractAvailable;
  try {
    await execAsync("tesseract", ["--version"], { timeout });
    tesseractAvailable = true;
  } catch {
    tesseractAvailable = false;
  }
  return tesseractAvailable;
}

export interface OcrResult {
  source: "ocr";
  screenshotPath: string;
  confidenceThreshold: number;
  elements: UIElement[];
}

function parseNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTesseractTsv(tsv: string, confidenceThreshold: number): UIElement[] {
  const lines = tsv.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return [];

  const out: UIElement[] = [];
  let index = 0;

  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    if (cols.length < 12) continue;

    const level = Number.parseInt(cols[0], 10);
    if (level !== 5) continue;

    const left = Number.parseInt(cols[6], 10);
    const top = Number.parseInt(cols[7], 10);
    const width = Number.parseInt(cols[8], 10);
    const height = Number.parseInt(cols[9], 10);
    const confidence = parseNumber(cols[10]);
    const text = cols[11]?.trim() ?? "";

    if (!text || width <= 0 || height <= 0 || confidence < confidenceThreshold) {
      continue;
    }

    const bounds: Bounds = {
      left,
      top,
      right: left + width,
      bottom: top + height,
    };

    out.push({
      resourceId: "",
      text,
      contentDesc: text,
      className: "android.view.View",
      packageName: "ocr",
      bounds,
      center: {
        x: Math.round((bounds.left + bounds.right) / 2),
        y: Math.round((bounds.top + bounds.bottom) / 2),
      },
      clickable: false,
      focusable: true,
      scrollable: false,
      enabled: true,
      selected: false,
      checked: false,
      children: [],
      depth: 0,
      index: index++,
      source: "ocr",
      confidence,
    });
  }

  return out;
}

export async function runOcrOnImage(
  screenshotPath: string,
  options: { confidenceThreshold?: number; timeout?: number } = {},
): Promise<OcrResult> {
  const confidenceThreshold =
    options.confidenceThreshold ??
    Number.parseFloat(process.env.PI_DROID_OCR_CONFIDENCE ?? `${DEFAULT_OCR_CONFIDENCE}`);

  if (!await isTesseractAvailable(options.timeout ?? 30_000)) {
    throw new Error(MISSING_TESSERACT_ERROR);
  }

  const { stdout } = await execAsync(
    "tesseract",
    [screenshotPath, "stdout", "tsv"],
    { timeout: options.timeout ?? 30_000, maxBuffer: 20 * 1024 * 1024 },
  );

  return {
    source: "ocr",
    screenshotPath,
    confidenceThreshold,
    elements: parseTesseractTsv(stdout, confidenceThreshold),
  };
}

export async function runOcrOnCurrentScreen(
  options: AdbExecOptions & { confidenceThreshold?: number } = {},
): Promise<OcrResult> {
  const screenshot = await takeScreenshot(options);
  return runOcrOnImage(screenshot.path, {
    confidenceThreshold: options.confidenceThreshold,
    timeout: options.timeout,
  });
}
