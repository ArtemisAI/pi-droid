/**
 * Automation helpers — higher-level composed operations built on
 * the low-level ADB primitives.
 *
 * These are convenience functions that combine multiple ADB calls
 * into common automation workflows.
 */

import { adbShell, getForegroundPackage, getScreenSize, type AdbExecOptions } from "./exec.js";
import { tap, typeText } from "./input.js";
import { launchApp, wakeScreen, isScreenOn } from "./app.js";
import { dumpUiTree, findElement, waitForElement } from "./ui-tree.js";
import { takeScreenshot } from "./screenshot.js";
import type { ElementSelector, UIElement, ScreenshotResult, StuckDetector, TaskBudget } from "./types.js";

type AutomationOptions = AdbExecOptions & { taskBudget?: TaskBudget };

function assertBudgetAndTick(options: AutomationOptions): void {
  const budget = options.taskBudget;
  if (!budget) return;
  if (budget.exceeded()) {
    throw new Error(`budget_exceeded: ${JSON.stringify(budget.report())}`);
  }
  budget.tick();
}

/**
 * Ensure the device is awake, unlocked (swipe-only), and showing the
 * home screen or the requested app. A common "get ready" preamble.
 */
export async function ensureReady(
  options: AutomationOptions & { packageName?: string } = {},
): Promise<{ wasAsleep: boolean; launched: boolean }> {
  const runOptions = options;
  let wasAsleep = false;
  let launched = false;

  // Wake screen if off
  const on = await isScreenOn(runOptions);
  if (!on) {
    assertBudgetAndTick(runOptions);
    await wakeScreen(runOptions);
    wasAsleep = true;
    // Swipe up to dismiss lock screen (common gesture)
    // Use dynamic coordinates based on actual screen size
    const size = await getScreenSize(runOptions);
    const cx = Math.round(size.width / 2);
    const fromY = Math.round(size.height * 0.75);
    const toY = Math.round(size.height * 0.33);
    assertBudgetAndTick(runOptions);
    await adbShell(`input swipe ${cx} ${fromY} ${cx} ${toY} 300`, runOptions);
    // Wait a beat for the home screen
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Launch target app if specified and not already in foreground
  if (options.packageName) {
    const fg = await getForegroundPackage(runOptions);
    if (fg !== options.packageName) {
      assertBudgetAndTick(runOptions);
      await launchApp(options.packageName, runOptions);
      launched = true;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return { wasAsleep, launched };
}

/**
 * Take a screenshot and dump UI tree in parallel, returning both.
 * The fundamental "observe" operation for any automation loop.
 */
export async function observe(
  options: AdbExecOptions & { includeBase64?: boolean } = {},
): Promise<{
  screenshot: ScreenshotResult;
  foregroundPackage: string;
  interactiveElements: UIElement[];
  allElements: UIElement[];
}> {
  const [screenshot, tree, fg] = await Promise.all([
    takeScreenshot({ ...options, includeBase64: options.includeBase64 }),
    dumpUiTree(options),
    getForegroundPackage(options),
  ]);

  return {
    screenshot,
    foregroundPackage: fg,
    interactiveElements: tree.interactive,
    allElements: tree.elements,
  };
}

/**
 * Find an element and tap it, with retry logic. Returns the element
 * that was tapped, or null if not found after retries.
 */
export async function findAndTap(
  selector: ElementSelector,
  options: AutomationOptions & { retries?: number; retryDelay?: number; stuckDetector?: StuckDetector } = {},
): Promise<UIElement | null> {
  const runOptions = options;
  const retries = options.retries ?? 3;
  const retryDelay = options.retryDelay ?? 500;
  const detector = options.stuckDetector;

  detector?.recordAction("findAndTap", { selector, retries, retryDelay });

  for (let i = 0; i <= retries; i++) {
    const tree = await dumpUiTree(runOptions);
    detector?.recordScreenState(tree.elements);
    if (detector?.isStuck().stuck) return null;

    const el = findElement(tree.elements, selector);
    if (el) {
      assertBudgetAndTick(runOptions);
      detector?.recordAction("tap", { x: el.center.x, y: el.center.y });
      await tap(el.center.x, el.center.y, runOptions);
      return el;
    }
    if (i < retries) {
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }
  return null;
}

/**
 * Wait for an element, tap it, then wait for a follow-up element.
 * Common pattern: tap a button → wait for the next screen to load.
 */
export async function tapAndWait(
  tapSelector: ElementSelector,
  waitSelector: ElementSelector,
  options: AutomationOptions & { tapTimeout?: number; waitTimeout?: number; stuckDetector?: StuckDetector } = {},
): Promise<{ tapped: UIElement; found: UIElement | null }> {
  const runOptions = options;
  const detector = options.stuckDetector;
  detector?.recordAction("tapAndWait", { tapSelector, waitSelector });
  if (detector?.isStuck().stuck) {
    throw new Error("Stuck detected before tapAndWait");
  }

  const tapped = await waitForElement(tapSelector, {
    ...runOptions,
    timeout: options.tapTimeout ?? 10000,
  });
  if (!tapped) throw new Error(`Element to tap not found: ${JSON.stringify(tapSelector)}`);

  assertBudgetAndTick(runOptions);
  detector?.recordAction("tap", { x: tapped.center.x, y: tapped.center.y });
  if (detector?.isStuck().stuck) {
    throw new Error("Stuck detected before tap");
  }
  await tap(tapped.center.x, tapped.center.y, runOptions);

  const found = await waitForElement(waitSelector, {
    ...runOptions,
    timeout: options.waitTimeout ?? 10000,
  });

  return { tapped, found };
}

/**
 * Type text into a field identified by selector.
 * Taps the field first, waits for keyboard, then types.
 */
export async function typeIntoField(
  selector: ElementSelector,
  text: string,
  options: AutomationOptions & { clearFirst?: boolean; stuckDetector?: StuckDetector } = {},
): Promise<UIElement> {
  const runOptions = options;
  const detector = options.stuckDetector;
  detector?.recordAction("typeIntoField", { selector, clearFirst: options.clearFirst === true });

  const tree = await dumpUiTree(runOptions);
  detector?.recordScreenState(tree.elements);
  const el = findElement(tree.elements, selector);
  if (!el) throw new Error(`Field not found: ${JSON.stringify(selector)}`);

  assertBudgetAndTick(runOptions);
  detector?.recordAction("tap", { x: el.center.x, y: el.center.y });
  await tap(el.center.x, el.center.y, runOptions);
  await new Promise((r) => setTimeout(r, 500)); // Wait for keyboard

  if (options.clearFirst) {
    // Select all + delete
    await adbShell("input keyevent KEYCODE_MOVE_HOME", runOptions);
    await adbShell("input keyevent --longpress $(printf 'KEYCODE_SHIFT_LEFT KEYCODE_MOVE_END')", runOptions);
    await adbShell("input keyevent KEYCODE_DEL", runOptions);
  }

  assertBudgetAndTick(runOptions);
  await typeText(text, runOptions);
  return el;
}

/**
 * Scroll until an element is found, or give up after maxScrolls.
 */
export async function scrollToFind(
  selector: ElementSelector,
  options: AutomationOptions & {
    direction?: "down" | "up";
    maxScrolls?: number;
    stuckDetector?: StuckDetector;
  } = {},
): Promise<UIElement | null> {
  const runOptions = options;
  const direction = options.direction ?? "down";
  const maxScrolls = options.maxScrolls ?? 10;
  const detector = options.stuckDetector;

  detector?.recordAction("scrollToFind", { selector, direction, maxScrolls });
  const { scrollDown, scrollUp } = await import("./input.js");
  const { getScreenSize } = await import("./exec.js");
  const size = await getScreenSize(runOptions);

  for (let i = 0; i < maxScrolls; i++) {
    const tree = await dumpUiTree(runOptions);
    detector?.recordScreenState(tree.elements);
    if (detector?.isStuck().stuck) return null;

    const el = findElement(tree.elements, selector);
    if (el) return el;

    if (direction === "down") {
      assertBudgetAndTick(runOptions);
      detector?.recordAction("scrollDown", { width: size.width, height: size.height });
      await scrollDown(size.width, size.height, runOptions);
    } else {
      assertBudgetAndTick(runOptions);
      detector?.recordAction("scrollUp", { width: size.width, height: size.height });
      await scrollUp(size.width, size.height, runOptions);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return null;
}
