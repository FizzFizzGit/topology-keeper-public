const { Notice, getAllTags } = require("obsidian");
const { BaseNameModal, BaseTagModal } = require("./base-modal");
const { FOLDERS } = require("./plugin-settings");
const { inFolder } = require("./file-utils");

// 利用者の入力を伴うBase作成フローを管理する。
// Baseの内容生成・保存はBaseManagerに委譲し、同じフローの二重起動だけを防ぐ。
class BaseWorkflow {
  constructor(plugin) {
    this.plugin = plugin;
    this.creatingStandalone = false;
  }

  // タグ条件付きのBaseを単体作成する。メインノートには紐づけない。
  // タグ候補はメタノートのfrontmatterから取得し、選択後にBaseManagerへ渡す。
  async createStandalone() {
    const plugin = this.plugin;
    if (this.creatingStandalone) return;
    this.creatingStandalone = true;
    try {
      const viewName = await new BaseNameModal(plugin.app).waitForValue();
      if (viewName === null) return;

      const available = new Set();
      for (const file of plugin.app.vault.getMarkdownFiles()) {
        if (!inFolder(file, FOLDERS.meta)) continue;
        const cache = plugin.app.metadataCache.getFileCache(file);
        for (const tag of getAllTags(cache) ?? [])
          available.add(tag.replace(/^#/, ""));
      }
      const tags = await new BaseTagModal(
        plugin.app,
        [...available].sort((a, b) => a.localeCompare(b, "ja")),
      ).waitForTags();
      if (tags === null) return;

      await plugin.baseManager.ensureFolders();
      const base = await plugin.baseManager.createGroupBase(viewName, tags, false);
      plugin.refreshBaseLabels();
      new Notice(
        `Baseを作成しました: ${base.basename}${tags.length ? `（タグ条件 ${tags.length}件）` : "（タグ条件なし）"}`,
      );
    } catch (error) {
      console.error("Base作成失敗:", error);
      new Notice(`Base作成に失敗しました: ${error.message}`);
    } finally {
      this.creatingStandalone = false;
    }
  }
}

module.exports = BaseWorkflow;
