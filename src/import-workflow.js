const { Notice } = require("obsidian");
const path = require("path");
const crypto = require("crypto");
const { BaseNameModal } = require("./base-modal");
const makeThumbnail = require("./thumbnail");
const { CONFIG, FOLDERS } = require("./plugin-settings");
const { toSourceUrl, filenameFromSource } = require("./source-url");

const newId = () => crypto.randomUUID();

// ファイル選択から、links・メタノート・サムネイル・Baseを登録する一連の処理を管理する。
// Vault操作の既存入口はプラグイン本体へ委譲し、取り込みの進行状態だけをこのクラスで持つ。
class ImportWorkflow {
  constructor(plugin, { isImage }) {
    this.plugin = plugin;
    this.isImage = isImage;
    this.importing = false;
  }

  // メインノート（管理フォルダ外の通常の .md）に外部ファイルを接続する。
  // 二重実行を防ぎ、失敗は通知して呼び出し元へ例外を出さない。
  async importFiles(mainNote) {
    if (this.plugin.state.pendingImport) {
      new Notice("未完了の取り込みがあります。コマンド「未完了の取り込みを復旧」を実行してください。");
      return;
    }
    if (this.importing) {
      new Notice("⚠️ 取り込み中です。");
      return;
    }
    this.importing = true;
    try {
      await this.run(mainNote);
    } catch (error) {
      console.error("取り込み失敗:", error);
      new Notice(`⚠️ 取り込みに失敗しました: ${error.message}`);
      if (this.plugin.state.pendingImport)
        new Notice("作成済みファイルは保持しています。コマンド「未完了の取り込みを復旧」で元ノートへのリンクを復元できます。");
    } finally {
      this.importing = false;
      this.plugin.scheduleMaint();
    }
  }

  // 途中失敗時に作成・再利用済みのファイルを元ノートへ接続し直す。ファイルは削除しない。
  async recover() {
    if (this.importing) return;
    const plugin = this.plugin;
    const pending = plugin.state.pendingImport;
    if (!pending) { new Notice("未完了の取り込みはありません。"); return; }
    this.importing = true;
    try {
      const main = plugin.app.vault.getAbstractFileByPath(pending.mainNotePath);
      if (!main || main.extension !== "md" || Object.values(FOLDERS).some(folder => main.path.startsWith(`${folder}/`)))
        throw new Error("元ノートが見つからないか管理フォルダ内です。元の場所へ戻してから復旧してください。");
      const names = [];
      for (const target of pending.paths ?? []) {
        const file = plugin.app.vault.getAbstractFileByPath(target);
        if (!file || !["md", "base"].includes(file.extension)) continue;
        if (!Object.values(FOLDERS).some(folder => file.path.startsWith(`${folder}/`))) continue;
        const basePath = `${FOLDERS.base}/${pending.baseFileName}`;
        if (file.extension === "md" && pending.paths.includes(basePath) && plugin.app.vault.getAbstractFileByPath(basePath))
          await plugin.baseManager.addMetaBaseName(file, pending.baseFileName);
        names.push(file.extension === "base" ? file.name : file.basename);
      }
      await plugin.baseManager.appendLinks(main, names);
      const { pendingImport, ...completed } = plugin.state;
      await plugin.saveData(completed);
      delete plugin.state.pendingImport;
      plugin.refreshBaseLabels();
      new Notice(`取り込みの復旧が完了しました（接続対象${names.length}件）。内容を確認してください。`);
    } catch (error) {
      new Notice(`復旧できませんでした: ${error.message}`);
    } finally {
      this.importing = false;
      plugin.scheduleMaint();
    }
  }

  async recordTarget(file) {
    const pending = this.plugin.state.pendingImport;
    if (!pending.paths.includes(file.path)) pending.paths.push(file.path);
    await this.plugin.saveData(this.plugin.state);
  }

  async discardRecovery() {
    if (this.importing || !this.plugin.state.pendingImport) return;
    if (!confirm("未完了の取り込み記録だけを解除します。作成済みファイルは残ります。元ノートへの接続を手動で確認済みの場合に使用してください。よろしいですか？")) return;
    const { pendingImport, ...completed } = this.plugin.state;
    try {
      await this.plugin.saveData(completed);
      delete this.plugin.state.pendingImport;
      new Notice("取り込み記録を解除しました。ファイルは保持しています。");
    } catch (error) {
      new Notice(`取り込み記録を解除できませんでした: ${error.message}`);
    }
  }

