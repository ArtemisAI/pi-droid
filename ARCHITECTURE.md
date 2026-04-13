# Pi-Droid Architecture

## System Hierarchy

Pi-droid sits in a clear vertical stack. Each layer depends only on the layer
below it. Higher layers are optional — the system works with just the core.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   LAYER 3 — APP ADAPTORS  (infinite, community-contributed)         │
│                                                                     │
│   Downloadable plugins for specific apps. Each adaptor wraps an     │
│   external CLI or API and teaches the agent how one app works.      │
│                                                                     │
│   @pi-droid/plugin-*  — anyone can build and publish                │
│                                                                     │
│   Rule: App knowledge lives HERE only. Never in lower layers.       │
│         Package names, activity names, coordinates, rate limits,    │
│         approval gates — all scoped to the plugin.                  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   LAYER 2 — PI-DROID EXTENSION  (this package)                      │
│                                                                     │
│   The extension that bridges pi-agent to Android. Registers tools,  │
│   loads plugins, manages channels, routes input.                    │
│                                                                     │
│   src/index.ts          Extension entry point                       │
│   src/tools/            LLM-visible tool registrations (36 tools)   │
│   src/plugins/          Plugin loader, marketplace, CLI base class  │
│   src/notifications/    Approval queues, notification channels      │
│   skills/               SKILL.md files for capability discovery     │
│                                                                     │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                                                               │ │
│   │  LAYER 1 — ADB CORE  (app-agnostic device primitives)        │ │
│   │                                                               │ │
│   │  28 modules in src/adb/. Works on ANY Android device,        │ │
│   │  ANY app. Zero business logic. Two sub-categories:           │ │
│   │                                                               │ │
│   │  ESSENTIAL (OS-level, always available):                      │ │
│   │  ┌─────────────────────────────────────────────────────────┐ │ │
│   │  │ Screen      screenshot, annotate, UI tree, OCR          │ │ │
│   │  │ Input       tap, swipe, type, key events, gestures      │ │ │
│   │  │ Device      info, battery, network, orientation         │ │ │
│   │  │ Lock        status, set PIN/pattern, clear lock         │ │ │
│   │  │ Settings    wifi, bluetooth, brightness, volume, DND    │ │ │
│   │  │ Filesystem  push, pull, list, delete, storage info      │ │ │
│   │  │ Shell       raw command execution, process management   │ │ │
│   │  │ State       activity stack, keyboard, screen state      │ │ │
│   │  │ System      logcat, recording, preflight checks         │ │ │
│   │  └─────────────────────────────────────────────────────────┘ │ │
│   │                                                               │ │
│   │  AUTOMATION (compound operations, still app-agnostic):       │ │
│   │  ┌─────────────────────────────────────────────────────────┐ │ │
│   │  │ automation.ts   ensureReady, findAndTap, scrollToFind   │ │ │
│   │  │ device.ts       Device class — selector-based API       │ │ │
│   │  │ cache.ts        UI tree cache (2s TTL, auto-invalidate) │ │ │
│   │  │ stuck-detector  loop/stuck detection                    │ │ │
│   │  │ task-budget     step/time budget enforcement            │ │ │
│   │  └─────────────────────────────────────────────────────────┘ │ │
│   │                                                               │ │
│   │  Rule: If code references a specific app package name,       │ │
│   │        it does NOT belong here. Move it to Layer 3.          │ │
│   │                                                               │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   FOUNDATION — PI-AGENT CORE  (external dependency)                 │
│                                                                     │
│   @mariozechner/pi-agent-core   Agent runtime, LLM, memory         │
│   @mariozechner/pi-ai           AI/model layer                      │
│   @mariozechner/pi-coding-agent Extension API, tool registration    │
│                                                                     │
│   Pi-droid EXTENDS this. Never duplicates it.                       │
│   Memory, planning, identity, tool execution, event bus — all       │
│   provided by pi-agent. Pi-droid adds Android capabilities.         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   TRANSPORT — ADB SUBPROCESS                                        │
│                                                                     │
│   adb shell, adb pull, adb push — via child_process.execFile       │
│   USB or WiFi connection to the physical Android device             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### What belongs where -- decision guide

