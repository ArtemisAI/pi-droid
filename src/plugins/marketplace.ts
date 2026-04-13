import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { PiDroidPlugin } from "./interface.js";
import { getCoreVersion, isCoreVersionCompatible, type PluginManifest, validatePluginManifest } from "./manifest.js";

const exec = promisify(execFile);

export const PLUGIN_NAMESPACE = "@pi-droid/plugin-";

interface ProjectConfig {
  adb?: Record<string, unknown>;
  plugins?: Record<string, Record<string, unknown>>;
}

interface PluginPackageJson {
  name: string;
  version: string;
  description?: string;
  piDroid?: {
    manifest?: unknown;
  };
}

export interface InstalledPluginInfo {
  name: string;
  packageName: string;
  version: string;
  compatible: boolean;
  requiredCoreVersion?: string;
  tools: string[];
  description?: string;
}

export interface PluginSearchResult {
  name: string;
  version: string;
  description: string;
}

export interface LoadedPluginPackage {
  packageName: string;
  manifest: PluginManifest;
  createPlugin: () => PiDroidPlugin;
}

function getModuleExport(moduleNs: Record<string, unknown>, key: string): unknown {
  try {
    return moduleNs[key];
  } catch {
    return undefined;
  }
}

export function normalizePackageName(name: string): string {
  return name.startsWith("@") ? name : `${PLUGIN_NAMESPACE}${name}`;
}

async function runNpm(args: string[], cwd: string): Promise<void> {
  await exec("npm", args, { cwd, env: process.env });
}

async function readProjectConfig(cwd: string): Promise<ProjectConfig> {
  const configPath = join(cwd, "config", "default.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return {};
  }
}

