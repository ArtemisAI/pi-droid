# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-13

### Added

- 36 LLM-visible tools for full Android device control via ADB
- Annotated screenshots with numbered element indices for resolution-independent interaction
- Plugin system with `CliPlugin` base class and marketplace integration
- 4 skill definitions (`android-screen`, `android-interact`, `android-automate`, `android-plugin`)
- Deterministic input routing for common one-tool actions
- Multi-device support with device registry and serial-based targeting
- Gesture macro recording, saving, and replay
- Screen lock management (PIN, pattern, query, clear)
- WiFi ADB for wireless device connections
- OCR fallback via Tesseract for WebViews and dynamic content
- Full public API re-exporting ADB primitives for custom automation
- 473+ tests across 36 test files (unit, integration, device E2E)
- Comprehensive documentation (README, ARCHITECTURE, PLUGINS, CONTRIBUTING, SECURITY)

[0.1.0]: https://github.com/ArtemisAI/pi-droid/releases/tag/v0.1.0
