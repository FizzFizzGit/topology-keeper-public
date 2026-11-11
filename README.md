# Topology Keeper

See the [documentation index](docs/README.md) for specifications, design notes and release documents.

See [Window UI architecture](docs/design/UI-ARCHITECTURE.md) for reusable components, the bilingual standalone demo, module boundaries and remaining extraction candidates.

In **Window appearance**, set the font scale, width, and height bounds of the main, analysis, and isolation windows. Floating windows default to 280px wide, fit narrow screens, and adjust their height to the content. In **Window placement**, choose a floating window, left sidebar tab, or right sidebar tab separately for the main, analysis, isolation, and partial graph windows.

## Area analysis

Use the refresh button in the analysis title bar to calculate distance areas. Expand an area to inspect its **primitive areas**, which are groups of directly linked notes, and **combined areas**, which connect groups or individual notes through shared tags. Cross-area tag connections are listed with their destinations. Repeated connections link to the first occurrence.

The analysis result and shortest-hop table are saved for reuse after restart. Subsequent runs update affected distances when connections change. The main indicator counts the parent areas.

Partial graphs show actual note and tag connections, including the direction of note links. Floating partial graphs remember their position and size. The analysis window can also apply the four combined-area colors to Obsidian's standard graph.

The isolation indicator counts ordinary notes requiring review and orphaned managed data. Tag-only connections and notes in a configured exclusion folder appear in separate lists.

English | [日本語](README.ja.md)

Topology Keeper is a desktop-only Obsidian plugin that helps you explore the structure of your notes through links and tags. It provides graph area analysis, tag suggestions, and tools for associating local external files with notes.

Development and automated tests have been performed on Windows. Compatibility with macOS, Linux, and the declared minimum Obsidian version still needs verification. English UI coverage includes settings, commands, the main and analysis windows, partial graphs, tag suggestions, external file operations, import recovery, and cleanup confirmations. Some internal errors and developer logs may still be Japanese. Reload the plugin after changing language. English UI and modal display have been confirmed by the user; exhaustive visual checks across all screens and widths remain pending.

## Features

- Analyze distance areas and classify their combined areas by average connections and planarity.
- Inspect an area's notes in an interactive graph with dragging, zooming, and surrounding nodes.
- Apply area classification colors to Obsidian's standard graph.
- Suggest tags based on note content and relationships.
- Associate external files with notes and create metadata notes, image thumbnails, and Bases.
- List linked files and Bases, copy links, and remove associations.
- Detect orphaned metadata notes, thumbnails, and Bases, with confirmation before deletion.
- Remember window positions and restore analysis and orphan windows that were open.
- Rename external files and move selected linked files to another folder, updating metadata references.
- Recover links and Base membership after an interrupted external-file import.

## Installation

While community directory approval is pending, install manually:

