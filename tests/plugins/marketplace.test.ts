import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (_command: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, "", "");
    },
  ),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock(
  "@pi-droid/plugin-demo",
  () => ({
    createPlugin: () => ({
      name: "demo",
      displayName: "Demo Plugin",
      targetApps: ["com.demo"],
      initialize: async () => undefined,
      getCapabilities: () => [{ name: "demo.action", description: "Action", requiresApproval: false }],
      getStatus: async () => ({ ready: true, message: "ok" }),
      execute: async () => ({ success: true }),
      onHeartbeat: async () => null,
      destroy: async () => undefined,
    }),
  }),
  { virtual: true },
);

vi.mock(
  "@pi-droid/plugin-no-factory",
  () => ({
    pluginManifest: { schemaVersion: "1.0" },
  }),
  { virtual: true },
);

import {
  installPlugin,
  listInstalledPlugins,
  loadPluginPackage,
  normalizePackageName,
  removePlugin,
  searchPlugins,
} from "../../src/plugins/marketplace.js";

async function createTempProject(
  options: {
    rootVersion?: string;
    pluginName?: string;
    pluginVersion?: string;
    requiredCoreVersion?: string;
  } = {},
): Promise<string> {
  const rootVersion = options.rootVersion ?? "0.1.0";
  const pluginName = options.pluginName ?? "@pi-droid/plugin-demo";
  const pluginVersion = options.pluginVersion ?? "1.2.3";
  const requiredCoreVersion = options.requiredCoreVersion ?? ">=0.1.0";
  const pluginShortName = pluginName.replace("@pi-droid/plugin-", "");
  const pluginScopePath = pluginName.split("/");
  const cwd = await mkdtemp(join(tmpdir(), "pidroid-marketplace-"));
  await mkdir(join(cwd, "config"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "test-project",
        version: rootVersion,
        dependencies: {
          [pluginName]: "^1.0.0",
        },
      },
      null,
      2,
    ),
  );
  await mkdir(join(cwd, "node_modules", ...pluginScopePath), { recursive: true });
  await writeFile(
    join(cwd, "node_modules", ...pluginScopePath, "package.json"),
    JSON.stringify(
      {
        name: pluginName,
        version: pluginVersion,
        piDroid: {
          manifest: {
            schemaVersion: "1.0",
            name: pluginShortName,
            packageName: pluginName,
            version: pluginVersion,
            displayName: "Demo Plugin",
            description: "Demo plugin",
            requiredCoreVersion,
            targetApps: ["com.demo"],
            tools: [{ name: `${pluginShortName}.action`, description: "Action", requiresApproval: false }],
          },
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(cwd, "config", "default.json"),
    JSON.stringify(
      {
        plugins: {
          demo: {
            enabled: true,
            package: pluginName,
          },
        },
      },
      null,
      2,
    ),
  );
  return cwd;
}

describe("marketplace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execFileMock.mockClear();
  });

  describe("normalizePackageName", () => {
    it("adds namespace prefix when missing", () => {
      expect(normalizePackageName("demo")).toBe("@pi-droid/plugin-demo");
    });

    it("preserves scoped package names", () => {
      expect(normalizePackageName("@pi-droid/plugin-demo")).toBe("@pi-droid/plugin-demo");
      expect(normalizePackageName("@custom/plugin-demo")).toBe("@custom/plugin-demo");
    });
  });

  it("lists installed plugins and tools from manifests", async () => {
    const cwd = await createTempProject();
    const list = await listInstalledPlugins(cwd);

    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("demo");
    expect(list[0].tools).toEqual(["demo.action"]);
    expect(list[0].compatible).toBe(true);
  });

  it("removes plugin entry from config", async () => {
    const cwd = await createTempProject();
    await removePlugin("demo", cwd);
    const configRaw = await readFile(join(cwd, "config", "default.json"), "utf-8");
    const config = JSON.parse(configRaw) as { plugins?: Record<string, unknown> };
    expect(config.plugins?.demo).toBeUndefined();
  });

  it("searches npm registry and filters namespace", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          { package: { name: "@pi-droid/plugin-alpha", version: "1.0.0", description: "alpha" } },
          { package: { name: "other/pkg", version: "1.0.0", description: "other" } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPlugins("alpha");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("@pi-droid/plugin-alpha");
  });

  describe("loadPluginPackage", () => {
    it("loads package manifest and plugin factory", async () => {
      const cwd = await createTempProject();
      const loaded = await loadPluginPackage("@pi-droid/plugin-demo", cwd);
      expect(loaded.manifest.name).toBe("demo");
      expect(typeof loaded.createPlugin).toBe("function");
    });

    it("rejects package without createPlugin export", async () => {
      const cwd = await createTempProject({ pluginName: "@pi-droid/plugin-no-factory" });
      await expect(loadPluginPackage("@pi-droid/plugin-no-factory", cwd)).rejects.toThrow(
        'Plugin package "@pi-droid/plugin-no-factory" must export createPlugin()',
      );
    });

    it("returns clear error when package cannot be imported", async () => {
      const cwd = await createTempProject({ pluginName: "@pi-droid/plugin-missing" });
      await expect(loadPluginPackage("@pi-droid/plugin-missing", cwd)).rejects.toThrow(
        'Plugin package "@pi-droid/plugin-missing" not found or failed to load',
      );
    });
  });

  describe("installPlugin", () => {
    it("installs valid plugin package and updates config", async () => {
      const cwd = await createTempProject();
      const result = await installPlugin("demo", cwd);
      expect(result.name).toBe("demo");
      expect(result.packageName).toBe("@pi-droid/plugin-demo");
      expect(result.tools).toEqual(["demo.action"]);
      expect(execFileMock).toHaveBeenCalledWith(
        "npm",
        ["install", "@pi-droid/plugin-demo", "--save"],
        expect.any(Object),
        expect.any(Function),
      );

      const configRaw = await readFile(join(cwd, "config", "default.json"), "utf-8");
      const config = JSON.parse(configRaw) as { plugins: Record<string, { package: string; enabled: boolean }> };
      expect(config.plugins.demo).toEqual({ enabled: true, package: "@pi-droid/plugin-demo" });
    });

    it("rejects incompatible pi-droid version", async () => {
      const cwd = await createTempProject({ requiredCoreVersion: ">=9.0.0" });
      await expect(installPlugin("demo", cwd)).rejects.toThrow(
        'Plugin "demo" requires pi-droid >=9.0.0, current is 0.1.0',
      );
    });

    it("rejects package without createPlugin export", async () => {
      const cwd = await createTempProject({ pluginName: "@pi-droid/plugin-no-factory" });
      await expect(installPlugin("@pi-droid/plugin-no-factory", cwd)).rejects.toThrow(
        'Plugin package "@pi-droid/plugin-no-factory" must export createPlugin()',
      );
    });
  });
});
