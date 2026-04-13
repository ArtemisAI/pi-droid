/**
 * File management tools — push, pull, list, delete, storage info.
 *
 * Wraps ADB file operations with proper error handling and
 * structured return types.
 */

import { adb, adbShell, type AdbExecOptions } from "./exec.js";

export interface DirEntry {
  /** File permissions string (e.g., "-rwxr-xr-x") */
  permissions: string;
  /** Owner */
  owner: string;
  /** Group */
  group: string;
  /** File size in bytes */
  size: number;
  /** Last modified date string */
  date: string;
  /** File/directory name */
  name: string;
  /** True if entry is a directory */
  isDirectory: boolean;
  /** True if entry is a symlink */
  isSymlink: boolean;
}

export interface StorageInfo {
  /** Filesystem path */
  filesystem: string;
  /** Total size (human-readable) */
  size: string;
  /** Used space (human-readable) */
  used: string;
  /** Available space (human-readable) */
  available: string;
  /** Use percentage (e.g., "42%") */
  usePercent: string;
  /** Mount point */
  mountedOn: string;
}

export interface PushPullResult {
  /** Source path */
  source: string;
  /** Destination path */
  destination: string;
  /** Raw ADB output (contains transfer speed, bytes) */
  output: string;
}

/**
 * Push a local file to the device.
 */
export async function pushFile(
  localPath: string,
  remotePath: string,
  options: AdbExecOptions = {},
): Promise<PushPullResult> {
  const output = await adb(["push", localPath, remotePath], options);
  return { source: localPath, destination: remotePath, output };
}

/**
 * Pull a file from the device to local filesystem.
 */
export async function pullFile(
  remotePath: string,
  localPath: string,
  options: AdbExecOptions = {},
): Promise<PushPullResult> {
  const output = await adb(["pull", remotePath, localPath], options);
  return { source: remotePath, destination: localPath, output };
}

/**
 * List directory contents on the device.
 */
export async function listDir(
  remotePath: string,
  options: AdbExecOptions = {},
): Promise<DirEntry[]> {
  const output = await adbShell(`ls -la ${remotePath}`, options);
  const lines = output.split("\n");

  return lines
    .filter((line) => {
      const trimmed = line.trim();
      // Skip empty lines, total line, and . / .. entries
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith("total") &&
        !trimmed.endsWith(" .") &&
        !trimmed.endsWith(" ..")
      );
    })
    .map((line) => parseLsLine(line))
    .filter((entry): entry is DirEntry => entry !== null);
}

/**
 * Delete a file or directory on the device.
 */
export async function deleteFile(
  remotePath: string,
  options: AdbExecOptions & { recursive?: boolean; force?: boolean } = {},
): Promise<void> {
  const flags: string[] = [];
  if (options.recursive) flags.push("-r");
  if (options.force) flags.push("-f");

  const flagStr = flags.length > 0 ? ` ${flags.join(" ")}` : "";
  await adbShell(`rm${flagStr} ${remotePath}`, options);
}

/**
 * Get storage usage information for the device.
 */
export async function getStorageInfo(
  options: AdbExecOptions = {},
): Promise<StorageInfo[]> {
  const output = await adbShell("df -h", options);
  const lines = output.split("\n");

  return lines
    .slice(1) // Skip header
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) return null;
      return {
        filesystem: parts[0],
        size: parts[1],
        used: parts[2],
        available: parts[3],
        usePercent: parts[4],
        mountedOn: parts[5],
      };
    })
    .filter((entry): entry is StorageInfo => entry !== null);
}

/**
 * Check if a file or directory exists on the device.
 */
export async function fileExists(
  remotePath: string,
  options: AdbExecOptions = {},
): Promise<boolean> {
  try {
    const output = await adbShell(`[ -e ${remotePath} ] && echo EXISTS`, options);
    return output.includes("EXISTS");
  } catch {
    return false;
  }
}

/** Parse a single line from `ls -la` output. */
function parseLsLine(line: string): DirEntry | null {
  // Format: permissions links owner group size date time name
  // e.g.:   -rw-r--r-- 1 root root 1234 2024-01-15 10:30 file.txt
  const parts = line.trim().split(/\s+/);
  if (parts.length < 7) return null;

  const permissions = parts[0];
  // parts[1] is link count, skip it
  const owner = parts[2];
  const group = parts[3];
  const size = parseInt(parts[4]) || 0;
  const date = `${parts[5]} ${parts[6]}`;
  // Name is everything after the date/time (handles spaces in names)
  const name = parts.slice(7).join(" ");

  if (!name) return null;

  return {
    permissions,
    owner,
    group,
    size,
    date,
    name: name.replace(/ -> .*$/, ""), // Strip symlink target from name
    isDirectory: permissions.startsWith("d"),
    isSymlink: permissions.startsWith("l"),
  };
}
