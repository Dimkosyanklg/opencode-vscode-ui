# Publishing to the VS Code Marketplace

## One-time setup

1. **Create a publisher**

   Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft
   account and create a publisher. Its ID must match the `publisher` field in
   `package.json` (currently `dimkosyan`). If you use a different ID, update
   `package.json` and re-package.

2. **Create a Personal Access Token (PAT)**

   - Open <https://dev.azure.com> → *User settings* → *Personal access tokens*.
   - Create a token with **Organization: All accessible organizations** and the
     **Marketplace → Manage** scope.
   - Copy the token once; it cannot be shown again.

3. **Log in `vsce`**

   ```sh
   npx vsce login <publisher-id>
   ```

   Paste the PAT when prompted. It is stored locally by `vsce`.

## Release a version

1. Bump `version` in `package.json` (for example `0.0.1` → `0.0.2`) and add an
   entry to `CHANGELOG.md`.
2. Build and inspect the package:

   ```sh
   npm run package
   npx vsce ls
   ```

3. Publish:

   ```sh
   npx vsce publish
   ```

   To publish a specific VSIX instead:

   ```sh
   npx vsce publish --packagePath opencode-vscode-ui-<version>.vsix
   ```

The extension is usually visible on the Marketplace within a few minutes.

## CI alternative

In CI, set the token as `VSCE_PAT` and run `npx vsce publish -p "$env:VSCE_PAT"`
(PowerShell) or `npx vsce publish -p "$VSCE_PAT"` (bash). Never commit the token.

## Notes

- `@opencode/client` is bundled into `dist/extension.js` by esbuild, so
  `node_modules` is not shipped.
- `.vscodeignore` is a whitelist: only the built extension, webview assets,
  README, CHANGELOG, LICENSE and `media/` are packaged.
- The `question` tool and forms require an OpenCode build that supports them;
  the bundled client is `@opencode/client` 2.0.32.