| I need to...                                  | Layer |
|-----------------------------------------------|-------|
| Tap a coordinate, take a screenshot           | 1 -- ADB Core |
| Check battery, toggle wifi, read notifications | 1 -- ADB Core |
| Lock/unlock the device, set a PIN             | 1 -- ADB Core |
| Push/pull files, manage storage               | 1 -- ADB Core |
| Register a tool the LLM can call              | 2 -- Extension |
| Load plugins from config/marketplace          | 2 -- Extension |
| Route input to the right tool automatically   | 2 -- Extension |
| Automate a specific app (Gmail, Uber, etc.)   | 3 -- App Adaptor |
| Add knowledge about an app's UI structure     | 3 -- App Adaptor |

### Essential vs. Downloadable

**Essential capabilities** (Layer 1) work on every Android device out of the box.
They correspond to what the OS provides natively -- the things you can do on any
phone regardless of what apps are installed:

- Screen interaction (tap, swipe, type)
- Device management (lock, unlock, settings, wifi)
- Filesystem (pre-installed file manager equivalent)
- System info (battery, network, processes)
- Browser (via intents -- `openUrl()`)

**Downloadable app adaptors** (Layer 3) teach the agent about specific apps.
Just as a user downloads an app from the Play Store, the agent downloads a
plugin from npm. The possibilities are infinite -- anyone can write a plugin
for any app:

```bash
# Install an app adaptor
pi install npm:@pi-droid/plugin-myapp

# Or build your own — see PLUGINS.md
```

Each adaptor is a separate npm package with its own:
- Package/activity name mappings
- Coordinate maps for that app's UI
- Rate limit awareness
- Approval gates for destructive actions
- CLI backend (can be written in any language)

---

## Design Philosophy

**Core rule: extend pi-agent, never duplicate it.** Features that pi-mono already
provides (memory, planning, identity, tool execution, event bus) should be used
via `ExtensionAPI`, not reimplemented. Features that serve Android automation
(channels, approval gates, skill definitions) belong here even if they touch
agent-level concerns.

Core principles:

- **Lean** -- minimal dependency surface; every module earns its place.
- **Language-agnostic plugins** -- plugins wrap external CLIs via subprocess,
  so the automated app logic can be written in any language.
- **Machine-readable** -- all tool output is JSON; UI trees are structured
  objects, not raw XML.
- **Multi-device ready** -- every ADB function accepts an optional serial.

---

## Source Map

```
src/
├── index.ts          # Extension entry point — registers tools, plugins, router
├── adb/              # LAYER 1: Generic ADB primitives (28 modules, all app-agnostic)
│   ├── types.ts      # All shared types — add here, not inline
│   ├── exec.ts       # adbShell(), AdbExecOptions — import for raw ADB
│   ├── input.ts      # tap(), swipe(), typeText(), keyEvent()
│   ├── screen-state.ts  # getScreenState(), waitForActivity()
│   ├── automation.ts    # High-level: findAndTap(), scrollToFind(), ensureReady()
│   ├── stuck-detector.ts # Loop/stuck detection for automation cycles
│   ├── task-budget.ts   # Opt-in step/time budget enforcement
│   ├── ocr.ts          # Tesseract OCR fallback for UI understanding
│   └── device.ts     # Device class — selector-based stateful API
├── plugins/          # LAYER 3: App-specific connector infrastructure
│   ├── interface.ts  # PiDroidPlugin — implement this interface
│   ├── cli-plugin.ts # CliPlugin base class — extend for CLI-backed apps
│   ├── loader.ts     # PluginManager + dynamic marketplace loading
│   ├── manifest.ts   # Plugin manifest schema + version compatibility
│   ├── marketplace.ts # npm-backed plugin install/remove/search
│   └── telegram.ts   # Telegram notification plugin
├── notifications/    # CROSS-CUTTING: Notification and approval infrastructure
│   ├── interface.ts  # NotificationChannel, ApprovalQueue interfaces
│   ├── approval-queue.ts # Timeout-based approval request management
│   └── telegram.ts   # Telegram bot notification channel
└── tools/            # LAYER 2: LLM tool registrations (thin — orchestrate, don't implement)
    ├── device.ts     # 32 ADB tools
    ├── android.ts    # 3 plugin tools
    └── router.ts     # deterministic input routing for common one-tool actions
```

