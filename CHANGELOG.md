# Changelog

## [0.0.3] - 2026-10-21

- Fixed **Failed to start server** on Windows. The OpenCode CLI is now launched
  via its real `.exe` (npm global or common install paths), falling back to
  `cmd.exe` for npm `.cmd` shims. Set `OPENCODE_BIN` to override the executable.

## [0.0.2] - 2026-10-18

- Added an **OpenCode: Open Chat** command, status bar entry, editor title
  button and <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> shortcut
  (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> on macOS).
- The extension now activates on startup so the status bar entry is always
  available.

## [0.0.1] - 2026-10-18

First public release.

- Sidebar chat for OpenCode with streaming responses, reasoning and tool cards.
- Model and mode pickers (Build, Plan and custom primary agents).
- Chat history, clear chat and inline permission prompts.
- File attachments, editor selections and `@`-file mentions.
- Inline prompts for the `question` tool, with single/multi-select options and
  free-form answers.
