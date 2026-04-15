# Pi-Droid — Copilot Instructions

## Project Overview

Pi-Droid is a pi-coding-agent extension that provides 36 LLM-visible tools for Android device automation via ADB. It's a TypeScript npm package published as `pi-droid`.

## Architecture

Three-layer system (see ARCHITECTURE.md):

- **Layer 1 — ADB Core** (`src/adb/`): 28 modules of app-agnostic device primitives. All accept `AdbExecOptions` (optional serial, timeout).
- **Layer 2 — Extension** (`src/tools/`, `src/index.ts`): Tool registrations, plugin loader, input routing.
- **Layer 3 — App Adaptors** (plugins): Community-contributed, npm packages.

**Rule**: If code references a specific app package name, it does NOT belong in Layer 1 or 2. Move to Layer 3.

## Tech Stack

- TypeScript 5.6+, ES2022, ESNext modules
- Node.js >= 20
- No runtime npm dependencies — all `peerDependencies` (pi-mono packages + typebox)
- ADB commands via `child_process.execFile("adb", ...)` — never `exec()` or `spawn()` for security
- TypeBox (`@sinclair/typebox`) for tool parameter schemas
- Vitest for testing

## Code Style

- All ADB modules export standalone functions (not classes, except `Device`)
- All ADB functions accept `AdbExecOptions = { serial?: string; timeout?: number }`
- Serial targeting: `-s <serial>` is prepended in `exec.ts` automatically
- WiFi devices identified by colon in serial (e.g., `192.168.1.42:5555`)
- Tool return format: `{ content: [{ type: "text", text: JSON.stringify(result) }], details: {} }`
- No emojis in code or comments

## Testing Patterns

```typescript
// Standard mock pattern (see tests/adb/*.test.ts)
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
import { execFile } from "node:child_process";
const mockExecFile = vi.mocked(execFile);

// Mock sequential responses
mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
  const cb = typeof _opts === "function" ? _opts : callback;
  cb(null, { stdout: "expected output", stderr: "" });
  return {} as any;
});
```

- All `src/adb/` modules have matching `tests/adb/` test files
- Unit tests mock `execFile` — no real ADB process spawned
- Integration tests in `tests/integration/` use the test harness
- Device E2E tests skip gracefully when no device connected

## Commands

```bash
npm run lint          # Type-check (tsc --noEmit) — MUST pass
npm run build         # Compile to dist/
npm run test:ci       # Unit + integration tests (no device needed) — MUST pass
npm run test          # All tests including device E2E
npm run test:unit     # ADB/plugin/notification/tool unit tests only
```

## Key Files

| File | Purpose |
|------|---------|
| `src/adb/exec.ts` | Core ADB execution: `adb()`, `adbShell()`, `listDevices()`, `isDeviceReady()` |
| `src/adb/types.ts` | All shared type definitions |
| `src/adb/wifi.ts` | WiFi ADB: connect, disconnect, enableWifiAdb, autoConnect |
| `src/adb/device.ts` | `Device` class wrapping all ADB primitives |
| `src/adb/registry.ts` | Multi-device registry |
| `src/tools/device.ts` | 32 ADB tool registrations |
| `src/tools/android.ts` | 3 plugin tool registrations |
| `src/tools/router.ts` | Deterministic input routing |
| `src/index.ts` | Extension entry point, re-exports |
| `src/plugins/` | Plugin system (CliPlugin, loader, marketplace) |

## Extension API

Tools are registered via `pi.registerTool()`:
```typescript
pi.registerTool({
  name: "android_example",
  label: "Example Tool",
  description: "What this tool does",
  parameters: Type.Object({ /* TypeBox schema */ }),
  async execute(_id, args) {
    // Implementation
    return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
  },
});
```

Events available on `ExtensionAPI`:
- `session_start` — Initialize tools, load config
- `session_shutdown` — Cleanup
- `input` — Route user input
- `turn_end` — Update status

## PR Checklist

Before submitting:
1. `npm run lint` passes with zero errors
2. `npm run test:ci` passes (all 473+ tests)
3. New code has corresponding test file
4. No new runtime dependencies added
5. Re-exports added to `src/adb/index.ts` and `src/index.ts` if adding public API
6. Tool parameters use TypeBox schemas, not raw JSON
