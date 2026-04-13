import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { launchApp } from "../adb/app.js";
import { keyEvent } from "../adb/input.js";
import { takeScreenshot } from "../adb/screenshot.js";
import type { AdbExecOptions } from "../adb/exec.js";

// NOTE: v1 router supports only these tools; extending requires updating this union
// and executeRoutedTool() switch below.
export type SupportedRouteTool = "android_screenshot" | "android_key" | "android_app";

export interface RouteEntry {
  name?: string;
  patterns: string[];
  tool: SupportedRouteTool;
  args?: Record<string, unknown>;
}

export interface RouterConfig {
  routes: RouteEntry[];
  appAliases?: Record<string, string>;
}

export interface RoutedToolCall {
  name: string;
  tool: SupportedRouteTool;
  args: Record<string, unknown>;
}

export interface RouterRoutingConfig {
  enabled?: unknown;
  file?: unknown;
}

export interface RoutedInputResult {
  handled: boolean;
  message?: {
    customType: "pidroid-route";
    content: string;
    display: true;
    details: Record<string, unknown>;
  };
  notification?: { text: string; level: "info" | "warning" };
}

export interface InputRouter {
  configure(routingConfig: RouterRoutingConfig): Promise<void>;
  handleRoutedInput(text: string, options: AdbExecOptions): Promise<RoutedInputResult>;
}

const PACKAGE_NAME_RE = /^(?:[a-zA-Z][\w]*\.)+[a-zA-Z][\w]*$/;

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function toRoutes(value: unknown): RouteEntry[] {
  if (!Array.isArray(value)) return [];
  const routes: RouteEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const route = item as Record<string, unknown>;
    const patterns = Array.isArray(route.patterns)
      ? route.patterns.filter((p): p is string => typeof p === "string")
      : [];
    const tool = route.tool;
    if ((tool !== "android_screenshot" && tool !== "android_key" && tool !== "android_app") || patterns.length === 0) {
      continue;
    }
    routes.push({
      name: typeof route.name === "string" ? route.name : undefined,
      patterns,
      tool,
      args: toObject(route.args),
    });
  }
  return routes;
}

export async function loadRouterConfig(baseDir: string, routeFile?: string): Promise<RouterConfig> {
  const relativePath = routeFile ?? "config/routes.json";
  const fullPath = isAbsolute(relativePath) ? relativePath : join(baseDir, relativePath);
  try {
    const raw = await readFile(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      routes: toRoutes(parsed.routes),
      appAliases: Object.fromEntries(
        Object.entries(toObject(parsed.appAliases))
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key.toLowerCase(), value as string]),
      ),
    };
  } catch {
    return { routes: [] };
  }
}

function resolveTemplate(template: string, groups: Record<string, string>, numbered: string[]): string {
  return template.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*|\d+)/g, (_m, token: string) => {
    if (/^\d+$/.test(token)) {
      const idx = Number(token);
      return numbered[idx] ?? "";
    }
    return groups[token] ?? "";
  });
}

function resolveArgs(args: Record<string, unknown> | undefined, groups: Record<string, string>, numbered: string[]): Record<string, unknown> {
  if (!args) return {};
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      resolved[key] = resolveTemplate(value, groups, numbered);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function normalizeAppValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").replace(/[.?!,:;]+$/g, "");
}

function resolveAppPackage(rawValue: string, appAliases: Record<string, string>): string | undefined {
  const value = normalizeAppValue(rawValue);
  const alias = appAliases[value.toLowerCase()];
  if (alias) return alias;
  if (PACKAGE_NAME_RE.test(value)) return value;
  return undefined;
}

