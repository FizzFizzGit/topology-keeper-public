const { ItemView, Notice } = require('obsidian');
const { t } = require('../i18n/i18n');
const { WINDOW_PLACEMENTS } = require('../settings/window-appearance');

// 既存のウィンドウDOMをObsidianのタブに載せる。表示内容と開閉状態は各ウィンドウが持つ。
class SidebarWindows {
  constructor(plugin) {
    this.plugin = plugin;
    this.workspace = plugin.app.workspace;
    this.open = new Map();
    for (const [kind, title, icon] of WINDOW_PLACEMENTS) {
      const owner = this;
      const type = this.type(kind);
      plugin.registerView(type, leaf => new class extends ItemView {
        getViewType() { return type; }
        getDisplayText() { return t(title); }
        getIcon() { return icon; }
        getState() { return { side: this.side }; }
        async setState(state, result) {
          this.side = state?.side;
          await super.setState(state, result);
        }
        async onOpen() { this.contentEl.classList.add('tk-sidebar-host'); }
        async onClose() { owner.closed(kind, leaf); }
      }(leaf));
    }
  }

  type(kind) { return `${this.plugin.manifest.id}-${kind}-panel`; }

  placement(kind) { return this.plugin.state.windowPlacement?.[kind] ?? 'floating'; }

  async show(kind, element, onClose, reveal = true) {
    if (this.disposed) return;
    const side = this.placement(kind);
    if (side === 'floating') {
      this.hide(kind);
      this.workspace.detachLeavesOfType(this.type(kind));
      return;
    }
    const existing = this.open.get(kind);
    if (existing?.element === element && existing.side === side) {
      if (reveal && existing.mounted) await this.workspace.revealLeaf(existing.leaf).catch(console.error);
      return;
    }
    if (existing) this.hide(kind);
    const type = this.type(kind);
    const restored = this.workspace.getLeavesOfType(type);
    let leaf = restored.find(candidate => candidate.getViewState().state?.side === side);
    for (const other of restored) if (other !== leaf) other.detach();
    leaf ??= side === 'left' ? this.workspace.getLeftLeaf(false) : this.workspace.getRightLeaf(false);
    if (!leaf) return new Notice(t('settings.sidebarUnavailable'));

    const entry = { leaf, side, element, parent: element.parentElement, onClose, mounted: false };
    this.open.set(kind, entry);
    element.classList.add('tk-dock-pending');
    try {
      if (!restored.includes(leaf)) await leaf.setViewState({ type, state: { side }, active: false });
      if (this.open.get(kind) !== entry) return;
      // revealLeaf loads a deferred view. On older hosts setViewState loads it immediately.
      if (reveal || !leaf.view?.contentEl) await this.workspace.revealLeaf(leaf);
      if (this.open.get(kind) !== entry) return;
      leaf.view.contentEl.appendChild(element);
      entry.mounted = true;
      element.classList.add('tk-docked-window');
      element.classList.remove('tk-dock-pending');
    } catch (error) {
      if (this.open.get(kind) !== entry) return;
      this.hide(kind);
      new Notice(t('settings.sidebarUnavailable'));
      console.error('Topology Keeper sidebar:', error);
    }
  }

  release(kind, entry) {
    this.open.delete(kind);
    entry.element.classList.remove('tk-docked-window', 'tk-dock-pending');
    if (entry.mounted) entry.parent?.appendChild(entry.element);
  }

  hide(kind) {
    const entry = this.open.get(kind);
    if (entry) {
      this.release(kind, entry);
      entry.leaf.detach();
    }
  }

  closed(kind, leaf) {
    const entry = this.open.get(kind);
    if (entry?.leaf !== leaf) return;
    this.release(kind, entry);
    entry.onClose?.();
  }

  dispose() {
    this.disposed = true;
    for (const [kind] of WINDOW_PLACEMENTS) {
      this.hide(kind);
      this.workspace.detachLeavesOfType(this.type(kind));
    }
  }
}

module.exports = { SidebarWindows };
