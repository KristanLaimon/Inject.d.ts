# Inject.d.ts

Inject.d.ts exposes global TypeScript declaration packages from the extension instead of from each workspace.

It is meant for VS Code and compatible forks where you often open loose `.ts`, `.js`, `.tsx`, or `.jsx` files, small script folders, Bun scripts, or projects that do not have their own `node_modules`.

## Features

- Bundles `bun-types`, `@types/node`, and `undici-types` by default.
- Injects declaration files through a TypeScript server plugin, so IntelliSense can see them in projects and loose files.
- Adds an activity bar view named **Inject.d.ts** with a **Global Types** package list.
- Downloads additional npm type packages into extension global storage.
- Supports create, read, edit, and delete for downloaded packages.
- Does not modify the current workspace or run `npm install` / `pnpm install` inside user projects.

## Usage

1. Install and enable the extension.
2. Open any TypeScript or JavaScript file.
3. Use the **Inject.d.ts** activity bar icon to inspect bundled and downloaded declaration packages.
4. Run **Download Types Package** from the view title or command palette to add a package such as `@types/lodash`, `@types/express`, or `bun-types@latest`.
5. Open a package item to read its `.d.ts` files, use **Edit Types Package** to modify a downloaded declaration file, or **Delete Types Package** to remove downloaded packages.

Bundled defaults are read-only from the delete command. Delete is intentionally not an update operation; remove a downloaded package first, then download the version you want.

## How It Works

The extension keeps downloaded packages in VS Code global extension storage. It fetches package metadata and tarballs directly from the npm registry, extracts the package and its dependencies into that storage, builds a declaration manifest, and passes the manifest path to the TypeScript server plugin.

The plugin reports the manifest files as external TypeScript project files. This makes declarations available without adding dependencies to the active workspace.

## Notes

- Downloading packages requires network access to the npm registry.
- This is for editor IntelliSense and type checking inside VS Code-compatible editors. It does not change runtime behavior.
- Project-local `tsconfig.json` settings can still affect how TypeScript reports conflicts between DOM, Node, Bun, and other global declarations.
