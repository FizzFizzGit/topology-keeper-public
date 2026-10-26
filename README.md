# Topology Keeper

English | [日本語](README.ja.md)

Topology Keeper is a desktop-only Obsidian plugin that helps you explore the structure of your notes through links and tags. It provides graph area analysis, tag suggestions, and tools for associating local external files with notes.

This is an experimental release. Development and automated tests have been performed on Windows. Compatibility with macOS, Linux, and the declared minimum Obsidian version still needs verification. The plugin interface is currently in Japanese.

## Features

- Analyze graph areas using link density and evidence of planarity or non-planarity.
- Inspect an area's notes in an interactive graph with dragging, zooming, and surrounding nodes.
- Apply area classification colors to Obsidian's standard graph.
- Suggest tags based on note content and relationships.
- Associate external files with notes and create metadata notes, image thumbnails, and Bases.
- List linked files and Bases, copy links, and remove associations.
- Detect orphaned metadata notes, thumbnails, and Bases, with confirmation before deletion.
- Remember the positions of the main window, detail window, and area graph.
- Recover links and Base membership after an interrupted external-file import.

## Installation

While community directory approval is pending, install manually:

1. Back up your vault and close Obsidian.
2. Download `main.js`, `manifest.json`, and `styles.css` from the assets of a [GitHub release](https://github.com/FizzFizzGit/topology-keeper-public/releases).
3. Place the three files in `<vault>/.obsidian/plugins/topology-keeper/`.
4. Start Obsidian and enable **Topology Keeper** in the Community plugins settings.

The version and declared minimum Obsidian version are recorded in `manifest.json`. Use a test vault with a backup when trying this experimental release.

### Migrating from the earlier local version

The earlier local plugin ID was `Topology-Keeper`; the public ID is `topology-keeper`. To migrate manually, close Obsidian, back up the old plugin folder and its `data.json`, and transfer the settings file to the folder for the new ID. On a filesystem that ignores letter case, use a temporary folder name when renaming. Enable only one version at a time. Your notes and managed folders do not need to move.

Local deployment scripts preserve an existing installation's ID capitalization and `data.json`. They do not change the public manifest's ID.

## Usage

### Explore note structure

Open the main window and select the detail window to view maintenance results and area analysis. Use **再チェック** (Recheck) to refresh the results. Open an area's graph to inspect its nodes; drag nodes to adjust their layout, use the mouse wheel or zoom buttons, and click a note to open it in a tab. Resize the graph using its bottom-right handle.

Drag a window's title bar to move it. Positions are saved for the next session. The main and detail windows have position reset buttons; the settings page and the **小窓・詳細窓の位置をリセット** command reset both windows.

### Suggest tags

Open a regular Markdown note and run **タグを提案（既存タグから）** from the command palette. Review the suggestions before applying them. In settings, edit the stop words used to exclude terms from new tag candidates, one word per line.

### Associate external files

With a regular Markdown note active, run **外部ファイルを追加（メタノート作成）**, choose local files, and provide a Base name when prompted. Files already inside the vault are linked directly. External files remain in their original locations; the plugin creates metadata notes, thumbnails for supported images, and a Base inside the vault.

Imported Bases show metadata notes belonging to the import group. Standalone Bases filter by selected tags using AND conditions; selecting no tags leaves the Base unfiltered. Files and Bases associated with the active note appear in the main window, where you can open them, copy links, or remove associations.

### Recover an interrupted import

If an import fails, its recovery record is saved in `data.json` and cleanup is paused. Run **未完了の取り込みを復旧** (Recover unfinished import), or select **復旧** in settings, to restore links and Base membership. Check partially created metadata notes and thumbnails afterward: recovery does not fully regenerate their contents.

If the original note was moved, restore its original path before recovery. After checking the files manually, **記録だけ解除** clears only the recovery record and keeps the files.

## External files, privacy, and cleanup

- Automatically opening original images and embedding external images are both **off by default**. Enable them under **外部ファイル** in settings only for vaults you trust. Reopen affected notes after changing the embedding setting.
- External references use local `file:` URLs. Network paths are not supported. Opening a file also rejects common executable and script extensions, but this is not a document malware scanner.
- Metadata notes store the original file's **absolute path** in `source`. Sharing a vault can reveal usernames and folder names. Paths may need adjustment on another computer. Thumbnails also contain image content.
- The plugin has no external API submission or telemetry implementation. Documents opened in another application follow that application's network behavior.
- Image reads are limited to **32 MiB per file**. The original image byte cache is limited to **128 MiB and 64 entries**. These limits do not cap decoded image memory or total application memory.
- Cleanup asks for confirmation and uses Obsidian's configured trash behavior. It is blocked while notes are unparsed or an import is running or unfinished. Thumbnails referenced elsewhere are protected.
- Cleanup candidates are limited to identifiable metadata notes and UUID-named Bases and WebP thumbnails. Legacy metadata notes need a UUID filename and a valid local source reference. Tagged metadata notes are excluded from orphan cleanup.
- Reference checks depend on Obsidian's metadata cache. Synchronization and concurrent editing can still introduce races. Keep backups and review deletion candidates.

Managed folders are configurable. Changing a folder setting does not move existing files; files left in an earlier folder are no longer managed by that setting.

## Understanding area analysis

The graph contains Markdown notes and tags, with edges for note links and tag assignments. Analysis removes vertices of degree zero or one and suppresses degree-two vertices. It then divides biconnected components into groups with concentrated internal links using modularity. Partitions containing fewer than three vertices, or groups whose internal edge count is no greater than their external edge count, are rejected. Biconnected components are extracted again after splitting.

Each resulting area is classified as follows:

- **Non-planar:** the area exceeds the planar edge bound `E > 3V - 6`, or a K5 or K3,3 pattern is detected.
- **Planar:** the area has fewer than five vertices of degree at least four and fewer than six vertices of degree at least three, ruling out subdivisions of K5 and K3,3. This is a sufficient condition for planarity.
- **Hotspot:** an area with undetermined planarity, further divided using differences in neighborhood density. Displayed hotspots contain at least three nodes and have at least 25% edge density. A hotspot does not imply non-planarity.

The dense/sparse and planar/non-planar categories are structural indicators. They do not measure note quality or prove that a classification is correct. Links between areas are excluded from each area's planarity test, so these results do not establish planarity of the entire vault. Boundary candidates and mean density change are experimental measures.

Analysis is interrupted at a checkpoint after an approximately ten-second time budget, retaining a matching previous result and graph if available. This is not a strict wall-clock limit. Standard graph coloring uses a private Obsidian API and may stop working after an Obsidian update; the plugin shows a notice if it cannot use that API.

## Development

Node.js 24 is used for development and testing. Install dependencies with `npm ci`.

| Command | Purpose |
| --- | --- |
| `npm test` | Run automated tests for analysis, positions, cleanup protection, external access, recovery, and deployment. |
| `npm run check` | Check JavaScript syntax and manifest/version consistency. |
| `npm run build` | Create a minified `main.js` without deployment or Git changes. |
| `npm run dev` | Watch sources and rebuild with an inline source map, without deployment. |
| `npm run package` | Validate, test, and build release files and a source snapshot under `dist/`. |
| `npm run deploy` | Copy the three plugin files to the directory specified by `PLUGIN_DIR`. Build first. |

On Windows, `setup.bat` installs dependencies. `build.bat` builds once and deploys if `PLUGIN_DIR` is configured; `dev.bat` watches and deploys on each successful build when configured. Set the destination in an ignored `env.local.bat`, for example:

```bat
@echo off
set "PLUGIN_DIR=C:\path\to\vault\.obsidian\plugins\topology-keeper"
```

Build and deployment scripts do not stage or commit files. Node binaries, dependencies, personal deployment settings, and vault data are excluded from the source distribution.

Edit plugin code in `src/`; the root `main.js` is a generated bundle, and `styles.css` contains the plugin styles. The [Japanese documentation](README.ja.md) includes a module reference. Manual compatibility and UI checks are tracked in [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md), currently in Japanese.

## License

[ISC](LICENSE).
