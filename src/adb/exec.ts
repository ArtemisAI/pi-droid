/**
 * Low-level ADB command execution.
 *
 * Wraps child_process.execFile for ADB commands with proper error handling,
 * serial targeting, and timeout management.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceInfo, ScreenSize } from "./types.js";

const execAsync = promisify(execFile);

export class AdbError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "AdbError";
  }
}

export interface AdbExecOptions {
  /** Device serial to target */
  serial?: string;
  /** Command timeout in ms (default: 30000) */
  timeout?: number;
  /** Max stdout buffer size in bytes (default: 10MB) */
  maxBuffer?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Execute an ADB command and return stdout.
 */
export async function adb(args: string[], options: AdbExecOptions = {}): Promise<string> {
  const fullArgs = options.serial ? ["-s", options.serial, ...args] : args;

  try {
    const { stdout } = await execAsync("adb", fullArgs, {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    });
    return stdout.trim();
  } catch (err: unknown) {
    const error = err as { stderr?: string; code?: number | null; message?: string };
    throw new AdbError(
      `ADB command failed: adb ${fullArgs.join(" ")}`,
      `adb ${fullArgs.join(" ")}`,
      error.stderr ?? "",
      error.code ?? null,
    );
  }
}

/**
 * Execute a shell command on the device.
 */
export async function adbShell(command: string, options: AdbExecOptions = {}): Promise<string> {
  return adb(["shell", command], options);
}

/**
 * List connected ADB devices.
 */
export async function listDevices(): Promise<DeviceInfo[]> {
  const output = await adb(["devices", "-l"]);
  const lines = output.split("\n").slice(1); // Skip header

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const serial = parts[0];
      const state = parts[1] as DeviceInfo["state"];

      const props: Record<string, string> = {};
      for (const part of parts.slice(2)) {
        const [key, value] = part.split(":");
        if (key && value) props[key] = value;
      }

      return {
        serial,
        state,
        model: props.model,
        product: props.product,
        transport: serial.includes(":") ? "wifi" as const : "usb" as const,
      };
    });
}

/**
 * Get screen size of the device.
 */
export async function getScreenSize(options: AdbExecOptions = {}): Promise<ScreenSize> {
  const output = await adbShell("wm size", options);
  // Prefer "Override size:" over "Physical size:" — the override reflects what's actually displayed
  const overrideMatch = output.match(/Override size:\s*(\d+)x(\d+)/);
  if (overrideMatch) {
    return { width: parseInt(overrideMatch[1]), height: parseInt(overrideMatch[2]) };
  }
  const match = output.match(/(\d+)x(\d+)/);
  if (!match) throw new Error(`Could not parse screen size: ${output}`);
  return { width: parseInt(match[1]), height: parseInt(match[2]) };
}

/**
 * Check if ADB server is reachable and a device is connected.
 */
export async function isDeviceReady(serial?: string): Promise<boolean> {
  try {
    const devices = await listDevices();
    if (serial) {
      return devices.some((d) => d.serial === serial && d.state === "device");
    }
    return devices.some((d) => d.state === "device");
  } catch {
    return false;
  }
}

/**
 * Get the foreground activity's package name.
 */
export async function getForegroundPackage(options: AdbExecOptions = {}): Promise<string> {
  const output = await adbShell("dumpsys window | grep mCurrentFocus", options);
  const match = output.match(/\{[^}]*\s+([a-zA-Z0-9_.]+)\//);
  return match?.[1] ?? "unknown";
}
