# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Use [GitHub Security Advisories](https://github.com/ArtemisAI/pi-droid/security/advisories/new) to report privately
3. Alternatively, email security concerns to the maintainers via the contact information on the [ArtemisAI GitHub profile](https://github.com/ArtemisAI)

We will acknowledge reports within 48 hours and aim to release fixes promptly.

## Security Considerations

### ADB Access

Pi-droid executes ADB commands on connected Android devices. ADB grants broad access to the device including:

- Reading and writing files
- Installing and uninstalling applications
- Executing shell commands
- Capturing screen content
- Sending input events

**Only connect devices you trust and control.** ADB access is equivalent to physical access to the device.

### Plugin System

Plugins are loaded dynamically from npm packages or local paths. A plugin can execute arbitrary code on the host machine and arbitrary ADB commands on connected devices.

- Only install plugins from trusted sources
- Review plugin source code before installation
- Plugins with `requiresApproval: true` capabilities require explicit confirmation before executing actions that affect other users

### Credentials and Secrets

- Never commit credentials, API keys, device serials, or account data to the repository
- Use environment variables or gitignored configuration files for sensitive data
- See the credentials section in [CLAUDE.md](./CLAUDE.md) for the full policy
