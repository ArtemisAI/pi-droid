# Plugin Development Guide

Pi-droid's plugin system lets contributors add app-specific automation on top of the generic ADB layer. A plugin is a thin adapter: it owns the app's coordinates, activity names, rate limits, and approval gates -- the core tools stay app-agnostic.

---

## When to Write a Plugin

| Use case | Right abstraction |
|----------|------------------|
| Automate a specific app repeatedly (scrape, post, navigate) | **Plugin** (external package, `@pi-droid/plugin-*`) |
| Generic ADB capability (screenshot, input, system info) | **ADB module** (`src/adb/`) |

---

## Quick Start -- 5 Steps

### 1. Create the plugin package

Plugins live in their own npm packages, not inside pi-droid. Create a new
directory with its own `package.json` and `tsconfig.json`.

```typescript
// my-plugin/src/myapp.ts
import { CliPlugin, type CommandMapping, type PluginCapability } from "pi-droid";

const CAPABILITIES: PluginCapability[] = [
  {
    name: "myapp.status",
    description: "Check the app status and current view",
    requiresApproval: false,
  },
  {
    name: "myapp.action",
    description: "Perform the main action (sends to another user -- requires approval)",
    requiresApproval: true,  // gates through LLM approval before executing
  },
];

const COMMANDS: Record<string, CommandMapping> = {
  "myapp.status": { command: "myapp status" },
  "myapp.action": {
    command: "myapp do-action",
    args: (params) => ["--target", String(params.target ?? "")],
  },
};

export class MyAppPlugin extends CliPlugin {
  readonly name = "myapp";
  readonly displayName = "My App";
  readonly targetApps = ["com.example.myapp"];  // package names this plugin targets

  constructor() {
    super({ cli_command: "myapp-cli" }, CAPABILITIES, COMMANDS);
  }
}
```

### 2. Create the entry point

```typescript
// my-plugin/src/index.ts
import { MyAppPlugin } from "./myapp.js";

export function createPlugin(): MyAppPlugin {
  return new MyAppPlugin();
}

export const piDroidManifest = {
  schemaVersion: "1.0",
  name: "myapp",
  displayName: "My App",
  description: "Automation for My App",
  requiredCoreVersion: ">=0.1.0",
  targetApps: ["com.example.myapp"],
  tools: [
    { name: "myapp.status", description: "Read app status", requiresApproval: false },
    { name: "myapp.send", description: "Send message", requiresApproval: true },
  ],
};
```

### 3. Configure in pi-droid

```json
// pi-droid/config/default.json
{
  "plugins": {
    "myapp": {
      "enabled": true,
      "package": "@pi-droid/plugin-myapp"
    }
  }
}
```

For local development, use `"package": "file:../path/to/my-plugin"` or `npm link`.

### 4. Add a CLAUDE.md for the agent

Create `my-plugin/CLAUDE.md` with agent instructions: available actions,
workflow, rate limits, error handling. This tells the pi-agent how to
operate your plugin.

### 5. Test it

```bash
# Build the plugin
cd my-plugin && npm run build

# Link it into pi-droid (for development)
npm link
cd ../pi-droid && npm link @pi-droid/plugin-myapp

# Run pi-agent
export ANDROID_SERIAL=your_device_serial
pi -e ./src/index.ts
# In the pi agent: android_skills -> should show myapp capabilities
```

---

## Plugin Interface Reference

Source: `src/plugins/interface.ts`

```typescript
interface PiDroidPlugin {
  readonly name: string;          // unique identifier ("myapp")
  readonly displayName: string;   // human-readable ("My App")
  readonly targetApps: string[];  // package names (["com.example.myapp"])

  initialize(config: Record<string, unknown>): Promise<void>;
  getCapabilities(): PluginCapability[];
  getStatus(): Promise<PluginStatus>;
  execute(action: string, params: Record<string, unknown>): Promise<PluginActionResult>;
  onHeartbeat(): Promise<PluginActionResult | null>;
  destroy(): Promise<void>;
}

interface PluginCapability {
  name: string;               // "myapp.action"
  description: string;        // shown in android_skills output
  requiresApproval: boolean;  // true = LLM must confirm before executing
  parameters?: Record<string, unknown>;  // TypeBox-compatible JSON schema
}

interface PluginStatus {
  ready: boolean;             // is the plugin ready to operate?
  message: string;            // human-readable status
  rateLimit?: {               // rate limit info if applicable
    remaining: number;
    limit: number;
    resetsAt?: string;
  };
  metadata?: Record<string, unknown>;
}

interface PluginActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  budget?: PluginTaskBudgetReport;  // remaining step/time budget
  logEntry?: {                      // for training data collection
    actionType: string;
    details: Record<string, unknown>;
    screenshotPath?: string;
    uiDumpPath?: string;
  };
}
```

---

## Marketplace Manifest (`piDroid.manifest`)

Marketplace plugins should be published to npm and include a manifest in `package.json`:

