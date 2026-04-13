import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginCapability } from "./interface.js";

export interface PluginManifest {
  schemaVersion: "1.0";
  name: string;
  packageName: string;
  version: string;
  displayName: string;
  description: string;
  requiredCoreVersion: string;
  targetApps: string[];
  tools: PluginCapability[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validatePluginManifest(value: unknown): { valid: true; manifest: PluginManifest } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["Manifest must be an object"] };
  }

  const manifest = value as Record<string, unknown>;
  const requiredStrings = ["name", "packageName", "version", "displayName", "description", "requiredCoreVersion"] as const;
  for (const key of requiredStrings) {
    if (typeof manifest[key] !== "string" || (manifest[key] as string).trim() === "") {
      errors.push(`"${key}" must be a non-empty string`);
    }
  }

  if (manifest.schemaVersion !== "1.0") {
    errors.push("\"schemaVersion\" must be \"1.0\"");
  }
  if (!isStringArray(manifest.targetApps)) {
    errors.push("\"targetApps\" must be an array of strings");
  }
  if (!Array.isArray(manifest.tools)) {
    errors.push("\"tools\" must be an array");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    manifest: {
      schemaVersion: "1.0",
      name: manifest.name as string,
      packageName: manifest.packageName as string,
      version: manifest.version as string,
      displayName: manifest.displayName as string,
      description: manifest.description as string,
      requiredCoreVersion: manifest.requiredCoreVersion as string,
      targetApps: manifest.targetApps as string[],
      tools: manifest.tools as PluginCapability[],
    },
  };
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

export function isCoreVersionCompatible(coreVersion: string, requiredRange: string): boolean {
  const core = parseVersion(coreVersion);
  if (!core) return false;
  const range = requiredRange.trim();

  if (range.startsWith(">=")) {
    const min = parseVersion(range.slice(2));
    return min !== null && compareVersions(core, min) >= 0;
  }

  if (range.startsWith("^")) {
    const min = parseVersion(range.slice(1));
    if (!min) return false;
    const max: [number, number, number] = min[0] === 0
      ? [0, min[1] + 1, 0]
      : [min[0] + 1, 0, 0];
    return compareVersions(core, min) >= 0 && compareVersions(core, max) < 0;
  }

  const exact = parseVersion(range);
  return exact !== null && compareVersions(core, exact) === 0;
}

/**
 * Get the pi-droid core version.
 * Without args: reads pi-droid's own package.json (module-relative).
 * With cwd: reads package.json from the specified directory (for marketplace admin).
 */
export async function getCoreVersion(cwd?: string): Promise<string> {
  let pkgPath: string;
  if (cwd) {
    pkgPath = join(cwd, "package.json");
  } else {
    const moduleDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
    pkgPath = join(moduleDir, "..", "..", "package.json");
  }
  const raw = await readFile(pkgPath, "utf-8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}