  // ファイルを分類し、Vault内リンクまたは外部ファイル用管理ファイルを登録する。
  async run(mainNote) {
    const plugin = this.plugin;
    const baseManager = plugin.baseManager;
    const electron = require("electron");
    const dialog = (electron.remote ?? require("@electron/remote")).dialog;
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "🔗 接続したい外部ファイルを選択してください",
      properties: ["openFile", "multiSelections"],
      buttonLabel: "一括接続",
    });
    if (canceled || filePaths.length === 0) return;

    const vaultLinks = [];
    const externalPaths = [];
    for (const rawPath of filePaths) {
      const vaultPath = this.getVaultRelativePath(rawPath);
      if (vaultPath) vaultLinks.push(vaultPath);
      else externalPaths.push(rawPath);
    }

    let baseName = "";
    if (externalPaths.length > 0) {
      const input = await new BaseNameModal(plugin.app).waitForValue();
      if (input === null) return;
      baseName = input;
      const existingNames = await baseManager.getLinkedBaseNames(mainNote);
      if (existingNames.has(baseName)) {
        new Notice(
          `このメインノートには「${baseName}」というBaseが既にあります。別の名前を指定してください。`,
        );
        return;
      }
    }

    let metaBySource = new Map();
    const linkNames = [...vaultLinks];
    let created = 0;
    let reused = 0;
    let thumbFailed = 0;
    let groupBases = [];

    if (externalPaths.length > 0) {
      plugin.state.pendingImport = { mainNotePath: mainNote.path, paths: [], startedAt: new Date().toISOString() };
      await plugin.saveData(plugin.state);
      await baseManager.ensureFolders();
      metaBySource = baseManager.scanVault();
      const base = await baseManager.createGroupBase(baseName);
      plugin.state.pendingImport.baseFileName = base.name;
      await this.recordTarget(base);
      const baseFileName = base.name;

      for (const rawPath of externalPaths) {
        const source = toSourceUrl(rawPath.replace(/\\/g, "/"));
        const existing = metaBySource.get(source);
        if (existing) {
          await this.recordTarget(existing);
          await baseManager.addMetaBaseName(existing, baseFileName);
          linkNames.push(existing.basename);
          reused++;
          continue;
        }

        const result = await this.createMetaNote(rawPath, source, baseFileName);
        await this.recordTarget(result.file);
        metaBySource.set(source, result.file);
        linkNames.push(result.file.basename);
        created++;
        if (result.thumbFailed) thumbFailed++;
      }

      groupBases = [base];
      linkNames.push(base.name);
      plugin.refreshBaseLabels();
    }

    const appended = await baseManager.appendLinks(mainNote, linkNames);
    if (plugin.state.pendingImport) {
      const { pendingImport, ...completed } = plugin.state;
      await plugin.saveData(completed);
      delete plugin.state.pendingImport;
    }
    new Notice(
      [
        "🎉 ファイルの登録完了！",
        `・Vault内ファイル（直接リンク）: ${vaultLinks.length}件`,
        `・新規メタノート: ${created}件`,
        `・既存メタノート再利用: ${reused}件`,
        `・linksへの追記: ${appended}件`,
        groupBases.length && `・このグループのBase: ${groupBases.length}件`,
        thumbFailed && `⚠️ サムネイル生成失敗: ${thumbFailed}件`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // 選択されたOS絶対パスがVault内なら、Obsidian形式の相対パスを返す。
  getVaultRelativePath(rawPath) {
    const basePath = this.plugin.app.vault.adapter.basePath;
    if (!basePath) return null;
    const absolutePath = path.resolve(rawPath);
    const relativePath = path.relative(path.resolve(basePath), absolutePath);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return null;
    }
    return relativePath.split(path.sep).join("/");
  }

  // 外部ファイルのメタノートを作り、画像ならサムネイルも生成する。
  async createMetaNote(rawPath, source, baseFileName) {
    const plugin = this.plugin;
    const title = newId();
    const file = await plugin.app.vault.create(`${FOLDERS.meta}/${title}.md`, "");
    await this.recordTarget(file);
    let thumbPath = null;
    let thumbFailed = false;
    if (this.isImage(rawPath)) {
      const candidate = `${FOLDERS.thumb}/${newId()}.webp`;
      try {
        await makeThumbnail(
          plugin.app,
          rawPath,
          candidate,
          CONFIG.thumbnailMaxEdge,
        );
        thumbPath = candidate;
      } catch (error) {
        console.error("サムネイル生成失敗:", rawPath, error);
        thumbFailed = true;
      }
    }
    await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.source = source;
      frontmatter.topologyKeeper = true;
      frontmatter.title = filenameFromSource(source);
      frontmatter.base = [baseFileName];
      if (thumbPath) frontmatter.cover = `[[${thumbPath}]]`;
    });
    return { file, thumbFailed };
  }
}

module.exports = ImportWorkflow;
