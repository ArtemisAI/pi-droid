---
name: android-interact
description: Interact with the Android device — tap, type text, swipe, scroll, press keys, navigate
---

## When to use

Use this skill when you need to perform actions on the device: tapping buttons, entering text, scrolling, swiping, pressing hardware/soft keys, or launching/stopping apps.

## Tools

| Tool | Purpose |
|------|---------|
| `android_tap` | Tap by coordinates, text match, or resource ID. Supports long press. |
| `android_type` | Type text into the focused field. Optional `clear_first` to replace. |
| `android_swipe` | Swipe between two coordinates with optional duration. |
| `android_scroll` | Scroll up or down on the current screen. |
| `android_key` | Press a key: `back`, `home`, `enter`, `tab`, or any `KEYCODE_*`. |
| `android_app` | Launch, stop, or check status of an app by package name. |

## Best practices

- **Prefer text-based tap** (`android_tap` with `text` param) over coordinates when possible — it's resolution-independent
- **Always use `android_look` first** to identify element positions before tapping coordinates
- **After typing**, the keyboard may cover elements — use `android_key back` to dismiss, or scroll
- **For navigation**: `android_key back` goes back, `android_key home` goes to launcher
- **Long press**: use `long_press_ms` param on `android_tap` (e.g., 1000 for 1 second)

## Examples

```
"Tap the Login button" → android_tap { text: "Login" }
"Type my email" → android_type { text: "user@example.com" }
"Scroll down" → android_scroll { direction: "down" }
"Go back" → android_key { key: "back" }
"Open Chrome" → android_app { action: "launch", package: "com.android.chrome" }
```
