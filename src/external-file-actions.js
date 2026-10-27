const { Notice } = require("obsidian");
const { findMetaThumbnail } = require("./external-file-data");
const { pathFromSource, toSourceUrl } = require("./source-url");
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
  showRename(entry) {
    const sourcePath = pathFromSource(entry.source);
    if (!sourcePath) return new Notice("ローカルファイルの参照ではありません。");
    const RenameExternalModal = require("./rename-external-modal");
    new RenameExternalModal(this.app, path.basename(sourcePath), async (name) => {
      await this.renameExternal(entry, name);
      new Notice("外部ファイルの名前を変更しました。");
    }).open();
  }

  async renameExternal(entry, name) {
    if (this.moving) throw new Error("ファイルの移動処理中です。");
    if (this.renaming) throw new Error("名前の変更処理中です。");
    if (typeof name !== "string" || !name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
      throw new Error("使用できないファイル名です。");
    const original = pathFromSource(entry.source);
    if (!original) throw new Error("ローカルファイルの参照ではありません。");
    const target = path.join(path.dirname(original), name);
    return this.relocateExternal(entry, target);
  }

  showMove(entries) {
    const MoveExternalModal = require("./move-external-modal");
    new MoveExternalModal(this.app, entries, this).open();
  }

  async moveExternalFiles(entries, folder) {
    if (this.moving || this.renaming) throw new Error("別のファイル操作が進行中です。");
    if (!entries.length) throw new Error("移動するファイルを選択してください。");
    if (!path.isAbsolute(folder) || /^[\\/]{2}/.test(folder)) throw new Error("ローカルの移動先フォルダーを選択してください。");
    this.moving = true;
    const completed = [];
    try {
      const destination = await fs.promises.realpath(folder);
      if (!(await fs.promises.stat(destination)).isDirectory() || /^[\\/]{2}/.test(destination))
        throw new Error("ローカルのフォルダーを選択してください。");
      const targets = new Set();
      const originals = new Set();
      const plans = [];
      const key = value => require("process").platform === "win32" ? value.toLowerCase() : value;
      // 全件を先に検証し、衝突があれば移動を開始しない。
      for (const entry of entries) {
        const original = pathFromSource(entry.source);
        if (!original) throw new Error("参照先が不正なファイルがあります。");
        if (originals.has(key(original))) continue;
        originals.add(key(original));
        const stat = await fs.promises.lstat(original);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`通常のファイルではありません: ${original}`);
        const target = path.join(destination, path.basename(original));
        if (key(await fs.promises.realpath(path.dirname(original))) === key(destination))
          throw new Error(`既に移動先フォルダーにあります: ${original}`);
        if (targets.has(key(target))) throw new Error(`選択したファイルの名前が重複しています: ${path.basename(target)}`);
        targets.add(key(target));
        try {
          await fs.promises.lstat(target);
          throw new Error(`移動先に同名のファイルがあります: ${target}`);
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        plans.push({ entry, target });
      }
      for (const { entry, target } of plans) {
        await this.relocateExternal(entry, target);
        completed.push(entry.source);
      }
      return completed;
    } catch (error) {
      error.completed = completed;
      throw error;
    } finally {
      this.moving = false;
    }
  }

  async relocateExternal(entry, target) {
    if (this.renaming) throw new Error("別のファイル操作が進行中です。");
    const original = pathFromSource(entry.source);
    if (!original) throw new Error("ローカルファイルの参照ではありません。");
    if (target === original) return;
    this.renaming = true;
    const changed = [];
    let linked = false;
    try {
      const stat = await fs.promises.lstat(original);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("通常のファイルだけ名前を変更できます。");
      const references = this.app.vault.getMarkdownFiles().filter(file => {
        if (!file.path.startsWith(`${this.FOLDERS.meta}/`)) return false;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return pathFromSource(fm?.source) === original || pathFromSource(fm?.Source) === original;
      });
      if (!references.some(file => file.path === entry.file.path)) throw new Error("参照先が更新されています。表示を更新してからやり直してください。");
      // 排他的にコピーし、参照の更新が完了してから元の名前を削除する。
      // 宛先が存在する場合は上書きせず失敗する。
      await fs.promises.copyFile(original, target, fs.constants.COPYFILE_EXCL);
      linked = true;
      await fs.promises.utimes(target, stat.atime, stat.mtime);
      for (const file of references) {
        const previous = {};
        changed.push({ file, previous });
        await this.app.fileManager.processFrontMatter(file, fm => {
          for (const key of ["source", "Source"]) {
            if (pathFromSource(fm[key]) !== original) continue;
            previous[key] = fm[key];
            fm[key] = toSourceUrl(target);
          }
        });
      }
      const current = await fs.promises.lstat(original);
      if (current.ino !== stat.ino || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs)
        throw new Error("処理中に元ファイルが変更されました。もう一度やり直してください。");
      await fs.promises.unlink(original);
    } catch (error) {
      let rollbackFailed = false;
      for (const { file, previous } of changed.reverse()) {
        try {
          await this.app.fileManager.processFrontMatter(file, fm => {
            for (const [key, value] of Object.entries(previous)) {
              if (fm[key] === toSourceUrl(target)) fm[key] = value;
            }
          });
        } catch { rollbackFailed = true; }
      }
      if (linked && !rollbackFailed) {
        try { await fs.promises.unlink(target); } catch { rollbackFailed = true; }
      }
      if (rollbackFailed) throw new Error(`参照の復元を完了できませんでした。元ファイルと変更先を確認してください: ${original} / ${target}`);
      if (error.code === "EEXIST") throw new Error("同名のファイルが存在します。別の名前を指定してください。");
      throw new Error(`ファイルを変更できませんでした: ${error.message}`);
    } finally {
      this.renaming = false;
    }
  }

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
