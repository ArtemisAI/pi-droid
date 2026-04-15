/**
 * Core device tools — direct ADB operations registered as pi-mono tools.
 *
 * These are always available regardless of plugins. They give the LLM
 * direct control over the connected Android device.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Device } from "../adb/index.js";
import { DeviceRegistry } from "../adb/registry.js";
import { annotatedScreenshot } from "../adb/annotate.js";
import { getBatteryInfo, getNetworkInfo, getDeviceInfo } from "../adb/monitor.js";
import { startRecording, stopRecording, pullRecording, isRecording } from "../adb/recording.js";
import { connectWifi, disconnectWifi, autoConnect } from "../adb/wifi.js";
import { executeMacro, loadMacro, listMacros, saveMacro } from "../adb/macros.js";
import { runPreflight } from "../adb/preflight.js";
import { captureLogcat, searchLogcat, clearLogcat } from "../adb/logcat.js";
import { installApk, uninstallPackage, getPackageVersion, isPackageInstalled } from "../adb/installer.js";
import {
  setWifiEnabled, setBluetoothEnabled, setAirplaneMode,
  setBrightness, getBrightness, setVolume, getVolume,
  setScreenTimeout, setLocationEnabled, setDoNotDisturb,
  setAutoRotate, getSetting, putSetting,
  type VolumeStream, type SettingsNamespace,
} from "../adb/settings.js";
import { executeShell, getProcessList, killProcess, getMemoryInfo } from "../adb/shell.js";
import { ensureReady, observe, findAndTap, scrollToFind } from "../adb/automation.js";
import { getScreenState, getActivityStack, waitForActivity } from "../adb/screen-state.js";
import { runOcrOnCurrentScreen, runOcrOnImage } from "../adb/ocr.js";
import { getLockStatus, clearLock, setPattern, setPin } from "../adb/lock.js";
import type { GestureMacro } from "../adb/types.js";

const registry = new DeviceRegistry();
let cachedDevice: Device | null = null;

async function getDevice(serial?: string): Promise<Device> {
  // Try registry first, fall back to direct connection
  if (registry.size > 0) {
    try {
      return await registry.getActive();
    } catch {
      // Fall through to direct connection
    }
  }
  if (cachedDevice) return cachedDevice;
  cachedDevice = await Device.connect(serial);
  return cachedDevice;
}

export function registerDeviceTools(pi: ExtensionAPI, adbConfig: Record<string, unknown>): void {
  const defaultSerial = (adbConfig.serial as string | undefined) || process.env.ANDROID_SERIAL || undefined;

  pi.registerTool({
    name: "android_screenshot",
    label: "Screenshot",
    description: "Take a screenshot of the Android device screen. Returns the file path and optionally base64 data.",
    parameters: Type.Object({
      include_base64: Type.Optional(Type.Boolean({ description: "Include base64-encoded image data in response" })),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      const result = await device.screenshot({ includeBase64: args.include_base64 });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_ui_dump",
    label: "UI Dump",
    description:
      "Dump the current UI hierarchy. Returns interactive elements with their text, coordinates, and properties. " +
      "Use this before tapping to get fresh element positions.",
    parameters: Type.Object({}),
    async execute() {
      const device = await getDevice(defaultSerial);
      const summary = await device.describeScreen();
      return { content: [{ type: "text", text: summary }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_ocr",
    label: "OCR Text Extraction",
    description:
      "Run OCR text detection on the current screen (or a provided screenshot path). " +
      "Returns UI-style elements with bounding boxes and confidence values.",
    parameters: Type.Object({
      screenshot_path: Type.Optional(Type.String({ description: "Optional local screenshot file path" })),
      confidence_threshold: Type.Optional(Type.Number({ description: "Minimum OCR confidence (0-100, default 50)" })),
    }),
    async execute(_id, args) {
      try {
        const result = args.screenshot_path
          ? await runOcrOnImage(args.screenshot_path, { confidenceThreshold: args.confidence_threshold })
          : await runOcrOnCurrentScreen({ serial: defaultSerial, confidenceThreshold: args.confidence_threshold });
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
      } catch (err) {
        const msg = (err as Error).message;
        return { content: [{ type: "text", text: JSON.stringify({ error: msg, suggestion: "Install Tesseract with: apt install tesseract-ocr" }) }], details: {} };
      }
    },
  });

  pi.registerTool({
    name: "android_tap",
    label: "Tap",
    description: "Tap at screen coordinates or on an element matching a selector.",
    parameters: Type.Object({
      x: Type.Optional(Type.Number({ description: "X coordinate" })),
      y: Type.Optional(Type.Number({ description: "Y coordinate" })),
      text: Type.Optional(Type.String({ description: "Tap element containing this text" })),
      resource_id: Type.Optional(Type.String({ description: "Tap element with this resource ID" })),
      long_press_ms: Type.Optional(Type.Number({ description: "Hold duration for long press (ms)" })),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      if (args.text || args.resource_id) {
        const el = await device.tapElement(
          { text: args.text, resourceId: args.resource_id },
          { duration: args.long_press_ms },
        );
        return { content: [{ type: "text", text: JSON.stringify({ tapped: el.text || el.resourceId, center: el.center }) }], details: {} };
      }
      if (args.x !== undefined && args.y !== undefined) {
        await device.tap(args.x, args.y, { duration: args.long_press_ms });
        return { content: [{ type: "text", text: JSON.stringify({ tapped: { x: args.x, y: args.y } }) }], details: {} };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: "Provide x/y coordinates or text/resource_id selector" }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_type",
    label: "Type Text",
    description: "Type text on the device. Uses ADBKeyboard for Unicode support.",
    parameters: Type.Object({
      text: Type.String({ description: "Text to type" }),
      clear_first: Type.Optional(Type.Boolean({ description: "Clear existing text before typing" })),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      await device.typeText(args.text, { clear: args.clear_first });
      return { content: [{ type: "text", text: JSON.stringify({ typed: args.text }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_swipe",
    label: "Swipe",
    description: "Swipe gesture on the device. Use for scrolling or directional gestures.",
    parameters: Type.Object({
      x1: Type.Number({ description: "Start X" }),
      y1: Type.Number({ description: "Start Y" }),
      x2: Type.Number({ description: "End X" }),
      y2: Type.Number({ description: "End Y" }),
      duration_ms: Type.Optional(Type.Number({ description: "Swipe duration in ms (default: 300)" })),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      await device.swipe(args.x1, args.y1, args.x2, args.y2, { duration: args.duration_ms });
      return { content: [{ type: "text", text: JSON.stringify({ swiped: { from: [args.x1, args.y1], to: [args.x2, args.y2] } }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_scroll",
    label: "Scroll",
    description: "Scroll the screen up or down.",
    parameters: Type.Object({
      direction: Type.Union([Type.Literal("up"), Type.Literal("down")], { description: "Scroll direction" }),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      if (args.direction === "down") await device.scrollDown();
      else await device.scrollUp();
      return { content: [{ type: "text", text: JSON.stringify({ scrolled: args.direction }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_key",
    label: "Key Event",
    description: "Send a key event (back, home, enter, or any Android keycode).",
    parameters: Type.Object({
      key: Type.String({ description: "Key name: 'back', 'home', 'enter', or KEYCODE_* constant" }),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      switch (args.key.toLowerCase()) {
        case "back": await device.back(); break;
        case "home": await device.home(); break;
        case "enter": await device.enter(); break;
        default: await device.keyEvent(args.key);
      }
      return { content: [{ type: "text", text: JSON.stringify({ key: args.key }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_app",
    label: "App Control",
    description: "Launch, stop, or check status of an Android app by package name.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("launch"), Type.Literal("stop"), Type.Literal("status")],
        { description: "Action to perform" },
      ),
      package: Type.String({ description: "Android package name (e.g., com.example.myapp)" }),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      switch (args.action) {
        case "launch":
          await device.launchApp(args.package);
          return { content: [{ type: "text", text: JSON.stringify({ launched: args.package }) }], details: {} };
        case "stop":
          await device.stopApp(args.package);
          return { content: [{ type: "text", text: JSON.stringify({ stopped: args.package }) }], details: {} };
        case "status": {
          const info = await device.getAppInfo(args.package);
          return { content: [{ type: "text", text: JSON.stringify(info) }], details: {} };
        }
      }
    },
  });

  pi.registerTool({
    name: "android_wait",
    label: "Wait for Element",
    description: "Wait for a UI element matching a selector to appear on screen. Returns the element when found, or null on timeout.",
    parameters: Type.Object({
      text: Type.Optional(Type.String({ description: "Wait for element containing this text" })),
      resource_id: Type.Optional(Type.String({ description: "Wait for element with this resource ID" })),
      timeout_ms: Type.Optional(Type.Number({ description: "Timeout in ms (default: 10000)" })),
    }),
    async execute(_id, args) {
      const device = await getDevice(defaultSerial);
      const el = await device.waitForElement(
        { text: args.text, resourceId: args.resource_id },
        { timeout: args.timeout_ms },
      );
      if (el) {
        return { content: [{ type: "text", text: JSON.stringify({ found: true, text: el.text, center: el.center, bounds: el.bounds }) }], details: {} };
      }
      return { content: [{ type: "text", text: JSON.stringify({ found: false, timeout: true }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_look",
    label: "Look at Screen",
    description:
      "Take an annotated screenshot — captures the screen and UI tree in parallel, " +
      "returns a numbered list of interactive elements with their coordinates. " +
      "Use element numbers to decide what to tap. This is the primary perception tool.",
    parameters: Type.Object({
      include_image: Type.Optional(Type.Boolean({ description: "Include base64 screenshot in response" })),
      all_elements: Type.Optional(Type.Boolean({ description: "Include non-interactive elements too" })),
    }),
    async execute(_id, args) {
      const result = await annotatedScreenshot({
        serial: defaultSerial,
        includeBase64: args.include_image,
        allElements: args.all_elements,
      });
      const response: Record<string, unknown> = {
        screenshot: result.screenshotPath,
        foreground: result.foregroundPackage,
        elements: result.count,
        index: result.textIndex,
      };
      if (result.screenshotBase64) {
        response.image_base64 = result.screenshotBase64;
      }
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], details: {} };
    },
  });

  // --- Device monitoring ---

  pi.registerTool({
    name: "android_device_info",
    label: "Device Info",
    description: "Get device health — battery, network, and hardware info.",
    parameters: Type.Object({
      what: Type.Optional(
        Type.Union(
          [Type.Literal("all"), Type.Literal("battery"), Type.Literal("network"), Type.Literal("device")],
          { description: "What info to get (default: all)" },
        ),
      ),
    }),
    async execute(_id, args) {
      const opts = { serial: defaultSerial };
      const what = args.what ?? "all";
      const result: Record<string, unknown> = {};
      if (what === "all" || what === "battery") result.battery = await getBatteryInfo(opts);
      if (what === "all" || what === "network") result.network = await getNetworkInfo(opts);
      if (what === "all" || what === "device") result.device = await getDeviceInfo(opts);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- Screen recording ---

  pi.registerTool({
    name: "android_record",
    label: "Screen Record",
    description: "Start, stop, or pull a screen recording from the device.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("start"), Type.Literal("stop"), Type.Literal("pull"), Type.Literal("status")],
        { description: "Recording action" },
      ),
      max_seconds: Type.Optional(Type.Number({ description: "Max recording duration in seconds (default: 180)" })),
    }),
    async execute(_id, args) {
      const opts = { serial: defaultSerial };
      switch (args.action) {
        case "start": {
          const path = await startRecording({ ...opts, maxDuration: args.max_seconds });
          return { content: [{ type: "text", text: JSON.stringify({ recording: true, remotePath: path }) }], details: {} };
        }
        case "stop":
          await stopRecording(opts);
          return { content: [{ type: "text", text: JSON.stringify({ recording: false }) }], details: {} };
        case "pull": {
          const local = await pullRecording(undefined, opts);
          return { content: [{ type: "text", text: JSON.stringify({ pulled: local }) }], details: {} };
        }
        case "status": {
          const active = await isRecording(opts);
          return { content: [{ type: "text", text: JSON.stringify({ recording: active }) }], details: {} };
        }
      }
    },
  });

  // --- WiFi ADB ---

  pi.registerTool({
    name: "android_wifi",
    label: "WiFi ADB",
    description: "Manage WiFi ADB connections — connect, disconnect, or auto-setup wireless.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("connect"), Type.Literal("disconnect"), Type.Literal("auto")],
        { description: "WiFi action" },
      ),
      host: Type.Optional(Type.String({ description: "Device IP for connect/disconnect" })),
      port: Type.Optional(Type.Number({ description: "ADB port (default: 5555)" })),
    }),
    async execute(_id, args) {
      switch (args.action) {
        case "connect": {
          if (!args.host) return { content: [{ type: "text", text: JSON.stringify({ error: "host required" }) }], details: {} };
          const result = await connectWifi(args.host, args.port);
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
        case "disconnect": {
          if (!args.host) return { content: [{ type: "text", text: JSON.stringify({ error: "host required" }) }], details: {} };
          await disconnectWifi(args.host, args.port);
          return { content: [{ type: "text", text: JSON.stringify({ disconnected: true }) }], details: {} };
        }
        case "auto": {
          const result = await autoConnect({ serial: defaultSerial });
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
      }
    },
  });

  // --- Gesture macros ---

  pi.registerTool({
    name: "android_macro",
    label: "Gesture Macro",
    description: "Run, save, or list gesture macros — reusable sequences of tap/swipe/type/key actions.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("run"), Type.Literal("list"), Type.Literal("save")],
        { description: "Macro action" },
      ),
      name: Type.Optional(Type.String({ description: "Macro name (for run/save)" })),
      macro: Type.Optional(Type.String({ description: "JSON macro definition (for save)" })),
      dir: Type.Optional(Type.String({ description: "Macros directory (default: /tmp/pi-droid/macros)" })),
    }),
    async execute(_id, args) {
      const dir = args.dir ?? "/tmp/pi-droid/macros";
      const opts = { serial: defaultSerial };
      switch (args.action) {
        case "list": {
          const macros = await listMacros(dir);
          return { content: [{ type: "text", text: JSON.stringify({ macros }) }], details: {} };
        }
        case "run": {
          if (!args.name) return { content: [{ type: "text", text: JSON.stringify({ error: "name required" }) }], details: {} };
          const macro = await loadMacro(args.name, dir);
          await executeMacro(macro);
          return { content: [{ type: "text", text: JSON.stringify({ executed: args.name, steps: macro.steps.length }) }], details: {} };
        }
        case "save": {
          if (!args.macro) return { content: [{ type: "text", text: JSON.stringify({ error: "macro JSON required" }) }], details: {} };
          const macro: GestureMacro = JSON.parse(args.macro);
          await saveMacro(macro, dir);
          return { content: [{ type: "text", text: JSON.stringify({ saved: macro.name }) }], details: {} };
        }
      }
    },
  });

  // --- Preflight check ---

  pi.registerTool({
    name: "android_preflight",
    label: "Preflight Check",
    description:
      "Run preflight checks on the device — verifies ADB connectivity, screen state, " +
      "ADBKeyboard installed, storage, and more. Call before starting automation to ensure readiness.",
    parameters: Type.Object({}),
    async execute() {
      const result = await runPreflight({ serial: defaultSerial });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: {} };
    },
  });

  // --- Multi-device management ---

  // Auto-register the default device if configured
  if (defaultSerial) {
    registry.register("default", defaultSerial);
  }

  pi.registerTool({
    name: "android_devices",
    label: "Device Manager",
    description:
      "Manage multiple Android devices — discover connected devices, register with aliases, " +
      "switch active device. All other android_* tools operate on the active device.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("list"),
          Type.Literal("discover"),
          Type.Literal("switch"),
          Type.Literal("register"),
          Type.Literal("unregister"),
          Type.Literal("refresh"),
        ],
        { description: "Device management action" },
      ),
      alias: Type.Optional(Type.String({ description: "Device alias (for switch/register/unregister)" })),
      serial: Type.Optional(Type.String({ description: "ADB serial (for register)" })),
    }),
    async execute(_id, args) {
      switch (args.action) {
        case "list": {
          const devices = registry.list().map((d) => ({
            alias: d.alias,
            serial: d.serial,
            active: d.alias === registry.getActiveAlias(),
            connected: d.info?.state === "device",
            model: d.info?.model,
            transport: d.info?.transport,
          }));
          return { content: [{ type: "text", text: JSON.stringify({ devices, active: registry.getActiveAlias() }) }], details: {} };
        }
        case "discover": {
          const newDevices = await registry.discover();
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                discovered: newDevices.length,
                new: newDevices.map((d) => ({ alias: d.alias, serial: d.serial })),
                total: registry.size,
                active: registry.getActiveAlias(),
              }),
            }],
            details: {},
          };
        }
        case "switch": {
          if (!args.alias) return { content: [{ type: "text", text: JSON.stringify({ error: "alias required" }) }], details: {} };
          registry.setActive(args.alias);
          // Clear cached device so getDevice() picks up the new active
          cachedDevice = null;
          return { content: [{ type: "text", text: JSON.stringify({ active: args.alias }) }], details: {} };
        }
        case "register": {
          if (!args.alias || !args.serial) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "alias and serial required" }) }], details: {} };
          }
          const entry = registry.register(args.alias, args.serial);
          return { content: [{ type: "text", text: JSON.stringify({ registered: entry.alias, serial: entry.serial }) }], details: {} };
        }
        case "unregister": {
          if (!args.alias) return { content: [{ type: "text", text: JSON.stringify({ error: "alias required" }) }], details: {} };
          const removed = registry.unregister(args.alias);
          return { content: [{ type: "text", text: JSON.stringify({ unregistered: args.alias, found: removed }) }], details: {} };
        }
        case "refresh": {
          const status = await registry.refresh();
          return { content: [{ type: "text", text: JSON.stringify(status) }], details: {} };
        }
      }
    },
  });

  // --- System settings ---

  pi.registerTool({
    name: "android_settings",
    label: "System Settings",
    description:
      "Control device system settings — WiFi, Bluetooth, brightness, volume, location, " +
      "airplane mode, DND, auto-rotate, screen timeout. Also read/write arbitrary settings.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("set"), Type.Literal("get")],
        { description: "Set or get a setting" },
      ),
      setting: Type.String({
        description:
          "Setting to control: wifi, bluetooth, airplane, brightness, volume, " +
          "screen_timeout, location, dnd, auto_rotate, or namespace:key (e.g. global:zen_mode)",
      }),
      value: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: "Value to set" })),
      stream: Type.Optional(Type.String({ description: "Volume stream: music, ring, notification, alarm, system" })),
    }),
    async execute(_id, args) {
      const opts = { serial: defaultSerial };
      const s = args.setting;

      if (args.action === "set") {
        switch (s) {
          case "wifi":
            await setWifiEnabled(!!args.value && args.value !== "false" && args.value !== 0, opts);
            break;
          case "bluetooth":
            await setBluetoothEnabled(!!args.value && args.value !== "false" && args.value !== 0, opts);
            break;
          case "airplane":
            await setAirplaneMode(!!args.value && args.value !== "false" && args.value !== 0, opts);
            break;
          case "brightness":
            await setBrightness(typeof args.value === "number" ? args.value : parseInt(String(args.value)) || 128, opts);
            break;
          case "volume":
            await setVolume(
              (args.stream ?? "music") as VolumeStream,
              typeof args.value === "number" ? args.value : parseInt(String(args.value)) || 7,
              opts,
            );
            break;
          case "screen_timeout":
            await setScreenTimeout(typeof args.value === "number" ? args.value : parseInt(String(args.value)) || 30000, opts);
            break;
          case "location":
            await setLocationEnabled(!!args.value && args.value !== "false" && args.value !== 0, opts);
            break;
          case "dnd":
            await setDoNotDisturb(!!args.value && args.value !== "false" && args.value !== 0, opts);
            break;
          case "auto_rotate":
            await setAutoRotate(!!args.value && args.value !== "false" && args.value !== 0, opts);
            break;
          default: {
            // namespace:key format
            const [ns, key] = s.split(":");
            if (ns && key) {
              await putSetting(ns as SettingsNamespace, key, args.value ?? "", opts);
            } else {
              return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown setting: ${s}` }) }], details: {} };
            }
          }
        }
        return { content: [{ type: "text", text: JSON.stringify({ set: s, value: args.value }) }], details: {} };
      }

      // GET
      switch (s) {
        case "brightness": {
          const b = await getBrightness(opts);
          return { content: [{ type: "text", text: JSON.stringify(b) }], details: {} };
        }
        case "volume": {
          const v = await getVolume((args.stream ?? "music") as VolumeStream, opts);
          return { content: [{ type: "text", text: JSON.stringify({ stream: args.stream ?? "music", volume: v }) }], details: {} };
        }
        default: {
          const [ns, key] = s.split(":");
          if (ns && key) {
            const val = await getSetting(ns as SettingsNamespace, key, opts);
            return { content: [{ type: "text", text: JSON.stringify({ key: s, value: val }) }], details: {} };
          }
          return { content: [{ type: "text", text: JSON.stringify({ error: `Use namespace:key for get (e.g. system:screen_brightness)` }) }], details: {} };
        }
      }
    },
  });

  // --- Logcat ---

  pi.registerTool({
    name: "android_logcat",
    label: "Logcat",
    description:
      "Capture or search device logs. Use for debugging app crashes, monitoring events, " +
      "or finding error messages.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("capture"), Type.Literal("search"), Type.Literal("clear")],
        { description: "Logcat action" },
      ),
      filter: Type.Optional(Type.String({ description: "Tag:priority filter (e.g. 'ActivityManager:I')" })),
      pattern: Type.Optional(Type.String({ description: "Regex pattern to search for" })),
      lines: Type.Optional(Type.Number({ description: "Number of lines (default: 200 for capture, 1000 for search)" })),
      duration_ms: Type.Optional(Type.Number({ description: "Capture duration in ms (default: 5000)" })),
    }),
    async execute(_id, args) {
      const opts = { serial: defaultSerial };
      switch (args.action) {
        case "capture": {
          const result = await captureLogcat({
            ...opts,
            duration: args.duration_ms,
            filter: args.filter,
            maxLines: args.lines,
          });
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
        case "search": {
          if (!args.pattern) return { content: [{ type: "text", text: JSON.stringify({ error: "pattern required" }) }], details: {} };
          const results = await searchLogcat(args.pattern, { ...opts, lines: args.lines });
          return { content: [{ type: "text", text: JSON.stringify({ matches: results.length, lines: results }) }], details: {} };
        }
        case "clear": {
          await clearLogcat(opts);
          return { content: [{ type: "text", text: JSON.stringify({ cleared: true }) }], details: {} };
        }
      }
    },
  });

  // --- APK installer ---

  pi.registerTool({
    name: "android_install",
    label: "APK Manager",
    description:
      "Install, uninstall, or check APK packages on the device.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("install"), Type.Literal("uninstall"), Type.Literal("version"), Type.Literal("check")],
        { description: "Install action" },
      ),
      package: Type.Optional(Type.String({ description: "Package name (for uninstall/version/check)" })),
      apk_path: Type.Optional(Type.String({ description: "Local APK file path (for install)" })),
    }),
    async execute(_id, args) {
      const opts = { serial: defaultSerial };
      switch (args.action) {
        case "install": {
          if (!args.apk_path) return { content: [{ type: "text", text: JSON.stringify({ error: "apk_path required" }) }], details: {} };
          const result = await installApk(args.apk_path, opts);
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
        case "uninstall": {
          if (!args.package) return { content: [{ type: "text", text: JSON.stringify({ error: "package required" }) }], details: {} };
          const result = await uninstallPackage(args.package, opts);
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
        }
        case "version": {
          if (!args.package) return { content: [{ type: "text", text: JSON.stringify({ error: "package required" }) }], details: {} };
          const ver = await getPackageVersion(args.package, opts);
          return { content: [{ type: "text", text: JSON.stringify(ver ?? { installed: false }) }], details: {} };
        }
        case "check": {
          if (!args.package) return { content: [{ type: "text", text: JSON.stringify({ error: "package required" }) }], details: {} };
          const installed = await isPackageInstalled(args.package, opts);
          return { content: [{ type: "text", text: JSON.stringify({ package: args.package, installed }) }], details: {} };
        }
      }
    },
  });

  // --- Shell command execution ---

  pi.registerTool({
    name: "android_shell",
    label: "Shell Command",
    description:
      "Execute a shell command on the Android device. This is the escape hatch for " +
      "anything not covered by specific tools. Returns stdout, exit code, and duration.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      timeout_ms: Type.Optional(Type.Number({ description: "Timeout in ms (default: 30000)" })),
    }),
    async execute(_id, args) {
      const result = await executeShell(args.command, {
        serial: defaultSerial,
        timeout: args.timeout_ms,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });

  // --- Process management ---

  pi.registerTool({
    name: "android_processes",
    label: "Process Manager",
    description:
      "List running processes, kill processes, or check memory usage on the device.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("list"), Type.Literal("kill"), Type.Literal("memory")],
        { description: "Process action" },
      ),
      pid: Type.Optional(Type.Number({ description: "Process ID (for kill)" })),
      filter: Type.Optional(Type.String({ description: "Filter process names (substring match)" })),
    }),
    async execute(_id, args) {
      const opts = { serial: defaultSerial };
      switch (args.action) {
        case "list": {
          let procs = await getProcessList(opts);
          if (args.filter) {
            const f = args.filter.toLowerCase();
            procs = procs.filter((p) => p.name.toLowerCase().includes(f));
          }
          return { content: [{ type: "text", text: JSON.stringify({ count: procs.length, processes: procs }) }], details: {} };
        }
        case "kill": {
          if (!args.pid) return { content: [{ type: "text", text: JSON.stringify({ error: "pid required" }) }], details: {} };
          const killed = await killProcess(args.pid, opts);
          return { content: [{ type: "text", text: JSON.stringify({ killed: args.pid, success: killed }) }], details: {} };
        }
        case "memory": {
          const mem = await getMemoryInfo(opts);
          return { content: [{ type: "text", text: JSON.stringify(mem) }], details: {} };
        }
      }
    },
  });

  // --- Automation helpers ---

  pi.registerTool({
    name: "android_ensure_ready",
    label: "Ensure Ready",
    description:
      "Wake the device, dismiss lock screen, and optionally launch an app. " +
      "Call at the start of any automation sequence.",
    parameters: Type.Object({
      package: Type.Optional(Type.String({ description: "App package to launch (optional)" })),
    }),
    async execute(_id, args) {
      const result = await ensureReady({ serial: defaultSerial, packageName: args.package });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_observe",
    label: "Observe Screen",
    description:
      "Take a screenshot and dump UI tree in parallel — the fundamental 'look' operation. " +
      "Returns foreground app, interactive elements, and screenshot path.",
    parameters: Type.Object({
      include_image: Type.Optional(Type.Boolean({ description: "Include base64 screenshot" })),
    }),
    async execute(_id, args) {
      const result = await observe({ serial: defaultSerial, includeBase64: args.include_image });
      const response = {
        screenshot: result.screenshot.path,
        foreground: result.foregroundPackage,
        interactiveCount: result.interactiveElements.length,
        elements: result.interactiveElements.map((e) => ({
          text: e.text || e.contentDesc || e.resourceId,
          center: e.center,
          className: e.className,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_find_and_tap",
    label: "Find and Tap",
    description:
      "Find a UI element by selector and tap it, with retry logic. " +
      "More reliable than raw coordinate taps.",
    parameters: Type.Object({
      text: Type.Optional(Type.String({ description: "Element text to match" })),
      resource_id: Type.Optional(Type.String({ description: "Resource ID to match" })),
      description: Type.Optional(Type.String({ description: "Content description to match" })),
      retries: Type.Optional(Type.Number({ description: "Number of retries (default: 3)" })),
    }),
    async execute(_id, args) {
      const selector = {
        text: args.text,
        resourceId: args.resource_id,
        description: args.description,
      };
      const el = await findAndTap(selector, { serial: defaultSerial, retries: args.retries });
      if (el) {
        return { content: [{ type: "text", text: JSON.stringify({ tapped: true, text: el.text, center: el.center }) }], details: {} };
      }
      return { content: [{ type: "text", text: JSON.stringify({ tapped: false, reason: "element not found after retries" }) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_scroll_find",
    label: "Scroll to Find",
    description:
      "Scroll the screen until a target element is found. Useful for finding " +
      "elements that are off-screen in scrollable views.",
    parameters: Type.Object({
      text: Type.Optional(Type.String({ description: "Element text to find" })),
      resource_id: Type.Optional(Type.String({ description: "Resource ID to find" })),
      direction: Type.Optional(Type.Union([Type.Literal("down"), Type.Literal("up")], { description: "Scroll direction (default: down)" })),
      max_scrolls: Type.Optional(Type.Number({ description: "Max scroll attempts (default: 10)" })),
    }),
    async execute(_id, args) {
      const selector = { text: args.text, resourceId: args.resource_id };
      const el = await scrollToFind(selector, {
        serial: defaultSerial,
        direction: args.direction as "down" | "up" | undefined,
        maxScrolls: args.max_scrolls,
      });
      if (el) {
        return { content: [{ type: "text", text: JSON.stringify({ found: true, text: el.text, center: el.center }) }], details: {} };
      }
      return { content: [{ type: "text", text: JSON.stringify({ found: false }) }], details: {} };
    },
  });

  // --- Screen state ---

  pi.registerTool({
    name: "android_screen_state",
    label: "Screen State",
    description:
      "Get comprehensive screen state: foreground app/activity, keyboard visible, " +
      "orientation, lock state, overlay detection, activity stack. Essential for navigation.",
    parameters: Type.Object({
      include_stack: Type.Optional(Type.Boolean({ description: "Include full activity back stack" })),
    }),
    async execute(_id, args) {
      const opts = { serial: defaultSerial };
      const state = await getScreenState(opts);
      const response: Record<string, unknown> = { ...state };
      if (args.include_stack) {
        response.activityStack = await getActivityStack(opts);
      }
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_wait_activity",
    label: "Wait for Activity",
    description:
      "Wait until a specific app or activity is in the foreground. " +
      "Useful after launching an app or navigating to a new screen.",
    parameters: Type.Object({
      package: Type.String({ description: "Package name to wait for" }),
      activity: Type.Optional(Type.String({ description: "Activity class name (optional, match package only if omitted)" })),
      timeout_ms: Type.Optional(Type.Number({ description: "Timeout in ms (default: 10000)" })),
    }),
    async execute(_id, args) {
      const found = await waitForActivity(args.package, args.activity, {
        serial: defaultSerial,
        timeout: args.timeout_ms,
      });
      return { content: [{ type: "text", text: JSON.stringify({ package: args.package, found }) }], details: {} };
    },
  });

  // ── Lock Pattern / PIN Management ─────────────────────────────────

  pi.registerTool({
    name: "android_lock_status",
    label: "Lock Status",
    description:
      "Check whether the device has a lock pattern, PIN, or password set.",
    parameters: Type.Object({}),
    async execute() {
      const status = await getLockStatus({ serial: defaultSerial });
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_lock_clear",
    label: "Clear Lock",
    description:
      "Clear the device lock pattern or PIN. Requires the current credential. " +
      "Pattern format: comma-separated dot indices (e.g., '1,2,5,8,9'). " +
      "Dot layout: 0=top-left, 1=top-center, 2=top-right, 3=mid-left, ..., 8=bottom-right.",
    parameters: Type.Object({
      credential: Type.String({ description: "Current lock pattern or PIN to clear" }),
    }),
    async execute(_id, args) {
      const result = await clearLock(args.credential, { serial: defaultSerial });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_lock_set_pattern",
    label: "Set Lock Pattern",
    description:
      "Set a pattern lock on the device. " +
      "Pattern format: comma-separated dot indices (e.g., '1,2,5,8,9'). " +
      "Dot layout: 0=top-left, 1=top-center, 2=top-right, 3=mid-left, " +
      "4=center, 5=mid-right, 6=bottom-left, 7=bottom-center, 8=bottom-right.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Lock pattern as comma-separated dot indices" }),
    }),
    async execute(_id, args) {
      const result = await setPattern(args.pattern, { serial: defaultSerial });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });

  pi.registerTool({
    name: "android_lock_set_pin",
    label: "Set Lock PIN",
    description: "Set a PIN lock on the device.",
    parameters: Type.Object({
      pin: Type.String({ description: "PIN to set (numeric string)" }),
    }),
    async execute(_id, args) {
      const result = await setPin(args.pin, { serial: defaultSerial });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });
}