1. Back up your vault and close Obsidian.
2. Download `main.js`, `manifest.json`, and `styles.css` from the assets of a [GitHub release](https://github.com/FizzFizzGit/topology-keeper-public/releases).
3. Place the three files in `<vault>/.obsidian/plugins/topology-keeper/`.
4. Start Obsidian and enable **Topology Keeper** in the Community plugins settings.

The version and declared minimum Obsidian version are recorded in `manifest.json`. Use a test vault with a backup when trying the plugin.

### Migrating from the earlier local version

The earlier local plugin ID was `Topology-Keeper`; the public ID is `topology-keeper`. To migrate manually, close Obsidian, back up the old plugin folder and its `data.json`, and transfer the settings file to the folder for the new ID. On a filesystem that ignores letter case, use a temporary folder name when renaming. Enable only one version at a time. Your notes and managed folders do not need to move.

Local deployment scripts preserve an existing installation's ID capitalization and `data.json`. They do not change the public manifest's ID.

## Usage

### Explore note structure

Use the **孤立** (Orphans) and **エリア** (Areas) indicators in the main window to open their separate windows. Displayed areas are candidates inferred from graph structure and include planar areas. Each area starts collapsed; its graph button remains visible. Use **再チェック** (Recheck) to refresh the results. Open an area's graph to inspect its nodes; drag nodes to adjust their layout, use the mouse wheel or zoom buttons, and click a note to open it in a tab. Resize the graph using its bottom-right handle.

Drag a window's title bar to move it. Positions are saved for the next session. The main, analysis, and orphan windows have position reset buttons; the settings page and the **小窓・詳細窓の位置をリセット** command reset these windows.

### Suggest tags

Open a regular Markdown note and run **タグを提案（既存タグから）** from the command palette. Review the suggestions before applying them. In settings, edit the stop words used to exclude terms from new tag candidates, one word per line.

### Associate external files

With a regular Markdown note active, run **外部ファイルを追加（メタノート作成）**, choose local files, and provide a Base name when prompted. Files already inside the vault are linked directly. External files remain in their original locations; the plugin creates metadata notes, thumbnails for supported images, and a Base inside the vault.

Imported Bases show metadata notes belonging to the import group. Standalone Bases filter by selected tags using AND conditions; selecting no tags leaves the Base unfiltered. Files and Bases associated with the active note appear in the main window. Click a name to open it. Hover over a row to show its menu; it displays the target name and highlights the row. The menu closes when the pointer leaves. It offers renaming for external files, copying links, and removing associations.

Use the folder icon beside the linked-file heading to select files with checkboxes, choose a destination folder, and review the move before starting. Existing destination files are never overwritten. If a move fails partway through, processing stops and the completed count is shown. Renaming and moving update matching managed metadata references. These operations temporarily copy each file before removing the original; allow space for the copy. They do not provide crash recovery, and references in other applications are not updated.

### Recover an interrupted import

If an import fails, its recovery record is saved in `data.json` and cleanup is paused. Run **未完了の取り込みを復旧** (Recover unfinished import), or select **復旧** in settings, to restore links and Base membership. Check partially created metadata notes and thumbnails afterward: recovery does not fully regenerate their contents.

If the original note was moved, restore its original path before recovery. After checking the files manually, **記録だけ解除** clears only the recovery record and keeps the files.

## External files, privacy, and cleanup

- Automatically opening original images and embedding external images are both **off by default**. Enable them under **外部ファイル** in settings only for vaults you trust. Reopen affected notes after changing the embedding setting.
- External references use local `file:` URLs. Network paths are not supported. Opening a file also rejects common executable and script extensions, but this is not a document malware scanner.
- Metadata notes store the original file's **absolute path** in `source`. Sharing a vault can reveal usernames and folder names. Paths may need adjustment on another computer. Thumbnails also contain image content.
- The plugin uses no telemetry or external screenshot service. Web thumbnail capture contacts the selected page and its resources. Documents opened in another application follow that application's network behavior.
- Image reads are limited to **32 MiB per file**. The original image byte cache is limited to **128 MiB and 64 entries**. These limits do not cap decoded image memory or total application memory.
- Cleanup asks for confirmation and uses Obsidian's configured trash behavior. It is blocked while notes are unparsed or an import is running or unfinished. Thumbnails referenced elsewhere are protected.
- The metadata folder is dedicated to metadata notes; Markdown files there need no marker property. Other cleanup candidates are UUID-named Bases and WebP thumbnails, plus recorded UUID-named PNG web screenshots in their configured folders. Referenced files and tagged metadata notes are excluded from orphan cleanup.
- Reference checks depend on Obsidian's metadata cache. Synchronization and concurrent editing can still introduce races. Keep backups and review deletion candidates.

Managed folders are configurable. Changing a folder setting does not move existing files; files left in an earlier folder are no longer managed by that setting.

## Understanding area analysis

Distance analysis uses a graph of notes and tags, with an edge for each direct link or tag assignment. Floyd–Warshall calculates shortest hop counts. Neighborhood overlap determines boundary votes. Edges above the provisional 2.5% split-vote threshold separate distance areas. The current limit is 256 vertices.

Planarity is checked on the connections within each primitive or combined area. The check uses edge bounds and K₅ and K₃,₃ tests based on Kuratowski’s theorem, then tests edge orders or left–right cycle constraints when needed. Combined areas use average connections per vertex, including note and tag vertices. The provisional dense threshold is 3.5 connections per vertex.

The four configurable defaults are orange for dense planar, blue for sparse planar, red for dense nonplanar, and gray for sparse nonplanar. Undetermined combined areas have no color. A note shared by multiple combined areas takes the color of the largest classified area in the standard graph.

The analysis checks its time budget periodically and keeps the previous result if recalculation fails. Standard graph coloring depends on Obsidian's internal graph API. See the [specification](docs/specification/SPECIFICATION.ja.md) for details.

## Development

Node.js 24 is used for development and testing. Install dependencies with `npm ci`.

| Command | Purpose |
| --- | --- |
| `npm test` | Run automated tests for analysis, positions, cleanup protection, external access, recovery, and deployment. |
| `npm run check` | Check JavaScript syntax and manifest/version consistency. |
| `npm run build` | Build directly to `PLUGIN_DIR` in development (required), or to `dist/<version>/` in the public repository. No intermediate local bundle is generated. |
| `npm run package` | Validate, test, and build the three release files under the public repository’s `dist/<version>/`. No source snapshot is generated. |

Install Node.js and run `npm ci` to install build dependencies. The public repository includes source verification and release build scripts; local deployment and watch scripts are kept in the development repository. Build scripts do not stage, commit, or push files.

Edit plugin code and styles in `src/`, including `src/styles.css`. JavaScript is built directly into the installation or release folder. CSS is copied there as `styles.css`; no intermediate local bundle or root CSS copy is generated. The [Japanese documentation](README.ja.md) includes a module reference. Manual compatibility and UI checks are tracked in [RELEASE-CHECKLIST.md](docs/releases/RELEASE-CHECKLIST.md), currently in Japanese.

## License

[ISC](LICENSE).

## Web page thumbnail links (desktop prototype)

Open an ordinary Markdown note and use the globe button in the main window to enter a URL. With no URL selected, the image is inserted at the saved cursor position. Alternatively, select an HTTP(S) URL or Markdown link and run **Replace selected URL with a thumbnail link**. The modal lets you edit the URL before capture. A line containing only the URL also works without a selection. Choose a width of 64–1024px (default 256px) before capture and optionally draw the page title in a translucent overlay inside the image. Review the screenshot and choose **Save and insert**. The saved PNG includes a dark title box at the bottom, with wrapped white text. Only the image links to the original URL; no separate title link is inserted; image references use only the unique filename. The image link is inserted as a blockquote, prefixed with >.

The page is captured in an isolated temporary browser session at 1280×900 and resized to your chosen width. Reading view respects each recorded width. It does not share your normal browser login. Cookie prompts or login screens may appear. Capture uses offscreen rendering, waits for images, fonts and rendering frames, then retries blank or undersized screenshots. Unusable images are not saved. The overall timeout is 25 seconds. Availability depends on the Electron bridge provided by Obsidian; actual capture in Obsidian remains unverified.

PNG files are saved as UUID.png in the configured thumbnail folder, checking filename uniqueness across the vault. Generated paths and widths are recorded in data.json for display and orphan detection. No image is saved when you cancel. Source-note changes cancel insertion. Removing the image link leaves the saved PNG, which then appears as an orphan thumbnail under generated-data cleanup if no other note references it. Cleanup requires confirmation and uses the configured trash destination. Body links, embeds and cover references protect shared images; deletion is paused during web thumbnail creation.

The **Isolated** indicator totals isolated ordinary notes and orphaned generated files (metadata notes, thumbnails and Bases). Its tooltip shows the two counts; the isolation window keeps ordinary notes and generated-data cleanup separate. Tag-only connections and excluded folders are not included in the total.
