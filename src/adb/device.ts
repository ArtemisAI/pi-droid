/**
 * Device — high-level abstraction over a connected Android device.
 *
 * Combines all ADB operations into a single stateful object that tracks
 * the device serial, screen dimensions, and provides convenience methods.
 */

import type { AdbExecOptions } from "./exec.js";
import { listDevices, getScreenSize, isDeviceReady } from "./exec.js";
import { tap, swipe, typeText, keyEvent, pressBack, pressHome, pressEnter, scrollDown, scrollUp } from "./input.js";
import { takeScreenshot, screenshotBase64 } from "./screenshot.js";
import { dumpUiTree, findElement, findElements, waitForElement, summarizeTree } from "./ui-tree.js";
import { launchApp, stopApp, getAppInfo, keepScreenOn, wakeScreen, isScreenOn } from "./app.js";
import type {
  DeviceInfo,
  ScreenSize,
  UIElement,
  ElementSelector,
  TapOptions,
  SwipeOptions,
  TypeOptions,
  WaitOptions,
  ScreenshotResult,
  UITreeResult,
  AppInfo,
} from "./types.js";

export class Device {
  readonly serial: string;
  private screenSize: ScreenSize | null = null;

  constructor(serial: string) {
    this.serial = serial;
  }

  private get opts(): AdbExecOptions {
    return { serial: this.serial };
  }

  /**
   * Connect to a device by serial, or auto-detect the first available.
   */
  static async connect(serial?: string): Promise<Device> {
    if (serial) {
      const ready = await isDeviceReady(serial);
      if (!ready) throw new Error(`Device ${serial} not ready`);
      return new Device(serial);
    }
    const devices = await listDevices();
    const available = devices.find((d) => d.state === "device");
    if (!available) throw new Error("No ADB devices found");
    return new Device(available.serial);
  }

  /**
   * List all connected devices.
   */
  static async listAll(): Promise<DeviceInfo[]> {
    return listDevices();
  }

  async getScreenSize(): Promise<ScreenSize> {
    if (!this.screenSize) {
      this.screenSize = await getScreenSize(this.opts);
    }
    return this.screenSize;
  }

  async isReady(): Promise<boolean> {
    return isDeviceReady(this.serial);
  }

  // --- Input ---

  async tap(x: number, y: number, options?: TapOptions): Promise<void> {
    await tap(x, y, { ...this.opts, ...options });
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, options?: SwipeOptions): Promise<void> {
    await swipe(x1, y1, x2, y2, { ...this.opts, ...options });
  }

  async typeText(text: string, options?: TypeOptions): Promise<void> {
    await typeText(text, { ...this.opts, ...options });
  }

  async keyEvent(keycode: string | number): Promise<void> {
    await keyEvent(keycode, this.opts);
  }

  async back(): Promise<void> {
    await pressBack(this.opts);
  }

  async home(): Promise<void> {
    await pressHome(this.opts);
  }

  async enter(): Promise<void> {
    await pressEnter(this.opts);
  }

  async scrollDown(): Promise<void> {
    const size = await this.getScreenSize();
    await scrollDown(size.width, size.height, this.opts);
  }

  async scrollUp(): Promise<void> {
    const size = await this.getScreenSize();
    await scrollUp(size.width, size.height, this.opts);
  }

  // --- Screenshot ---

  async screenshot(options?: { prefix?: string; includeBase64?: boolean }): Promise<ScreenshotResult> {
    return takeScreenshot({ ...this.opts, ...options });
  }

  async screenshotBase64(): Promise<string> {
    return screenshotBase64(this.opts);
  }

  // --- UI Tree ---

  async uiDump(): Promise<UITreeResult> {
    return dumpUiTree(this.opts);
  }

  async findElement(selector: ElementSelector): Promise<UIElement | null> {
    const tree = await dumpUiTree(this.opts);
    return findElement(tree.elements, selector);
  }

  async findElements(selector: ElementSelector): Promise<UIElement[]> {
    const tree = await dumpUiTree(this.opts);
    return findElements(tree.elements, selector);
  }

  async waitForElement(selector: ElementSelector, options?: WaitOptions): Promise<UIElement | null> {
    return waitForElement(selector, { ...this.opts, ...options });
  }

  /**
   * Get a text summary of the current screen (for LLM context).
   */
  async describeScreen(): Promise<string> {
    const tree = await dumpUiTree(this.opts);
    return summarizeTree(tree);
  }

  // --- Selector-based actions ---

  /**
   * Tap an element matching a selector. UI dumps first to get fresh coordinates.
   */
  async tapElement(selector: ElementSelector, options?: TapOptions): Promise<UIElement> {
    const tree = await dumpUiTree(this.opts);
    const el = findElement(tree.elements, selector);
    if (!el) throw new Error(`Element not found: ${JSON.stringify(selector)}`);
    await tap(el.center.x, el.center.y, { ...this.opts, ...options });
    return el;
  }

  /**
   * Wait for an element and tap it.
   */
  async waitAndTap(
    selector: ElementSelector,
    options?: WaitOptions & TapOptions,
  ): Promise<UIElement> {
    const el = await waitForElement(selector, { ...this.opts, ...options });
    if (!el) throw new Error(`Timed out waiting for element: ${JSON.stringify(selector)}`);
    await tap(el.center.x, el.center.y, { ...this.opts, ...options });
    return el;
  }

  /**
   * Type text into an element (taps it first to focus).
   */
  async typeInto(selector: ElementSelector, text: string, options?: TypeOptions): Promise<void> {
    await this.tapElement(selector);
    await new Promise((r) => setTimeout(r, 300)); // Wait for focus
    await typeText(text, { ...this.opts, ...options });
  }

  // --- App management ---

  async launchApp(packageName: string, activity?: string): Promise<void> {
    await launchApp(packageName, { ...this.opts, activity });
  }

  async stopApp(packageName: string): Promise<void> {
    await stopApp(packageName, this.opts);
  }

  async getAppInfo(packageName: string): Promise<AppInfo> {
    return getAppInfo(packageName, this.opts);
  }

  async keepScreenOn(): Promise<void> {
    await keepScreenOn(this.opts);
  }

  async wake(): Promise<void> {
    await wakeScreen(this.opts);
  }

  async isScreenOn(): Promise<boolean> {
    return isScreenOn(this.opts);
  }

  /**
   * Ensure the screen is on and awake.
   */
  async ensureAwake(): Promise<void> {
    const on = await this.isScreenOn();
    if (!on) await this.wake();
  }
}
