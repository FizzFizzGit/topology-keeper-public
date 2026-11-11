const { APPEARANCE_FIELDS, normalizeWindowAppearance, WINDOW_PLACEMENTS,
  PLACEMENT_CHOICES, normalizeWindowPlacement } = require('./window-appearance');

/**
 * 「ウィンドウ共通」だけを描画する設定画面部品。
 * 入力: ObsidianのSettingクラスと翻訳関数を引数で受け取る。
 * 出力: container内のDOMとplugin.stateを更新し、利用者の変更時だけ保存する。
 * 他の設定画面・Vault操作・分析計算には触れない。テストではSettingを差し替え可能。
 */
function renderWindowSettings(container, plugin, { Setting, t }) {
  container.createEl('h3', { text: t('settings.windowAppearance') });
  for (const field of APPEARANCE_FIELDS) {
    const current = normalizeWindowAppearance(plugin.state.windowAppearance)[field.key];
    new Setting(container).setName(t(field.name)).setDesc(t(field.description)).addDropdown(dropdown => {
      // 手編集された中間値も選択肢へ加え、保存値と画面表示の食い違いを防ぐ。
      for (const value of [...new Set([...field.choices, current])].sort((a, b) => a - b))
        dropdown.addOption(String(value), value === 0 ? t(field.defaultLabel) : `${value}${field.unit}`);
      dropdown.setValue(String(current)).onChange(async value => {
        plugin.state.windowAppearance = normalizeWindowAppearance({
          ...plugin.state.windowAppearance, [field.key]: Number(value),
        });
        // 再分析・再描画ではなくCSSと窓の位置だけを更新する。
        plugin.applyWindowAppearance();
        await plugin.saveData(plugin.state);
      });
    });
  }
  container.createEl('h3', { text: t('settings.windowPlacement') });
  for (const [kind, title] of WINDOW_PLACEMENTS) {
    new Setting(container).setName(t(title)).addDropdown(dropdown => {
      for (const choice of PLACEMENT_CHOICES) dropdown.addOption(choice, t(`settings.placement.${choice}`));
      dropdown.setValue(normalizeWindowPlacement(plugin.state.windowPlacement)[kind]).onChange(async value => {
        plugin.state.windowPlacement = normalizeWindowPlacement({ ...plugin.state.windowPlacement, [kind]: value });
        plugin.applyWindowPlacement(kind);
        await plugin.saveData(plugin.state);
      });
    });
  }
}

module.exports = { renderWindowSettings };
