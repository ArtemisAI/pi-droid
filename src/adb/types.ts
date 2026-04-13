/**
 * Core types for ADB device interaction.
 */

export interface DeviceInfo {
  serial: string;
  model?: string;
  product?: string;
  transport?: "usb" | "wifi";
  state: "device" | "offline" | "unauthorized" | "no permissions";
}

export interface ScreenSize {
  width: number;
  height: number;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UIElement {
  /** Resource ID (e.g., "com.example:id/button") */
  resourceId: string;
  /** Display text */
  text: string;
  /** Content description (accessibility) */
  contentDesc: string;
  /** Android class name (e.g., "android.widget.Button") */
  className: string;
  /** Package name */
  packageName: string;
  /** Bounding box */
  bounds: Bounds;
  /** Center coordinates */
  center: { x: number; y: number };
  /** Interaction flags */
  clickable: boolean;
  focusable: boolean;
  scrollable: boolean;
  enabled: boolean;
  selected: boolean;
  checked: boolean;
  /** Child elements */
  children: UIElement[];
  /** Depth in tree */
  depth: number;
  /** Sequential index for reference */
  index: number;
  /** Source detector for this element */
  source?: "uiautomator" | "ocr" | "merged";
  /** OCR confidence (0-100), when available */
  confidence?: number;
}

export interface ElementSelector {
  /** Match by text content (substring) */
  text?: string;
  /** Match by exact text */
  textExact?: string;
  /** Match by resource ID (supports short form, auto-expanded) */
  resourceId?: string;
  /** Match by class name */
  className?: string;
  /** Match by content description (substring) */
  description?: string;
  /** Match by clickable state */
  clickable?: boolean;
  /** Match by scrollable state */
  scrollable?: boolean;
  /** If multiple matches, pick this index (0-based) */
  index?: number;
}

export interface TapOptions {
  /** Hold duration in ms (for long press) */
  duration?: number;
}

export interface SwipeOptions {
  /** Swipe duration in ms */
  duration?: number;
  /** Number of steps (affects smoothness) */
  steps?: number;
}

export interface TypeOptions {
  /** Clear existing text before typing */
  clear?: boolean;
  /** Use ADBKeyboard broadcast (required for Unicode) */
  useAdbKeyboard?: boolean;
}

export interface WaitOptions {
  /** Timeout in ms (default: 10000) */
  timeout?: number;
  /** Poll interval in ms (default: 500) */
  interval?: number;
}

export interface AppInfo {
  packageName: string;
  running: boolean;
  foreground: boolean;
}

export interface ScreenshotResult {
  /** Local file path */
  path: string;
  /** Base64-encoded image data */
  base64?: string;
  /** Image dimensions */
  width: number;
  height: number;
}

export interface UITreeResult {
  /** Parsed elements */
  elements: UIElement[];
  /** Interactive elements only */
  interactive: UIElement[];
  /** Raw XML content */
  rawXml: string;
  /** File path where XML was saved */
  xmlPath: string;
  /** Foreground package name */
  foregroundPackage: string;
  /** Primary source used to build this element list */
  source?: "uiautomator" | "ocr" | "merged";
}

export type StuckReason = "screen_loop" | "action_loop";

export interface StuckState {
  stuck: boolean;
  reason?: StuckReason;
  count: number;
}

export interface StuckEvent {
  reason: StuckReason;
  count: number;
  screenHash?: string;
  action?: {
    action: string;
    params: Record<string, unknown>;
  };
}

export interface StuckDetector {
  recordAction(action: string, params: Record<string, unknown>): void;
  recordScreenState(uiTree: UIElement[]): void;
  isStuck(): StuckState;
  reset(): void;
}

export interface BatteryInfo {
  /** Battery percentage (0-100) */
  level: number;
  /** Human-readable status (charging, discharging, full, etc.) */
  status: string;
  /** Whether the device is currently charging or full */
  charging: boolean;
  /** Battery temperature in °C */
  temperature: number;
}

export interface NetworkInfo {
  /** WiFi enabled and connected */
  wifi: boolean;
  /** Connected WiFi network name */
  wifiSsid?: string;
  /** Cellular data connected */
  cellular: boolean;
  /** Airplane mode enabled */
  airplaneMode: boolean;
}

export interface FullDeviceInfo {
  /** Device model (e.g., "SM-G960F") */
  model: string;
  /** Manufacturer (e.g., "samsung") */
  manufacturer: string;
  /** Android version string (e.g., "10") */
  androidVersion: string;
  /** SDK/API level (e.g., 29) */
  sdkVersion: number;
  /** Device serial number */
  serial: string;
}

export interface NotificationInfo {
  /** App package that posted the notification */
  packageName: string;
  /** Notification title */
  title: string;
  /** Notification body text */
  text: string;
  /** Timestamp when the notification was posted (ISO string or epoch ms) */
  time: string;
}

/** Key-value extras for Android intents. */
export type IntentExtras = Record<string, string>;

export interface TaskBudgetConfig {
  stepLimit?: number;
  timeLimitMs?: number;
}

export interface TaskBudgetReport {
  stepsUsed: number;
  stepLimit: number;
  timeElapsed: number;
  timeLimit: number;
}

export interface TaskBudget {
  steps: { used: number; limit: number };
  time: { startedAt: number; limitMs: number };
  exceeded(): boolean;
  tick(): void;
  report(): TaskBudgetReport;
}

// ── Gesture Macros ──────────────────────────────────────────────────

/** A single step in a gesture macro. */
export interface GestureStep {
  type: "tap" | "swipe" | "key" | "type" | "wait";
  /**
   * Parameters vary by step type:
   *  - tap:   { x, y, duration? }
   *  - swipe: { x1, y1, x2, y2, duration? }
   *  - key:   { keycode }
   *  - type:  { text }
   *  - wait:  { ms }
   */
  params: Record<string, unknown>;
}

/** A named, reusable sequence of gesture steps. */
export interface GestureMacro {
  name: string;
  description: string;
  steps: GestureStep[];
}

/** Options for macro execution. */
export interface MacroExecOptions {
  /** Default delay between steps in ms (default: 200). */
  stepDelay?: number;
  /** If true, log each step to stdout. */
  verbose?: boolean;
}