---

## Data Flow: REACT Cycle

Pi-droid agents follow a **REACT cycle** (Reason + Act) extended with explicit
verification and branching.

```
PERCEIVE ──> EVALUATE ──> ACT ──> VERIFY ──> BRANCH
   ^                                            |
   └────────────── (loop) ─────────────────────┘
```

### Direct tool usage (Layer 1)

```
1. LOOK:   android_look tool
           -> takeScreenshot() + dumpUiTree() in parallel
           -> annotatedScreenshot() builds numbered element index
           -> returns text index + screenshot path to LLM

2. DECIDE: LLM reads the element index, sees:
           [3] Button: "Submit" -> tap(720, 2400)
           Agent decides to tap element 3

3. ACT:    android_tap { text: "Submit" }
           -> Device.tapElement({ text: "Submit" })
           -> fresh dumpUiTree() (cache was invalidated by prior action)
           -> findElement() locates the button
           -> tap(center.x, center.y) via adb shell
           -> cache invalidated again
```

### Plugin-mediated flows (Layer 3)

```
1. android_plugin_cycle { plugin: "myapp" }
2. MyAppPlugin.onHeartbeat()
   -> rate_limit check (CLI call)
   -> myapp.scrape  (CLI call -> external CLI scrape subcommand)
   -> myapp.evaluate (CLI call -> external CLI evaluate subcommand)
   -> myapp.act or myapp.skip (CLI call, destructive actions require approval)
3. Result returned as structured JSON
```

**Context budget per cycle:** ~400-800 tokens (normal), ~2500-5500 (with screenshot).
At 128K context, normal operation supports ~150 cycles before compression.

---

## ADB Module Inventory (28 modules)

All modules live in `src/adb/`. Each exports standalone functions that accept
`AdbExecOptions` (optional serial, timeout). The `Device` class wraps these
into a stateful, selector-based API.

| Module | Responsibility |
|--------|---------------|
| `types.ts` | All shared type definitions (UIElement, Bounds, selectors, etc.) |
| `index.ts` | Public API barrel file -- re-exports everything |
| `exec.ts` | `adb`/`adb shell` execution, error handling, `listDevices`, `isDeviceReady`, `getScreenSize` |
| `input.ts` | `tap`, `swipe`, `typeText`, `keyEvent`, `pressBack/Home/Enter`, `scrollDown/Up` -- with coordinate validation and shell escaping |
| `screenshot.ts` | `takeScreenshot`, `screenshotBase64`, screenshot directory config, temp file cleanup |
| `ui-tree.ts` | `dumpUiTree`, `findElements`, `findElement`, `waitForElement`, `summarizeTree`, XML entity decoding |
| `annotate.ts` | `annotatedScreenshot` -- numbered element index + optional SVG overlay |
| `cache.ts` | UI tree cache (2s TTL, auto-invalidate on input actions) |
| `app.ts` | `launchApp`, `stopApp`, `getAppInfo`, `listPackages`, `keepScreenOn`, `wakeScreen`, `isScreenOn` |
| `files.ts` | `pushFile`, `pullFile`, `listDir`, `deleteFile`, `getStorageInfo`, `fileExists` |
| `monitor.ts` | `getBatteryInfo`, `getNetworkInfo`, `getDeviceInfo`, `isScreenLocked`, `getRunningApps` |
| `intents.ts` | `readNotifications`, `getClipboard`, `setClipboard`, `sendIntent`, `openUrl`, `shareText`, `makeCall`, `sendSms` |
| `settings.ts` | WiFi, Bluetooth, airplane, brightness, volume, screen timeout, location, DND, auto-rotate |
| `shell.ts` | `executeShell`, `executeShellScript`, `getProcessList`, `killProcess`, `getMemoryInfo` |
| `screen-state.ts` | `getScreenState`, `getActivityStack`, `isKeyboardVisible`, `getOrientation`, `waitForActivity` |
| `recording.ts` | `startRecording`, `stopRecording`, `pullRecording`, `isRecording` |
| `wifi.ts` | `connectWifi`, `disconnectWifi`, `enableWifiAdb`, `getWifiIp`, `isWifiConnected`, `autoConnect` |
| `macros.ts` | `executeMacro`, `saveMacro`, `loadMacro`, `listMacros` |
| `preflight.ts` | `runPreflight` -- ADB connectivity, screen, ADBKeyboard, storage checks |
| `installer.ts` | `installApk`, `uninstallPackage`, `getPackageVersion`, `isPackageInstalled`, `getApkPath` |
| `logcat.ts` | `captureLogcat`, `searchLogcat`, `clearLogcat`, `getLogcatStats` |
| `lock.ts` | `getLockStatus`, `setPattern`, `setPin`, `clearLock` -- with input validation and shell escaping |
| `ocr.ts` | Tesseract OCR fallback for UI understanding |
| `stuck-detector.ts` | `DefaultStuckDetector` -- screen hash repetition + action signature loop detection |
| `task-budget.ts` | `createTaskBudget` -- opt-in step/time limits |
| `registry.ts` | `DeviceRegistry` -- multi-device register/discover/switch/refresh |
| `automation.ts` | High-level helpers: `ensureReady`, `observe`, `findAndTap`, `tapAndWait`, `typeIntoField`, `scrollToFind` |
| `device.ts` | `Device` class -- stateful wrapper with selector-based actions and coordinate fallback |

