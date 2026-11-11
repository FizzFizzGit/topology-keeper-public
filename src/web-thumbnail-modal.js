const { Modal } = require('obsidian');
const { t } = require('./i18n');
const { normalizeThumbnailOptions } = require('./web-thumbnail-data');
const { pageUrl } = require('./web-page-capture');

/** 撮影中のキャンセルと、撮影結果の確認を一つの画面で扱う。画像は挿入するまでメモリ内だけ。 */
class WebThumbnailModal extends Modal {
  constructor(app, url, cancel) { super(app); this.url = url; this.cancel = cancel; this.accepted = false; }
  onOpen() {
    this.setTitle(t('webThumbnail.title'));
    const urlLabel = this.contentEl.createEl('label', { text: t('webThumbnail.url') });
    const urlInput = urlLabel.createEl('input', { cls: 'tk-web-thumbnail-input',
      attr: { type: 'text', inputmode: 'url', placeholder: 'https://example.com/' } });
    urlInput.value = this.url;
    const widthLabel = this.contentEl.createEl('label', { text: t('webThumbnail.width') });
    const width = widthLabel.createEl('input', { attr: { type: 'number', min: '64', max: '1024', step: '1' } });
    width.value = '256';
    this.contentEl.createEl('p', { text: t('webThumbnail.widthHelp') });
    const titleLabel = this.contentEl.createEl('label');
    const showTitle = titleLabel.createEl('input', { attr: { type: 'checkbox' } });
    showTitle.checked = true;
    titleLabel.createSpan({ text: t('webThumbnail.showTitle') });
    const error = this.contentEl.createEl('p', { cls: 'mod-warning' });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close());
    buttons.createEl('button', { text: t('webThumbnail.capture'), cls: 'mod-cta' }).addEventListener('click', () => {
      let url;
      try { url = pageUrl(urlInput.value); }
      catch {
        error.textContent = t('webThumbnail.invalidUrl');
        urlInput.focus?.();
        return;
      }
      const value = Number(width.value);
      if (!Number.isInteger(value) || value < 64 || value > 1024) {
        error.textContent = t('webThumbnail.invalidWidth');
        width.focus?.();
        return;
      }
      this.url = url;
      this.options = { ...normalizeThumbnailOptions({ width: value, showTitle: showTitle.checked }), url };
      this.resolveOptions?.(this.options);
      this.resolveOptions = null;
      this.showLoading();
    });
  }
  configure() {
    return new Promise(resolve => { this.resolveOptions = resolve; this.open(); });
  }
  showLoading() {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: t('webThumbnail.loading') });
    this.contentEl.createEl('p', { text: this.url, cls: 'tk-web-thumbnail-url' });
    this.contentEl.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close());
  }
  confirm(result) {
    return new Promise(resolve => {
      this.resolve = resolve;
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: t('webThumbnail.previewHelp') });
      this.objectUrl = URL.createObjectURL(new Blob([result.png], { type: 'image/png' }));
      this.contentEl.createEl('img', { cls: 'tk-web-thumbnail-preview', attr: { src: this.objectUrl, alt: result.title } });
      this.contentEl.createEl('p', { text: result.url, cls: 'tk-web-thumbnail-url' });
      const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
      buttons.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close());
      buttons.createEl('button', { text: t('webThumbnail.insert'), cls: 'mod-cta' }).addEventListener('click', () => {
        this.accepted = true;
        this.close();
      });
    });
  }
  onClose() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    if (!this.accepted) this.cancel();
    this.resolveOptions?.(null);
    this.resolve?.(this.accepted);
    this.contentEl.empty();
  }
}

module.exports = { WebThumbnailModal };
