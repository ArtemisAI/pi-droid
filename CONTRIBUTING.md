# Contributing to Pi-Droid

Thank you for your interest in contributing to Pi-Droid. This guide covers everything you need to get started.

## Reporting Bugs

Open an issue at [github.com/ArtemisAI/pi-droid/issues](https://github.com/ArtemisAI/pi-droid/issues) with:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Device model and Android version (if device-specific)
- Pi-Droid version (`npm ls pi-droid`)

## Suggesting Features

Feature requests are welcome. Open an issue with the `enhancement` label and describe:

- The problem you are trying to solve
- Your proposed solution
- Which tier the feature belongs to (Core Tool, Flow Script, or Plugin -- see [ARCHITECTURE.md](./ARCHITECTURE.md) for tier definitions)

## Development Setup

```bash
git clone https://github.com/ArtemisAI/pi-droid.git
cd pi-droid
npm install
npm run build
npm test
```

To run device-dependent tests, connect an Android device via ADB and set the serial:

```bash
export ANDROID_SERIAL=your_device_serial
```

## Code Style

- TypeScript with ESM modules (`"type": "module"`)
- Use [TypeBox](https://github.com/sinclairzx81/typebox) for tool parameter schemas (no Zod)
- Tests use [Vitest](https://vitest.dev/)
- Tool names follow the `android_` prefix convention
- All ADB functions accept `options: AdbExecOptions = {}` as the last parameter
- Hardcoded device coordinates must include a comment noting the target device and resolution

## Testing Tiers

Pi-Droid has three testing tiers:

| Command | What it runs | Requirements |
|---------|-------------|--------------|
| `npm run test:unit` | Unit tests with mocked ADB | None |
| `npm run test:ci` | CI-safe subset (unit + integration) | None |
| `npm run test:device` | Full suite including device tests | ADB-connected Android device |

All new `src/adb/` modules must have a corresponding test file in `tests/`. Flow scripts (`src/flows/`) do not require unit tests since they need a physical device to verify.

## Pull Request Process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes, following the coding rules in [CONTRIBUTING.md](#code-style).
3. Add or update tests for any new `src/adb/` modules.
4. Run the full test suite: `npm test`
5. Run the build: `npm run build`
6. Open a pull request against `main` with a clear description of the change.

### PR Checklist

- [ ] `npm run build` passes with no TypeScript errors
- [ ] `npm test` passes (all tests green)
- [ ] New `src/adb/` modules have corresponding test files
- [ ] New LLM tools follow `android_` prefix and use TypeBox schemas
- [ ] Hardcoded coordinates include a device/resolution comment
- [ ] No secrets, credentials, or device serials in committed code

## Plugin Development

If you are building an app-specific plugin rather than contributing to core, see [PLUGINS.md](./PLUGINS.md) for the plugin development guide, including the `CliPlugin` base class and the native runner pattern.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Report unacceptable behavior to the project maintainers.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