## Registered Tools (36 total)

Tools are registered via `pi.registerTool()` across three files:

- `tools/device.ts` -- 32 core ADB tools (perception, input, system, automation, lock)
- `tools/android.ts` -- 3 plugin tools (action, status, cycle)
- `index.ts` -- 1 discovery tool (android_skills)

**Perception**: `android_look`, `android_screenshot`, `android_ui_dump`, `android_ocr`, `android_observe`
**Input**: `android_tap`, `android_type`, `android_swipe`, `android_scroll`, `android_key`
**App/Nav**: `android_app`, `android_wait`, `android_wait_activity`
**System**: `android_device_info`, `android_screen_state`, `android_settings`, `android_processes`, `android_logcat`, `android_shell`
**Device Mgmt**: `android_devices`, `android_preflight`, `android_install`
**Lock**: `android_lock_status`, `android_lock_clear`, `android_lock_set_pattern`, `android_lock_set_pin`
**Recording/Connectivity**: `android_record`, `android_wifi`
**Automation**: `android_ensure_ready`, `android_find_and_tap`, `android_scroll_find`, `android_macro`
**Plugins**: `android_skills`, `android_plugin_action`, `android_plugin_status`, `android_plugin_cycle`

---

## Device Control Coverage

| Category | Coverage | Modules |
|----------|----------|---------|
| Input (tap/swipe/type/key) | 100% | input.ts |
| Perception (screenshot/UI/OCR) | 100% | screenshot.ts, ui-tree.ts, annotate.ts, ocr.ts |
| App lifecycle | 90% | app.ts, installer.ts |
| Filesystem | 85% | files.ts |
| Connectivity | 75% | wifi.ts, settings.ts |
| Device state | 70% | screen-state.ts, lock.ts, monitor.ts |
| Notifications/Clipboard | 100% / 70% | intents.ts |
| System info | 80% | monitor.ts, shell.ts |
| Health monitoring | 50% | stuck-detector.ts, task-budget.ts, preflight.ts |
| Terminal/shell | 40% | shell.ts |
| Camera/sensors | 0% | (intent workaround via intents.ts) |

Connection modes: **USB** (full support, zero config) and **WiFi ADB** (full
lifecycle via wifi.ts). Multi-device management via registry.ts.

---

## Key Architectural Decisions

### Why TypeScript

Pi-mono is TypeScript. Writing the extension in TS means native access to the
extension API (`ExtensionAPI`, `registerTool`, events), TypeBox schemas for
tool parameters, and shared types with the agent layer. No FFI boundary.

### Why subprocess ADB (not a library)

Pi-droid shells out to the `adb` binary via `child_process.execFile`. This was
the pragmatic first choice -- zero extra deps, works immediately if ADB is on
PATH, and the entire ADB surface is available without wrapping every feature.

**Tradeoff**: subprocess overhead (~10-30ms per call), shell escaping hazards,
no connection pooling. For high-frequency automation this adds up.

### Why plugins wrap CLIs

