const { randomUUID } = require('crypto');
const path = require('path').posix;
const { pageUrl } = require('./web-page-capture');
const { normalizeThumbnailOptions } = require('./web-thumbnail-data');
const { addThumbnailTitle } = require('./web-thumbnail-title');

/** 標準Markdownの画像リンクを引用として生成する。独自レンダラーには依存しない。 */
function thumbnailMarkdown(sourcePath, imagePath, url, title) {
  // UUIDをVault全体で一意にして保存するため、Obsidianが解決できるファイル名だけを使う。
  const filename = encodeURIComponent(path.basename(imagePath));
  // ページ側のタイトルを本文へ挿すため、HTMLやMarkdown装飾として解釈させない。
  const label = String(title).replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\\[\]`*_{}|]/g, '\\$&');
  const target = pageUrl(url).replace(/[<>]/g, character => encodeURIComponent(character));
  return `> [![${label}](<${filename}>)](<${target}>)`;
}

/**
 * 撮影→確認→保存→選択URLの置換を調整する。Electron・Modal・通知は注入してテスト可能にする。
 * 中断時は元ノートを変更しない。画像保存後に競合が起きた場合は、その画像だけを削除する。
 * 画像名はUUID.png。生成パスと幅を保存し、参照が無くなったものを孤立チェックで検出する。
 */
class WebThumbnailWorkflow {
  constructor(plugin, { capture, createModal, getBrowserWindow, notice, t, decorate = addThumbnailTitle }) {
    Object.assign(this, { plugin, capture, createModal, getBrowserWindow, notice, t, decorate });
  }
  async run(editor, view, { promptUrl = false } = {}) {
    const { t, notice } = this;
    if (this.controller) { notice(t('webThumbnail.busy')); return; }
    const file = view.file;
    const selected = editor.getSelection();
    const cursor = editor.getCursor();
    const input = selected || (promptUrl ? '' : editor.getLine(cursor.line));
    let url;
    try { url = pageUrl(input); }
    catch {
      if (!promptUrl) { notice(t('webThumbnail.invalidUrl')); return; }
      url = '';
    }
    // ボタンから起動しURL未選択なら、選択文字列を消さず開始時のカーソルへ挿入する。
    const replaceSelected = !!selected && !!url;
    const source = { file, path: file.path, content: editor.getValue(),
      from: replaceSelected ? editor.getCursor('from') : promptUrl ? { ...cursor } : { line: cursor.line, ch: 0 },
      to: replaceSelected ? editor.getCursor('to') : promptUrl ? { ...cursor } : { line: cursor.line, ch: input.length } };
    // プロパティ表示中はエディタのカーソルが0行目を指す場合がある。
    // YAMLより前へ画像を入れるとfrontmatter全体が本文扱いになるため、
    // プロパティにかかる選択は置換せず、閉じ区切りの後へ挿入する。
    const sourceLines = source.content.split('\n');
    if (/^\uFEFF?---\s*$/.test(sourceLines[0])) {
      const end = sourceLines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
      if (end > 0 && source.from.line <= end) {
        const position = end + 1 < sourceLines.length ? { line: end + 1, ch: 0 }
          : { line: end, ch: sourceLines[end].length };
        source.from = { ...position };
        source.to = { ...position };
      }
    }
    const controller = this.controller = new AbortController();
    let image;
    const unchanged = () => !controller.signal.aborted && view.file === source.file && view.file.path === source.path
      && editor.getValue() === source.content
      && this.plugin.app.vault.getAbstractFileByPath(source.path) === source.file;
    try {
      this.modal = this.createModal(url, () => controller.abort());
      const selectedOptions = await this.modal.configure();
      if (!selectedOptions || controller.signal.aborted) return;
      const options = normalizeThumbnailOptions(selectedOptions);
      url = pageUrl(selectedOptions.url ?? url);
      const BrowserWindow = this.getBrowserWindow();
      if (!unchanged()) throw new Error('source-changed');
      const captured = await this.capture(url, { BrowserWindow, signal: controller.signal, thumbnailWidth: options.width });
      if (controller.signal.aborted) return;
      const result = { ...captured, png: await this.decorate(captured.png, captured.title, options) };
      if (controller.signal.aborted) return;
      if (!unchanged()) throw new Error('source-changed');
      if (!await this.modal.confirm(result)) return;
      if (!unchanged()) throw new Error('source-changed');
      const vault = this.plugin.app.vault;
      const folder = this.plugin.state.folders.thumb;
      let current = '';
      for (const part of folder.split('/')) {
        current = current ? `${current}/${part}` : part;
        if (!vault.getAbstractFileByPath(current)) {
          try { await vault.createFolder(current); }
          catch (error) { if (!vault.getAbstractFileByPath(current)) throw error; }
        }
      }
      if (!unchanged()) throw new Error('source-changed');
      const bytes = Uint8Array.from(result.png).buffer;
      let filename;
      for (let attempt = 0; attempt < 5; attempt++) {
        filename = `${randomUUID()}.png`;
        if (!vault.getFiles().some(file => file.name === filename)) break;
        filename = null;
      }
      if (!filename) throw new Error('thumbnail-name-conflict');
      image = await vault.createBinary(`${folder}/${filename}`, bytes);
      const records = this.plugin.state.webThumbnailFiles ??= {};
      records[image.path] = options.width;
      // 任意のUUID名PNGを誤って削除候補にしないよう、生成記録を挿入より先に保存する。
      await this.plugin.saveData(this.plugin.state);
      if (!unchanged()) throw new Error('source-changed');
      let markdown = thumbnailMarkdown(source.path, image.path, url, result.title);
      const lines = source.content.split('\n');
      const before = lines[source.from.line].slice(0, source.from.ch);
      const after = lines[source.to.line].slice(source.to.ch);
      // 引用記号は行頭でのみ有効。文章中のURLを選んだ場合は独立したブロックへ分ける。
      // すでに「> URL」の形なら、既存の引用記号を使って二重にしない。
      if (/^\s*>\s*$/.test(before)) markdown = markdown.slice(2);
      else if (before.trim()) markdown = `\n\n${markdown}`;
      if (after.trim()) markdown += '\n\n';
      editor.replaceRange(markdown, source.from, source.to);
      image = null; // ノートへの挿入完了後は管理を利用者へ引き渡す。
      notice(t('webThumbnail.done'));
    } catch (error) {
      if (image) {
        try {
          await this.plugin.app.vault.delete(image);
          delete this.plugin.state.webThumbnailFiles?.[image.path];
          await this.plugin.saveData(this.plugin.state).catch(() => {});
        }
        catch { notice(t('webThumbnail.savedImage', { path: image.path })); }
      }
      if (!controller.signal.aborted) {
        const keys = { 'source-changed': 'webThumbnail.sourceChanged', 'capture-timeout': 'webThumbnail.timeout',
          'capture-unavailable': 'webThumbnail.unavailable', 'capture-blank': 'webThumbnail.blank' };
        notice(keys[error.message] ? t(keys[error.message]) : t('webThumbnail.failed', { reason: error.message }));
      }
    } finally {
      this.modal?.close();
      this.modal = null;
      this.controller = null;
    }
  }
  dispose() { this.controller?.abort(); this.modal?.close(); }
}

module.exports = { thumbnailMarkdown, WebThumbnailWorkflow };
