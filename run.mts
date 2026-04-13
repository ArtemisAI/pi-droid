#!/usr/bin/env node
/**
 * Pi-droid CLI runner — uses the actual framework modules for device interaction.
 * Usage: node --import tsx/esm run.mts <command> [args...]
 */
import { Device } from "./src/adb/device.js";
import { annotatedScreenshot } from "./src/adb/annotate.js";
import { getScreenState, getActivityStack, waitForActivity } from "./src/adb/screen-state.js";
import { ensureReady, observe, findAndTap, scrollToFind } from "./src/adb/automation.js";
import { adbShell } from "./src/adb/exec.js";
import { runOcrOnCurrentScreen, runOcrOnImage } from "./src/adb/ocr.js";
import { installPlugin, listInstalledPlugins, removePlugin, searchPlugins } from "./src/plugins/marketplace.js";

const SERIAL = process.env.ANDROID_SERIAL;
if (!SERIAL) {
  throw new Error("ANDROID_SERIAL environment variable is required");
}
const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === "plugin") {
  const action = args[0];
  if (!action || action === "help") {
    console.log("Usage: plugin <install|remove|list|search> [args]");
    process.exit(0);
  }

  if (action === "install") {
    const name = args[1];
    if (!name) throw new Error("Missing plugin name");
    const result = await installPlugin(name);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (action === "remove") {
    const name = args[1];
    if (!name) throw new Error("Missing plugin name");
    const result = await removePlugin(name);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (action === "list") {
    const result = await listInstalledPlugins();
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (action === "search") {
    const query = args.slice(1).join(" ").trim();
    if (!query) throw new Error("Missing search query");
    const result = await searchPlugins(query);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  throw new Error(`Unknown plugin action "${action}"`);
}

const dev = await Device.connect(SERIAL);

switch (cmd) {
  case "screen": {
    const state = await getScreenState({ serial: SERIAL });
    console.log(JSON.stringify(state, null, 2));
    break;
  }
  case "observe": {
    const result = await observe({ serial: SERIAL });
    console.log(JSON.stringify({
      screenshot: result.screenshot,
      foreground: result.foregroundPackage,
      interactiveCount: result.interactiveElements.length,
      allCount: result.allElements.length,
    }, null, 2));
    break;
  }
  case "look": {
    const result = await annotatedScreenshot({ serial: SERIAL, includeBase64: false });
    const elements = result.elements.map((e, i) => ({
      idx: i + 1,
      text: e.text || undefined,
      desc: e.contentDesc || undefined,
      id: e.resourceId || undefined,
      bounds: e.bounds,
    }));
    console.log(JSON.stringify({ screenshot: result.screenshotPath, annotated: result.annotatedPath, count: elements.length, elements }, null, 2));
    break;
  }
  case "tap": {
    await dev.tap(parseInt(args[0]), parseInt(args[1]));
    console.log(`Tapped ${args[0]},${args[1]}`);
    break;
  }
  case "type": {
    await dev.typeText(args.join(" "));
    console.log(`Typed: ${args.join(" ")}`);
    break;
  }
  case "key": {
    await dev.keyEvent(args[0]);
    console.log(`Key: ${args[0]}`);
    break;
  }
  case "swipe": {
    await dev.swipe(parseInt(args[0]), parseInt(args[1]), parseInt(args[2]), parseInt(args[3]), parseInt(args[4] || "300"));
    console.log(`Swiped`);
    break;
  }
  case "launch": {
    await dev.launchApp(args[0]);
    console.log(`Launched ${args[0]}`);
    break;
  }
  case "back": {
    await dev.back();
    console.log("Back");
    break;
  }
  case "home": {
    await dev.home();
    console.log("Home");
    break;
  }
  case "find-tap": {
    // find-tap <text|desc|id> <value> [--clickable]
    const selector: Record<string, any> = {};
    const selectorType = args[0]; // text, textExact, desc, id, className
    const selectorVal = args[1];
    if (selectorType === "desc") selector.description = selectorVal;
    else if (selectorType === "id") selector.resourceId = selectorVal;
    else if (selectorType === "textExact") selector.textExact = selectorVal;
    else selector.text = selectorVal;
    if (args.includes("--clickable")) selector.clickable = true;
    const el = await findAndTap(selector, { serial: SERIAL });
    console.log(el ? JSON.stringify({ tapped: true, bounds: el.bounds, text: el.text, desc: el.contentDesc }) : '{"tapped": false}');
    break;
  }
  case "scroll-find": {
    const selector: Record<string, any> = {};
    const selectorType = args[0];
    const selectorVal = args[1];
    if (selectorType === "desc") selector.description = selectorVal;
    else if (selectorType === "id") selector.resourceId = selectorVal;
    else selector.text = selectorVal;
    const el = await scrollToFind(selector, { serial: SERIAL });
    console.log(el ? JSON.stringify({ found: true, bounds: el.bounds, text: el.text }) : '{"found": false}');
    break;
  }
  case "ensure-ready": {
    const result = await ensureReady({ serial: SERIAL, packageName: args[0] });
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "wait": {
    const ok = await waitForActivity(args[0], args[1] || undefined, { serial: SERIAL, timeout: parseInt(args[2] || "10000") });
    console.log(JSON.stringify({ found: ok }));
    break;
  }
  case "shell": {
    const output = await adbShell(args.join(" "), { serial: SERIAL });
    console.log(output);
    break;
  }
  case "shot": {
    const ss = await dev.screenshot({ includeBase64: false });
    console.log(ss.path);
    break;
  }
  case "ocr": {
    const screenshotPath = args[0];
    const confidenceThreshold = args[1] ? parseFloat(args[1]) : undefined;
    const result = screenshotPath
      ? await runOcrOnImage(screenshotPath, { confidenceThreshold })
      : await runOcrOnCurrentScreen({ serial: SERIAL, confidenceThreshold });
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  default:
    console.log("Commands: plugin <install|remove|list|search>|screen|observe|look|tap X Y|type TEXT|key KEY|swipe X1 Y1 X2 Y2|launch PKG|back|home|find-tap <text|desc|id> <val>|scroll-find <text|desc|id> <val>|ensure-ready [PKG]|wait PKG [ACTIVITY] [TIMEOUT]|shell CMD|shot|ocr [SCREENSHOT_PATH] [CONFIDENCE_THRESHOLD]");
}