The plugin system wraps external CLI tools via subprocess. This keeps app-specific
automation in whatever language it was already written in. Pi-droid does not
reimplement scraping or LLM evaluation -- it orchestrates.

**Benefit**: Any language can be a plugin backend. A Rust CLI, a Go binary, or
a Python tool all work the same way through `CliPlugin`.

### Why selector-based actions with coordinate fallback

`Device.tapElement()` dumps the UI tree, finds the element by selector (text,
resourceId, className), and taps its center. This is resilient to layout shifts
between devices or screen sizes.

Coordinate fallback (`Device.tap(x, y)`) exists because some elements lack
selectors (custom-drawn views, game UIs, WebViews). The LLM can read the
annotated screenshot index and fall back to coordinates when needed.

### Why UI tree caching

`uiautomator dump` costs 500-1000ms. The cache (`cache.ts`) stores the last
tree for 2 seconds and auto-invalidates on any input action (tap, swipe, type).
This means `android_look` followed by `android_tap` in the same turn reuses
the dump instead of waiting another second.

### Why annotated screenshots

LLMs cannot reliably parse raw UI XML. `annotate.ts` captures a screenshot and
UI dump in parallel, then generates a numbered text index:

```
[0] Button: "Submit" -> tap(720, 2400)
[1] TextView: "Weather: 72F" -> tap(720, 800) [focusable]
```

The LLM reads the index, picks an element number, and the agent taps its
coordinates. The SVG overlay generator exists for visual debugging but the text
index alone is sufficient for LLM perception.

---

## Extension Points

### Adding a new app adaptor (Layer 3)

1. Create a new npm package.
2. Extend `CliPlugin` (or implement `PiDroidPlugin` directly for non-CLI backends).
3. Define capabilities array and command map.
4. Publish to npm.
5. Users install with: `pi install npm:@pi-droid/plugin-myapp`
6. The plugin auto-loads on session start and appears in `android_skills`.

See [PLUGINS.md](./PLUGINS.md) for the full development guide.

### Adding a new ADB capability (Layer 1)

1. Create `src/adb/newfeature.ts` with functions accepting `AdbExecOptions`.
2. Export from `src/adb/index.ts`.
3. Add methods to `Device` class if it warrants a high-level API.
4. Optionally register a pi-mono tool in `src/tools/device.ts`.
5. Write tests in `tests/adb/newfeature.test.ts`.

### Adding a new tool (Layer 2)

Register via `pi.registerTool()` in either `tools/device.ts` (for ADB-level
tools) or `tools/android.ts` (for plugin-level tools). Use TypeBox for
parameter schemas. Return `{ content: [{ type: "text", text: JSON }] }`.

---

## Dependency Audit

### Runtime Dependencies (peerDependencies)

| Dependency | Version | Assessment |
|-----------|---------|------------|
| `@mariozechner/pi-agent-core` | * | Required. Pi-mono runtime. |
| `@mariozechner/pi-ai` | * | Required. Pi-mono AI layer. |
| `@mariozechner/pi-coding-agent` | * | Required. Extension types (`ExtensionAPI`). |
| `@sinclair/typebox` | * | Zero-dep JSON schema builder, used by pi-mono. |

### System Requirements (Host Binaries)

| Binary | Purpose | Install |
|--------|---------|---------|
| `adb` | Android device control and shell execution | Android platform-tools |
| `tesseract` | OCR fallback when UI dumps are empty/partial | `apt install tesseract-ocr` |

---

## Test Coverage

Tests in `tests/`, mirroring `src/` structure:

| Category | Test Files | Coverage |
|----------|-----------|----------|
| `adb/` | 26 files | All 28 ADB modules |
| `plugins/` | 4 files | cli-plugin, loader, manifest, marketplace |
| `notifications/` | 2 files | approval-queue, telegram channel |
| `tools/` | 1 file | router (deterministic input routing) |
| `integration/` | 4 files | extension-load, sandbox-install, device-e2e, agent-device |

Every `src/adb/` module has a corresponding test file. Unit tests use
`vi.spyOn` to mock `adbShell` -- no real ADB processes are spawned. Device E2E
tests (`tests/integration/device-e2e.test.ts`) run against a real connected
device and skip gracefully when no device is available.
