/**
 * Notification reading, clipboard management, and intent tools.
 *
 * Provides structured access to Android notifications, clipboard,
 * and generic intent sending (URLs, SMS, calls, shares).
 */

import { adbShell, type AdbExecOptions } from "./exec.js";
import type { NotificationInfo, IntentExtras } from "./types.js";

/**
 * Read active notifications from the notification shade.
 *
 * Parses `dumpsys notification --noredact` for posted notifications
 * and extracts package, title, text, and timestamp.
 */
export async function readNotifications(
  options: AdbExecOptions = {},
): Promise<NotificationInfo[]> {
  const output = await adbShell("dumpsys notification --noredact", options);
  const notifications: NotificationInfo[] = [];

  // Split into notification record blocks
  const blocks = output.split(/NotificationRecord\(/);

  for (const block of blocks.slice(1)) {
    // Package name: first token after the opening paren, e.g. "com.foo 0x..."
    const pkgMatch = block.match(/^\s*(\S+)/);
    const packageName = pkgMatch?.[1] ?? "unknown";

    // Post time
    const timeMatch = block.match(/postTime=(\d+)/);
    const time = timeMatch ? timeMatch[1] : "0";

    // Title from android.title extra
    const titleMatch = block.match(/android\.title=(?:String \()?(.*?)(?:\)|$)/m);
    const title = titleMatch?.[1]?.trim() ?? "";

    // Text from android.text extra
    const textMatch = block.match(/android\.text=(?:String \()?(.*?)(?:\)|$)/m);
    const text = textMatch?.[1]?.trim() ?? "";

    notifications.push({ packageName, title, text, time });
  }

  return notifications;
}

/**
 * Get current clipboard text content.
 *
 * Uses the clipboard service call to retrieve the primary clip.
 * Falls back to empty string if clipboard is empty or inaccessible.
 */
export async function getClipboard(
  options: AdbExecOptions = {},
): Promise<string> {
  try {
    // Try reading via service call — returns a Parcel with the clip data
    const output = await adbShell(
      "service call clipboard 2 i32 1 i32 0",
      options,
    );

    // Parse the hex dump from service call output.
    // Format: Result: Parcel(00000000 00000001 '....' '....')
    // Extract the string from the parcel response.
    const hexParts = output.match(/'([^']*)'/g);
    if (!hexParts) return "";

    const chars = hexParts
      .map((part) => part.replace(/'/g, ""))
      .join("")
      .replace(/\./g, "");

    // If that didn't work well, try a simpler approach via am broadcast
    if (!chars || chars.length === 0) {
      return "";
    }

    return chars;
  } catch {
    return "";
  }
}

/**
 * Set clipboard text content.
 *
 * Uses `am broadcast` with the clipper action. Requires a clipboard helper
 * app, or falls back to the `service call` approach.
 */
export async function setClipboard(
  text: string,
  options: AdbExecOptions = {},
): Promise<void> {
  // Escape single quotes for shell
  const escaped = text.replace(/'/g, "'\\''");
  await adbShell(
    `am broadcast -a clipper.set -e text '${escaped}'`,
    options,
  );
}

/**
 * Send a generic Android intent via `am start` or `am broadcast`.
 *
 * @param action - Intent action (e.g., "android.intent.action.VIEW")
 * @param extras - Key-value string extras to attach
 * @param options - ADB execution options plus intent delivery mode
 */
export async function sendIntent(
  action: string,
  extras: IntentExtras = {},
  options: AdbExecOptions & { broadcast?: boolean } = {},
): Promise<string> {
  const cmd = options.broadcast ? "am broadcast" : "am start";
  const extraArgs = Object.entries(extras)
    .map(([key, value]) => {
      const escaped = value.replace(/'/g, "'\\''");
      return `--es '${key}' '${escaped}'`;
    })
    .join(" ");

  const fullCmd = `${cmd} -a '${action}'${extraArgs ? ` ${extraArgs}` : ""}`;
  return adbShell(fullCmd, options);
}

/**
 * Open a URL in the default browser.
 */
export async function openUrl(
  url: string,
  options: AdbExecOptions = {},
): Promise<void> {
  await adbShell(
    `am start -a android.intent.action.VIEW -d '${url}'`,
    options,
  );
}

/**
 * Share text via the Android share sheet.
 */
export async function shareText(
  text: string,
  options: AdbExecOptions = {},
): Promise<void> {
  const escaped = text.replace(/'/g, "'\\''");
  await adbShell(
    `am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '${escaped}'`,
    options,
  );
}

/**
 * Open the dialer with a phone number pre-filled (does not auto-call).
 */
export async function makeCall(
  number: string,
  options: AdbExecOptions = {},
): Promise<void> {
  await adbShell(
    `am start -a android.intent.action.DIAL -d 'tel:${number}'`,
    options,
  );
}

/**
 * Open SMS compose with a pre-filled number and message body.
 */
export async function sendSms(
  number: string,
  message: string,
  options: AdbExecOptions = {},
): Promise<void> {
  const escaped = message.replace(/'/g, "'\\''");
  await adbShell(
    `am start -a android.intent.action.SENDTO -d 'sms:${number}' --es sms_body '${escaped}'`,
    options,
  );
}
