# Opencode GUI for VSCode

A graphical (Cursor-like) interface for [OpenCode](https://opencode.ai) inside VS Code,
so you don't have to work with OpenCode through the terminal.

This is the first milestone: an **Activity Bar sidebar with a chat and a model
selector**, backed by the official OpenCode client.

## What works today

- **Sidebar chat** view in the Activity Bar (`OpenCode` → `Chat`).
- **Model picker** in the chat header — searchable, grouped by provider, with
  context window and pricing hints.
- **Mode picker** in the chat header — switch between **Build**, **Plan** and any
  other primary OpenCode agent. The choice applies to new sessions and is
  switched live on the active one.
- **Streaming responses** rendered live from the OpenCode event stream
  (`session.text.delta`), including collapsible reasoning and tool cards.
- **Tool calls** shown inline (name, argument, collapsible input/output).
- **Clear chat** action in the header, session title, and a token/cost footer.
- **Chat history**: a dropdown in the header to search, reopen and delete past
  sessions. History is persisted by OpenCode itself (no extra database needed),
  so it survives restarts of the background service.
- **Permission prompts**: when OpenCode asks before a shell command or file
  edit, an inline card lets you *Allow once*, *Always allow* or *Deny*.
- **Inline questions**: when the agent uses the `question` tool, the chat shows
  its choices (single or multi-select) and a free-form answer field. Answers are
  sent back to the agent; multiple questions can be stepped through before
  submitting.
- **File attachments**: right-click a file (or folder) in the Explorer — or an
  open editor tab — and choose **OpenCode: Add to Chat**. The item is staged as
  a chip above the composer and passed to OpenCode as a `file:` URL when you
  send, so text and image files are read directly by the model.
- **Selection to chat**: select lines in the editor and right-click →
  **OpenCode: Add Selection to Chat** to stage them as a chip labelled with the
  file path and line range (for example `extension.ts:42-58`).
- **`@`-mentions**: type `@` in the composer to search workspace files and
  reference one inline (for example `explain @src/session/SessionController.ts`).
  Matched files are resolved and attached to the prompt automatically.
- Connects to OpenCode through the official `@opencode/client`, using
  `Service.ensure()` which discovers or starts the local `opencode serve`
  background service and handles authentication — the same path the TUI uses.

## Requirements

- VS Code `>= 1.90`
- OpenCode V2 installed and on `PATH` (the client is `@opencode/client` 2.0.32).
  Inline questions require an OpenCode build with the `question` tool/forms.

## Getting started

```sh
npm install
npm run build      # builds the webview (Vite) and the extension host (esbuild)
```

Then press <kbd>F5</kbd> in VS Code to launch the Extension Development Host, and
open the OpenCode icon in the Activity Bar.

For development with rebuilds:

```sh
npm run watch      # esbuild + vite in watch mode
```

### Adding files to chat

Right-click one or more files or folders in the Explorer (or on an editor tab)
and choose **OpenCode: Add to Chat**. The extension validates each path, reveals
the OpenCode sidebar and stages the items as attachments above the composer.
Remove a chip with its × before sending, or send with empty text to pass the
files on their own.

### Adding a code selection to chat

Select one or more ranges in the editor, open the right-click menu and choose
**OpenCode: Add Selection to Chat**. The extension reveals the sidebar and
stages the file as a chip labelled with the selected line range (for example
`extension.ts:42-58`), just like a file attachment. OpenCode reads the file
itself when you send, so the model has the surrounding context; remove the chip
with its × to drop it before sending.

### Mentioning files with `@`

Type `@` in the composer and keep typing to filter workspace files. Use
<kbd>↑</kbd>/<kbd>↓</kbd> to move, <kbd>Enter</kbd>/<kbd>Tab</kbd> to insert, or
click an item. The token is inserted as `@relative/path`; on send, every token
that resolves to a file inside the workspace is attached to the prompt
automatically. The picker uses OpenCode's own `file.find` index, so it follows
the same ignore rules as the agent.

## Project layout

```
src/
  extension.ts                 extension entry point, commands
  opencode/host.ts             connection wrapper around @opencode/client
  session/SessionController.ts session state + event-stream → UiState projection
  webview/ChatViewProvider.ts  webview host, HTML/CSP, message bridge
shared/protocol.ts             typed contract between host and webview
webview/                       React + Vite UI (rendered inside the sidebar)
media/                         Activity Bar icon
dist/                          build output (extension.js + webview assets)
```

### Architecture

The **extension host owns the source of truth**. `SessionController` connects to
OpenCode, keeps the session, consumes the live event stream, and pushes a full
`UiState` snapshot to the webview over `postMessage`. The React UI is a pure
renderer that sends user intents back (`send`, `abort`, `selectModel`,
`clearChat`, …). This keeps streaming logic in one place and makes the UI easy
to change.

## Roadmap

- [ ] Inline diffs for file edits (`vcs.diff`, tool file contents)
- [ ] Rename sessions and group history by date
- [ ] `@`-mentions for skills, image attachments
- [ ] Slash commands and compaction
