# OpenCode UI for VS Code

A graphical (Cursor-like) interface for [OpenCode](https://opencode.ai) inside VS Code,
so you don't have to work with OpenCode through the terminal.

This is the first milestone: an **Activity Bar sidebar with a chat and a model
selector**, backed by the official OpenCode client.

## What works today

- **Sidebar chat** view in the Activity Bar (`OpenCode` → `Chat`).
- **Model picker** in the chat header — searchable, grouped by provider, with
  context window and pricing hints.
- **Streaming responses** rendered live from the OpenCode event stream
  (`session.text.delta`), including collapsible reasoning and tool cards.
- **Tool calls** shown inline (name, argument, collapsible input/output).
- **Clear chat** action in the header, session title, and a token/cost footer.
- Connects to OpenCode through the official `@opencode/client`, using
  `Service.ensure()` which discovers or starts the local `opencode serve`
  background service and handles authentication — the same path the TUI uses.

## Requirements

- VS Code `>= 1.90`
- OpenCode V2 installed and on `PATH` (this project is built against `opencode v2.0.26`)

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

- [ ] Session history / switcher (list, resume, delete)
- [ ] Agent selector (build / plan / …)
- [ ] Permission request prompts (`permission.asked` → allow/deny)
- [ ] Inline diffs for file edits (`vcs.diff`, tool file contents)
- [ ] `@`-mentions for files and skills, image attachments
- [ ] Slash commands and compaction