function routeFromMatch(entry: RouteEntry, match: RegExpMatchArray, appAliases: Record<string, string>): RoutedToolCall | null {
  const groups: Record<string, string> = {};
  for (const [key, value] of Object.entries(match.groups ?? {})) {
    if (typeof value === "string") groups[key] = value;
  }
  const args = resolveArgs(entry.args, groups, match);
  if (entry.tool === "android_app" && args.action === "launch" && typeof args.package === "string") {
    const packageName = resolveAppPackage(args.package, appAliases);
    if (!packageName) return null;
    args.package = packageName;
  }
  return {
    name: entry.name ?? entry.tool,
    tool: entry.tool,
    args,
  };
}

function detectSingleTool(text: string, appAliases: Record<string, string>): RoutedToolCall | null {
  const normalized = text.trim();
  if (/^android_screenshot$/i.test(normalized)) {
    return { name: "single_tool", tool: "android_screenshot", args: {} };
  }

  const keyMatch = normalized.match(/^android_key\s+(.+)$/i);
  if (keyMatch) {
    const key = keyMatch[1].trim();
    if (key) return { name: "single_tool", tool: "android_key", args: { key } };
  }

  const appMatch = normalized.match(/^android_app\s+launch\s+(.+)$/i);
  if (appMatch) {
    const packageName = resolveAppPackage(appMatch[1], appAliases);
    if (packageName) {
      return { name: "single_tool", tool: "android_app", args: { action: "launch", package: packageName } };
    }
  }
  return null;
}

export function resolveRoutedTool(text: string, config: RouterConfig): RoutedToolCall | null {
  const appAliases = config.appAliases ?? {};
  for (const route of config.routes) {
    for (const pattern of route.patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pattern, "i");
      } catch {
        continue;
      }
      const match = text.trim().match(re);
      if (!match) continue;
      const resolved = routeFromMatch(route, match, appAliases);
      if (resolved) return resolved;
    }
  }
  return detectSingleTool(text, appAliases);
}

export async function executeRoutedTool(call: RoutedToolCall, options: AdbExecOptions = {}): Promise<Record<string, unknown>> {
  switch (call.tool) {
    case "android_screenshot": {
      const result = await takeScreenshot(options);
      return { routed_to: call.tool, result };
    }
    case "android_key": {
      if (typeof call.args.key !== "string" || call.args.key.length === 0) {
        throw new Error("android_key route requires a key argument");
      }
      await keyEvent(call.args.key, options);
      return { routed_to: call.tool, key: call.args.key };
    }
    case "android_app": {
      if (call.args.action !== "launch" || typeof call.args.package !== "string" || call.args.package.length === 0) {
        throw new Error("android_app route requires action=launch and package");
      }
      await launchApp(call.args.package, options);
      return { routed_to: call.tool, launched: call.args.package };
    }
  }
}

export function createInputRouter(baseDir: string): InputRouter {
  let enabled = true;
  let routerConfig: RouterConfig = { routes: [] };

  return {
    async configure(routingConfig: RouterRoutingConfig): Promise<void> {
      enabled = routingConfig.enabled !== false;
      const routeFile = typeof routingConfig.file === "string" ? routingConfig.file : undefined;
      routerConfig = await loadRouterConfig(baseDir, routeFile);
    },
    async handleRoutedInput(text: string, options: AdbExecOptions): Promise<RoutedInputResult> {
      if (!enabled) return { handled: false };

      const route = resolveRoutedTool(text, routerConfig);
      if (!route) return { handled: false };

      try {
        const result = await executeRoutedTool(route, options);
        return {
          handled: true,
          message: {
            customType: "pidroid-route",
            content: JSON.stringify(result),
            display: true,
            details: { route: route.name, tool: route.tool, args: route.args },
          },
          notification: { text: `Pi-Droid route: ${route.name} -> ${route.tool}`, level: "info" },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          handled: true,
          message: {
            customType: "pidroid-route",
            content: JSON.stringify({ routed_to: route.tool, error: message }),
            display: true,
            details: { route: route.name, tool: route.tool, args: route.args },
          },
          notification: { text: `Pi-Droid route failed: ${message}`, level: "warning" },
        };
      }
    },
  };
}