```json
{
  "name": "@pi-droid/plugin-myapp",
  "version": "1.0.0",
  "piDroid": {
    "manifest": {
      "schemaVersion": "1.0",
      "name": "myapp",
      "packageName": "@pi-droid/plugin-myapp",
      "version": "1.0.0",
      "displayName": "My App Plugin",
      "description": "Automation for My App",
      "requiredCoreVersion": ">=0.1.0",
      "targetApps": ["com.example.myapp"],
      "tools": [
        { "name": "myapp.status", "description": "Read app status", "requiresApproval": false },
        { "name": "myapp.send", "description": "Send message", "requiresApproval": true }
      ]
    }
  }
}
```

The package must also export a factory:

```typescript
export function createPlugin(): PiDroidPlugin {
  return new MyAppPlugin();
}
```

---

## CliPlugin Base Class

If your plugin wraps a JSON-outputting CLI, extend `CliPlugin` instead of implementing `PiDroidPlugin` from scratch. `CliPlugin` handles subprocess management, JSON parsing, error wrapping, and command mapping.

```typescript
// CommandMapping -- maps capability names to CLI subcommands
interface CommandMapping {
  command: string;                                      // e.g. "myapp status"
  args?: (params: Record<string, unknown>) => string[]; // dynamic args from params
  requiresDevice?: boolean;                             // default: true
}
```

---

## Native Runner Pattern

For apps where the CLI backend is being replaced with direct ADB automation
(or where no CLI exists), the **native runner** pattern separates locators from
automation logic:

```
src/plugins/
  myapp.ts              <- CliPlugin subclass (interface to pi-agent)
  myapp-locators.ts     <- Constants: package, activities, coordinates, selectors, patterns
  myapp-runner.ts       <- Pure ADB automation functions (no plugin interface)
```

**myapp-locators.ts** -- Static data only. No imports from `src/adb/`.

```typescript
export const MYAPP_PKG = "com.example.myapp";
export const MYAPP_ACTIVITY = ".ui.MainActivity";

export const NAV_TABS = {
  home:    { desc: "Home",    center: { x: 144, y: 2844 } },
  search:  { desc: "Search",  center: { x: 432, y: 2844 } },
} as const;

export type MyAppTab = keyof typeof NAV_TABS;
```

**myapp-runner.ts** -- Imports from `src/adb/` and locators. All functions accept
`AdbExecOptions` as last parameter.

```typescript
import { tap } from "../adb/input.js";
import type { AdbExecOptions } from "../adb/exec.js";
import { MYAPP_PKG, NAV_TABS, type MyAppTab } from "./myapp-locators.js";

export async function navigateToTab(tab: MyAppTab, opts: AdbExecOptions = {}): Promise<boolean> {
  const { center } = NAV_TABS[tab];
  await tap(center.x, center.y, opts);
  return true;
}
```

---

## Coordinate Constants

Store app-specific coordinates as typed constants at the top of your plugin file, with resolution comments:

```typescript
const COORDS = {
  // 1440x2960 (Galaxy S9)
  likeButton:   { x: 1080, y: 1800 },
  skipButton:   { x: 360,  y: 1800 },
  profileArea:  { x: 720,  y: 900  },
} as const;
```

Never embed coordinates in the middle of logic -- they need to be easy to update when tested on a new device.

---

## Approval Gates

Any action that affects another person, sends a message, makes a purchase, or takes an irreversible action **must** set `requiresApproval: true`. The pi-mono agent layer enforces this -- the action won't execute until the LLM explicitly approves it in the current turn.

```typescript
// Requires approval -- affects another user
{ name: "myapp.send_message", requiresApproval: true }

// No approval needed -- read-only observation
{ name: "myapp.get_inbox",    requiresApproval: false }
```

---

## Plugin Ideas -- Contributions Welcome

The following plugins would be valuable additions to the ecosystem:

### App Plugins

| App | Package Name |
|-----|-------------|
| Gmail | `com.google.android.gm` |
| Google Messages | `com.google.android.apps.messaging` |
| Instagram | `com.instagram.android` |
| X / Twitter | `com.twitter.android` |
| WhatsApp | `com.whatsapp` |
| Telegram | `org.telegram.messenger` |
| YouTube | `com.google.android.youtube` |
| Spotify | `com.spotify.music` |

### Android System Plugins

| Feature | Description |
|---------|-------------|
| Settings | Deep-link to any settings screen, toggle common options |
| Phone / Dialer | Make calls, manage contacts, check call log |
| Files / Storage | Navigate, copy, move, compress files |
| Google Play | Search, install, update apps |
| Notifications | Read, dismiss, act on notifications by app |
| Quick Settings | Toggle WiFi, BT, flashlight, DND from any context |
| Calendar | Create events, read agenda |

---

## Contributing

1. Pick a plugin idea or propose your own
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) -- understand the layer model
3. Open an issue before writing code (check it isn't already in progress)
4. Submit a PR with tests
5. Never put real credentials, device serials, or account data in committed files
