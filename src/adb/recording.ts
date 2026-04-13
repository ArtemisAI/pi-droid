/**
 * Screen recording — start, stop, and pull device screen recordings.
 *
 * Uses `adb shell screenrecord` to capture video on the device,
 * then pulls it locally for debugging or training data.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { adb, adbShell, type AdbExecOptions } from "./exec.js";

const REMOTE_PATH = "/sdcard/pi-droid-rec.mp4";

export interface RecordingOptions extends AdbExecOptions {
  /** Max recording duration in seconds (default: 180, max: 180) */
  maxDuration?: number;
  /** Video bit rate in bits/s (e.g., 6000000 for 6Mbps) */
  bitRate?: number;
  /** Video size as "WIDTHxHEIGHT" (e.g., "1280x720") */
  size?: string;
}

/**
 * Start screen recording on the device.
 *
 * Launches `screenrecord` in the background — does not wait for completion.
 * Returns the remote path where the recording will be saved.
 */
export async function startRecording(options: RecordingOptions = {}): Promise<string> {
  const args: string[] = [];

  const maxDuration = options.maxDuration ?? 180;
  args.push("--time-limit", String(maxDuration));

  if (options.bitRate) {
    args.push("--bit-rate", String(options.bitRate));
  }

  if (options.size) {
    args.push("--size", options.size);
  }

  args.push(REMOTE_PATH);

  // Run screenrecord in the background via nohup + &
  // We don't await completion — the process records until stopped or time limit.
  const cmd = `nohup screenrecord ${args.join(" ")} > /dev/null 2>&1 &`;
  await adbShell(cmd, options);

  return REMOTE_PATH;
}

/**
 * Stop an active screen recording by sending SIGINT to the screenrecord process.
 *
 * SIGINT causes screenrecord to finalize the mp4 file cleanly.
 */
export async function stopRecording(options: AdbExecOptions = {}): Promise<void> {
  await adbShell("pkill -INT screenrecord", options);
  // Give screenrecord a moment to finalize the file
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

/**
 * Pull the recording from the device to a local directory.
 *
 * Returns the local file path where the recording was saved.
 */
export async function pullRecording(
  localDir?: string,
  options: AdbExecOptions = {},
): Promise<string> {
  const dir = localDir ?? "/tmp/pi-droid/recordings";

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const localPath = join(dir, `rec_${ts}.mp4`);

  await adb(["pull", REMOTE_PATH, localPath], options);

  return localPath;
}

/**
 * Check if a screenrecord process is currently running on the device.
 */
export async function isRecording(options: AdbExecOptions = {}): Promise<boolean> {
  try {
    const output = await adbShell("pidof screenrecord", options);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}