async function writeProjectConfig(config: ProjectConfig, cwd: string): Promise<void> {
  const configPath = join(cwd, "config", "default.json");
  await mkdir(join(cwd, "config"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

async function readPluginPackageJson(packageName: string, cwd: string): Promise<PluginPackageJson> {
  const pkgPath = join(cwd, "node_modules", packageName, "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  return JSON.parse(raw) as PluginPackageJson;
}

/**
 * Resolve package.json via Node module resolution instead of relying on cwd.
 * Uses createRequire from this module's location so it works regardless of
 * what directory the process was started from.
 */
async function resolvePluginPackageJson(packageName: string): Promise<PluginPackageJson> {
  const esmRequire = createRequire(import.meta.url);
  const entryPath = esmRequire.resolve(packageName);
  let dir = dirname(entryPath);
  for (let i = 0; i < 10; i++) {
    try {
      const raw = await readFile(join(dir, "package.json"), "utf-8");
      const pkg = JSON.parse(raw) as PluginPackageJson;
      if (pkg.name === packageName) return pkg;
    } catch { /* not here, walk up */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not resolve package.json for "${packageName}" via module resolution`);
}

export async function loadPluginPackage(packageName: string, cwd = process.cwd()): Promise<LoadedPluginPackage> {
  let moduleNs: Record<string, unknown>;
  try {
    moduleNs = await import(packageName) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Plugin package "${packageName}" not found or failed to load: ${message}. Run: node --import tsx/esm run.mts plugin install ${packageName}`,
    );
  }
  const createPlugin = getModuleExport(moduleNs, "createPlugin") ?? getModuleExport(moduleNs, "default");
  if (typeof createPlugin !== "function") {
    throw new Error(`Plugin package "${packageName}" must export createPlugin()`);
  }

  // Resolve package.json via Node module resolution first (works regardless of cwd),
  // then fall back to cwd-based lookup for environments where createRequire doesn't find it.
  let pkg: PluginPackageJson;
  try {
    pkg = await resolvePluginPackageJson(packageName);
  } catch {
    pkg = await readPluginPackageJson(packageName, cwd);
  }
  const candidate =
    getModuleExport(moduleNs, "piDroidManifest") ??
    getModuleExport(moduleNs, "pluginManifest") ??
    pkg.piDroid?.manifest;
  if (!candidate) {
    throw new Error(`Plugin package "${packageName}" is missing pi-droid manifest`);
  }

  const mergedManifest = {
    ...(candidate as Record<string, unknown>),
    packageName: pkg.name,
    version: pkg.version,
  };
  const validated = validatePluginManifest(mergedManifest);
  if (!validated.valid) {
    throw new Error(`Invalid plugin manifest for "${packageName}": ${validated.errors.join("; ")}`);
  }

  return {
    packageName,
    manifest: validated.manifest,
    createPlugin: createPlugin as () => PiDroidPlugin,
  };
}

export async function installPlugin(name: string, cwd = process.cwd()): Promise<InstalledPluginInfo> {
  const packageName = normalizePackageName(name);
  await runNpm(["install", packageName, "--save"], cwd);

  const loaded = await loadPluginPackage(packageName, cwd);
  const coreVersion = await getCoreVersion(cwd);
  const compatible = isCoreVersionCompatible(coreVersion, loaded.manifest.requiredCoreVersion);
  if (!compatible) {
    throw new Error(
      `Plugin "${loaded.manifest.name}" requires pi-droid ${loaded.manifest.requiredCoreVersion}, current is ${coreVersion}`,
    );
  }

  const config = await readProjectConfig(cwd);
  config.plugins ??= {};
  config.plugins[loaded.manifest.name] = {
    enabled: true,
    package: packageName,
  };
  await writeProjectConfig(config, cwd);

  return {
    name: loaded.manifest.name,
    packageName,
    version: loaded.manifest.version,
    compatible,
    requiredCoreVersion: loaded.manifest.requiredCoreVersion,
    tools: loaded.manifest.tools.map((tool) => tool.name),
    description: loaded.manifest.description,
  };
}

export async function removePlugin(name: string, cwd = process.cwd()): Promise<{ removed: string; packageName: string }> {
  const packageName = normalizePackageName(name);
  await runNpm(["uninstall", packageName], cwd);

  const config = await readProjectConfig(cwd);
  if (config.plugins) {
    for (const [pluginName, pluginConfig] of Object.entries(config.plugins)) {
      const configuredPackage = pluginConfig.package;
      const shortName = packageName.replace(PLUGIN_NAMESPACE, "");
      if (pluginName === name || pluginName === shortName || configuredPackage === packageName) {
        delete config.plugins[pluginName];
      }
    }
    await writeProjectConfig(config, cwd);
  }

  return { removed: name, packageName };
}

export async function listInstalledPlugins(cwd = process.cwd()): Promise<InstalledPluginInfo[]> {
  const rootPackageRaw = await readFile(join(cwd, "package.json"), "utf-8");
  const rootPackage = JSON.parse(rootPackageRaw) as { dependencies?: Record<string, string> };
  const dependencies = Object.keys(rootPackage.dependencies ?? {}).filter((dep) => dep.startsWith(PLUGIN_NAMESPACE));
  const coreVersion = await getCoreVersion(cwd);

  const results = await Promise.all(
    dependencies.map(async (packageName) => {
      const pkg = await readPluginPackageJson(packageName, cwd);
      const manifestCandidate = pkg.piDroid?.manifest;
      const mergedManifest = manifestCandidate
        ? {
            ...(manifestCandidate as Record<string, unknown>),
            packageName: pkg.name,
            version: pkg.version,
          }
        : null;
      const validation = mergedManifest ? validatePluginManifest(mergedManifest) : null;
      const manifest = validation?.valid ? validation.manifest : null;

      return {
        name: manifest?.name ?? packageName.replace(PLUGIN_NAMESPACE, ""),
        packageName,
        version: pkg.version,
        compatible: manifest ? isCoreVersionCompatible(coreVersion, manifest.requiredCoreVersion) : false,
        requiredCoreVersion: manifest?.requiredCoreVersion,
        tools: manifest?.tools.map((tool) => tool.name) ?? [],
        description: manifest?.description ?? pkg.description,
      } satisfies InstalledPluginInfo;
    }),
  );

  return results;
}

export async function searchPlugins(query: string, limit = 10): Promise<PluginSearchResult[]> {
  const encoded = encodeURIComponent(`${query} ${PLUGIN_NAMESPACE}`);
  const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encoded}&size=${limit}`);
  if (!response.ok) {
    throw new Error(`Registry search failed with status ${response.status}`);
  }
  const body = await response.json() as {
    objects?: Array<{ package: { name: string; version: string; description?: string } }>;
  };
  const objects = body.objects ?? [];
  return objects
    .map((entry) => entry.package)
    .filter((pkg) => pkg.name.startsWith(PLUGIN_NAMESPACE))
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? "",
    }));
}
