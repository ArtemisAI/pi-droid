/**
 * Safe, auditable shell command execution on Android devices.
 *
 * Provides structured wrappers around `adb shell` for arbitrary commands,
 * multi-line scripts, process management, and memory inspection.
 */

import { adb, adbShell, type AdbExecOptions } from "./exec.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ShellOptions {
  /** Device serial to target */
  serial?: string;
  /** Command timeout in ms (default: 30000) */
  timeout?: number;
  /** Max stdout buffer size in bytes (default: 1MB) */
  maxOutput?: number;
}

export interface ShellResult {
  stdout: string;
  exitCode: number;
  duration: number;
}

export interface ScriptOptions extends ShellOptions {
  /** Shell interpreter (default: "sh") */
  interpreter?: string;
}

export interface ProcessInfo {
  pid: number;
  user: string;
  rss: number;
  name: string;
}

export interface MemoryInfo {
  totalMb: number;
  freeMb: number;
  availableMb: number;
  usedPercent: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function toExecOptions(opts: ShellOptions = {}): AdbExecOptions {
  return {
    serial: opts.serial,
    timeout: opts.timeout ?? 30_000,
    maxBuffer: opts.maxOutput ?? 1024 * 1024,
  };
}

// ── executeShell ─────────────────────────────────────────────────────

/**
 * Execute an arbitrary shell command on the device.
 *
 * Captures the exit code via `echo $?` to reliably report success/failure
 * even when ADB itself doesn't propagate it.
 */
export async function executeShell(
  command: string,
  options: ShellOptions = {},
): Promise<ShellResult> {
  const execOpts = toExecOptions(options);
  const start = Date.now();

  // Run the command and capture exit code on a separate line
  const wrapped = `${command}; echo ":::EXIT_CODE::$?"`;
  const raw = await adbShell(wrapped, execOpts);
  const duration = Date.now() - start;

  // Parse exit code from trailing marker
  const markerIndex = raw.lastIndexOf(":::EXIT_CODE::");
  let stdout: string;
  let exitCode: number;

  if (markerIndex !== -1) {
    stdout = raw.slice(0, markerIndex).trimEnd();
    const codeStr = raw.slice(markerIndex + ":::EXIT_CODE::".length).trim();
    exitCode = parseInt(codeStr, 10);
    if (Number.isNaN(exitCode)) exitCode = 0;
  } else {
    stdout = raw;
    exitCode = 0;
  }

  return { stdout, exitCode, duration };
}

// ── executeShellScript ───────────────────────────────────────────────

/**
 * Push a multi-line script to the device, execute it, and clean up.
 *
 * The script is written to a temp file on the host, pushed via `adb push`,
 * executed with the chosen interpreter, then removed from the device.
 */
export async function executeShellScript(
  script: string,
  options: ScriptOptions = {},
): Promise<ShellResult> {
  const interpreter = options.interpreter ?? "sh";
  const execOpts = toExecOptions(options);
  const remotePath = `/data/local/tmp/_pidroid_script_${Date.now()}.sh`;

  // Push the script content using shell echo (avoids temp file on host)
  // Use base64 to safely transfer arbitrary script content
  const encoded = Buffer.from(script).toString("base64");
  await adbShell(
    `echo '${encoded}' | base64 -d > ${remotePath} && chmod +x ${remotePath}`,
    execOpts,
  );

  try {
    // Execute and capture result
    const result = await executeShell(`${interpreter} ${remotePath}`, options);
    return result;
  } finally {
    // Always clean up
    try {
      await adbShell(`rm -f ${remotePath}`, execOpts);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ── getProcessList ───────────────────────────────────────────────────

/**
 * List running processes with PID, user, name, and RSS memory.
 *
 * Robust to varying `ps` output formats across Android versions.
 */
export async function getProcessList(options: ShellOptions = {}): Promise<ProcessInfo[]> {
  const execOpts = toExecOptions(options);
  const raw = await adbShell("ps -A -o PID,USER,RSS,NAME", execOpts);
  const lines = raw.split("\n");

  const processes: ProcessInfo[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip header lines (contain "PID" or non-numeric first token)
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;

    const pid = parseInt(parts[0], 10);
    if (Number.isNaN(pid)) continue; // header or garbage line

    const user = parts[1];
    const rss = parseInt(parts[2], 10);
    // Name may contain spaces in some edge cases — join remaining parts
    const name = parts.slice(3).join(" ");

    processes.push({
      pid,
      user,
      rss: Number.isNaN(rss) ? 0 : rss,
      name,
    });
  }

  return processes;
}

// ── killProcess ──────────────────────────────────────────────────────

/**
 * Kill a process by PID. Returns true if the kill command succeeded.
 */
export async function killProcess(
  pid: number,
  options: ShellOptions = {},
): Promise<boolean> {
  try {
    const result = await executeShell(`kill ${pid}`, options);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ── getMemoryInfo ────────────────────────────────────────────────────

/**
 * Get device memory summary by parsing `/proc/meminfo`.
 *
 * Returns total, free, and available memory in MB plus used percentage.
 */
export async function getMemoryInfo(options: ShellOptions = {}): Promise<MemoryInfo> {
  const execOpts = toExecOptions(options);
  const raw = await adbShell("cat /proc/meminfo", execOpts);

  const extract = (key: string): number => {
    const re = new RegExp(`^${key}:\\s+(\\d+)`, "m");
    const match = raw.match(re);
    if (!match) throw new Error(`Could not find ${key} in /proc/meminfo`);
    // /proc/meminfo values are in kB
    return parseInt(match[1], 10);
  };

  const totalKb = extract("MemTotal");
  const freeKb = extract("MemFree");
  const availableKb = extract("MemAvailable");

  const totalMb = Math.round(totalKb / 1024);
  const freeMb = Math.round(freeKb / 1024);
  const availableMb = Math.round(availableKb / 1024);
  const usedPercent = Math.round(((totalKb - availableKb) / totalKb) * 100);

  return { totalMb, freeMb, availableMb, usedPercent };
}
