const { Notice } = require("obsidian");
const { findMetaThumbnail } = require("./external-file-data");
const { pathFromSource } = require("./source-url");
const fs = require("fs");
const path = require("path");
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse",
  ".wsf", ".wsh", ".scr", ".msi", ".msp", ".hta", ".lnk", ".url", ".reg",
  ".sh", ".command", ".app", ".desktop", ".jar",
]);

// 外部ファイル管理に関わるOS操作とVault更新をまとめる。
class ExternalFileActions {
  constructor(app, { CONFIG, FOLDERS, TFile, isImage, getSettings }) {
    this.app = app;
    this.CONFIG = CONFIG;
    this.FOLDERS = FOLDERS;
    this.TFile = TFile;
    this.isImage = isImage;
    this.getSettings = getSettings;
  }

  // メタノートの cover が指す、管理対象サムネイルの TFile を返す。
  getThumbnailForMeta(file) {
    return findMetaThumbnail({
      app: this.app,
      file,
      thumbFolder: this.FOLDERS.thumb,
      TFile: this.TFile,
    });
  }

  // file:/// URL が指す外部ファイルをOSの既定アプリで開く。
  async openExternal(source) {
    try {
      let sourcePath = pathFromSource(source);
      if (!sourcePath || BLOCKED_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()))
        throw new Error("ローカルファイルのURLではないか、実行形式のため開けません。");
      sourcePath = await fs.promises.realpath(sourcePath);
      if (/^[\\/]{2}/.test(sourcePath) || BLOCKED_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()))
        throw new Error("ネットワークパスや実行形式へのリンクは開けません。");
      if (!(await fs.promises.stat(sourcePath)).isFile()) throw new Error("通常のファイルではありません。");
      const error = await require("electron").shell.openPath(sourcePath);
      if (error) throw new Error(error);
    } catch (error) {
      new Notice(`⚠️ 元ファイルを開けませんでした: ${error.message}`);
    }
  }

  // 画像のメタノートを開いたときだけ、元画像もOSの既定アプリで開く。
  async openMetaSource(file) {
    if (!this.getSettings().autoOpenExternalImages) return;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const source = frontmatter?.source ?? frontmatter?.Source;
    if (typeof source !== "string" || !source.trim()) return;
    if (!this.isImage(pathFromSource(source.trim()))) return;
    await this.openExternal(source.trim());
  }

  // メインノートの links から1件を外し、設定時にはメタノートとサムネイルもゴミ箱へ移す。
  async removeLink(file, entry) {
    const trashTargets = [];
    if (this.CONFIG.trashOnRemove && entry.kind === "asset") {
      const thumb = this.getThumbnailForMeta(entry.file);
      trashTargets.push(entry.file, ...(thumb instanceof this.TFile ? [thumb] : []));
      if (
        !confirm(
          `「${entry.label}」のメタノートとサムネイルをゴミ箱へ移動します。よろしいですか？`,
        )
      )
        return;
    }

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[this.CONFIG.properties.links] = []
        .concat(frontmatter[this.CONFIG.properties.links] ?? [])
        .filter((value) => value !== entry.raw);
    });
    for (const target of trashTargets)
      await this.app.fileManager.trashFile(target);
  }
}

module.exports = ExternalFileActions;
