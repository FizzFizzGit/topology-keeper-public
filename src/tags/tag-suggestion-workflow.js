const { Notice } = require('obsidian');
const { computeTagSuggestions, TagSuggestModal } = require('./tag-suggest');
const { TagSuggestionCache } = require('./tag-suggest-cache');
const { t } = require('../i18n/i18n');

// タグ候補のキャッシュ、提案画面、選択されたタグの反映を管理する。
class TagSuggestionWorkflow {
  constructor(plugin) {
    this.plugin = plugin;
    this.cache = new TagSuggestionCache();
    const invalidate = () => this.cache.invalidate();
    for (const event of ['modify', 'create', 'delete', 'rename']) {
      plugin.registerEvent(plugin.app.vault.on(event, invalidate));
    }
    for (const event of ['changed', 'resolved']) {
      plugin.registerEvent(plugin.app.metadataCache.on(event, invalidate));
    }
  }

  async suggest(file) {
    const { app, files, state } = this.plugin;
    const items = await computeTagSuggestions(app, file, files.isManaged, state.tagStopWords, this.cache);
    if (this.disposed) return;
    if (!items.length) {
      new Notice(t('tags.none'));
      return;
    }
    new TagSuggestModal(app, file, items, picked => this.applyTags(file, picked)).open();
  }

  async applyTags(file, picked) {
    if (!picked.length || this.disposed) return;
    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      const current = frontmatter.tags;
      const tags = Array.isArray(current) ? current : String(current || '').split(/[,\s]+/).filter(Boolean);
      frontmatter.tags = [...new Set([...tags, ...picked])];
    });
    new Notice(t('tags.added', { count: picked.length }));
  }

  dispose() {
    this.disposed = true;
    this.cache.dispose();
  }
}

module.exports = TagSuggestionWorkflow;
