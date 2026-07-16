# Codex Extras

Raycast commands that make the Codex desktop app quicker to use.

## Commands

### Open New Codex Window

Opens a new Codex window from Raycast.

- On macOS, the command supports both the current ChatGPT-hosted Codex app and the legacy standalone Codex app. It opens the app if it is not already running; otherwise, it invokes the app's **New Window** menu item, including when existing windows are on another Space.
- On Windows, the command opens Codex if it is not already running. If Codex is running, it focuses a Codex window and sends the new-window shortcut.

## Requirements

- Raycast
- ChatGPT desktop app with Codex (or the legacy standalone Codex app) installed
- macOS or Windows

## Permissions

On macOS, Raycast may need Accessibility permission to trigger Codex's **New Window** menu item through System Events.

To enable it:

1. Open **System Settings**.
2. Go to **Privacy & Security**.
3. Open **Accessibility**.
4. Enable Raycast.

## Troubleshooting

If the command fails, it writes diagnostic logs to:

```text
<system temp directory>/raycast-codex-extras/new-window.log
```

Common things to check:

- ChatGPT with Codex (or the legacy Codex app) is installed and can be opened normally.
- Raycast has the required macOS Accessibility permission.
- On Windows, Codex is installed as the expected desktop app package.

## Development

Install dependencies:

```bash
pnpm install
```

Run locally:

```bash
pnpm dev
```

Validate before publishing:

```bash
pnpm lint
pnpm build
```
