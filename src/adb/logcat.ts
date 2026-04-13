/**
 * Logcat — capture, search, clear, and inspect Android device logs.
 *
 * Uses `adb logcat` in dump mode (non-blocking) for safe agent consumption.
 * All output is structured for machine-readable JSON pipelines.
 */

import { adb, type AdbExecOptions } from "./exec.js";

export interface CaptureLogcatOptions extends AdbExecOptions {
  /** Capture duration in ms (default: 5000) */
  duration?: number;
  /** Logcat filter spec, e.g. "ActivityManager:I" */
  filter?: string;
  /** Max lines to return (default: 200) */
  maxLines?: number;
  /** Clear logcat buffer before capturing (default: false) */
  clear?: boolean;
}

export interface CaptureLogcatResult {
  lines: string[];
  count: number;
  duration: number;
}

export interface SearchLogcatOptions extends AdbExecOptions {
  /** Number of recent log lines to search (default: 1000) */
  lines?: number;
}

export interface LogcatStats {
  main: string;
  system: string;
  crash: string;
}

/**
 * Capture logcat output for a duration.
 *
 * Optionally clears the buffer first, waits for the specified duration,
 * then dumps all accumulated logs via `adb logcat -d`.
 */
export async function captureLogcat(
  options: CaptureLogcatOptions = {},
): Promise<CaptureLogcatResult> {
  const duration = options.duration ?? 5000;
  const maxLines = options.maxLines ?? 200;

  if (options.clear) {
    await clearLogcat(options);
  }

  // Wait for the capture duration
  await new Promise((resolve) => setTimeout(resolve, duration));

  // Dump logs (non-blocking)
  const args: string[] = ["logcat", "-d"];
  if (options.filter) {
    args.push(options.filter, "*:S");
  }

  const output = await adb(args, options);

  const allLines = output
    .split("\n")
    .filter((l) => l.trim().length > 0);

  const lines = allLines.slice(-maxLines);

  return {
    lines,
    count: lines.length,
    duration,
  };
}

/**
 * Search recent logcat lines matching a regex pattern.
 *
 * Uses `adb logcat -t N -d` to grab the last N lines, then filters
 * client-side with the provided pattern.
 */
export async function searchLogcat(
  pattern: string,
  options: SearchLogcatOptions = {},
): Promise<string[]> {
  const lineCount = options.lines ?? 1000;

  const args: string[] = ["logcat", "-t", String(lineCount), "-d"];
  const output = await adb(args, options);

  const regex = new RegExp(pattern);
  return output
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .filter((l) => regex.test(l));
}

/**
 * Clear the logcat buffer on the device.
 */
export async function clearLogcat(options: AdbExecOptions = {}): Promise<void> {
  await adb(["logcat", "-c"], options);
}

/**
 * Get logcat buffer sizes (main, system, crash).
 *
 * Parses the output of `adb logcat -g`.
 */
export async function getLogcatStats(
  options: AdbExecOptions = {},
): Promise<LogcatStats> {
  const output = await adb(["logcat", "-g"], options);

  const getSize = (buffer: string): string => {
    const regex = new RegExp(`${buffer}:.*?([\\d.]+[KkMmGg]?[Bb]?\\S*)`, "i");
    const match = output.match(regex);
    return match ? match[1] : "unknown";
  };

  return {
    main: getSize("main"),
    system: getSize("system"),
    crash: getSize("crash"),
  };
}
