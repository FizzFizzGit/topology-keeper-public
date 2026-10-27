// 外部ファイル管理欄の表示。操作そのものはプラグイン本体の既存メソッドへ委譲する。
//
// 【入力】
//   manager : 描画先の DOM 要素（小窓の「ファイル管理」欄）。
//   ext     : main.js の computeExternal の戻り値。
//             null（開いているノートが無い）、または { file, main, entries }。
//               file    : いま開いているノートの TFile
//               entries : collectExternalEntries の戻り値（external-file-data.js 参照）。
//                         { raw, kind, label, file?, source? } の配列。kind は
//                         "base" / "asset" / "other" / "missing"。
//   plugin  : プラグイン本体。ファイルを開く・コピーする・linksを更新する操作口を提供する。
//   ui      : section / iconButton を受け取る。メイン窓のUIクラスが生成する部品を使う。
// 【出力】 戻り値は無い。manager の中に DOM を追加するだけ。このファイルは何も保存・書き換えしない。
//   利用者の操作は次のとおり本体へ委譲される。
//     名前のクリック            → ノートを開く（asset は元ファイルを既定アプリで開く: plugin.externalFileActions.openExternal(entry.source)）
//     「リンクを外す」（x）      → plugin.externalFileActions.removeLink(ext.file, entry)。ext.file の frontmatter.links から entry.raw を取り除く
//     コピー                    → plugin.copyInternalLink(entry.file)（"[[<Vault相対パス>]]" をクリップボードへ）
const { setIcon, setTooltip } = require("obsidian");
const { attachHoverMenu } = require("./hover-menu");

function createEditMenu(plugin, row, entry, mainFile) {
  row.setAttr("tabindex", "0");
  row.setAttr("role", "group");
  row.setAttr("aria-label", entry.label);
  row.setAttr("aria-haspopup", "menu");
  row.setAttr("aria-expanded", "false");
  const items = [];
  if (entry.kind === "asset" && entry.source) {
    items.push({ title: "ファイル名の変更", icon: "pencil", action: () => plugin.externalFileActions.showRename(entry) });
  }
  if (entry.file) {
    items.push({ title: "リンクをコピー", icon: "copy", action: () => plugin.copyInternalLink(entry.file) });
  }
  items.push({ title: "リンクの削除", icon: "unlink", action: () => plugin.externalFileActions.removeLink(mainFile, entry) });
  attachHoverMenu(row, row, items, entry.label);
}

function renderExternalFiles(plugin, manager, ext, { CSS_CLASS, EVENT, section, iconButton }) {
    if (!ext) {
      const note = manager.createDiv({ cls: CSS_CLASS.alpEmpty });
      note.setText("ノートを開くと、関連ファイルを管理できます");
    }
    const bases = ext ? ext.entries.filter((e) => e.kind === "base") : [];
    const files = ext ? ext.entries.filter((e) => e.kind !== "base") : [];

    const baseSec = section(manager, "bases", `Base (${bases.length})`);
    if (bases.length === 0) {
      baseSec.createDiv({ cls: CSS_CLASS.alpEmpty, text: "Baseはありません" });
    } else {
      for (const entry of bases) {
        const row = baseSec.createDiv({ cls: "alp-row alp-base" });
        const name = row.createSpan({
          cls: "alp-name is-link",
          text: entry.label,
        });
        name.addEventListener(EVENT.click, () =>
          plugin.app.workspace.getLeaf("tab").openFile(entry.file),
        );
        createEditMenu(plugin, row, entry, ext.file);
      }
    }

    const fileCount = files.filter((e) => e.kind !== "missing").length;
    const sec = section(
      manager,
      "assets",
      `リンクファイル (${fileCount})`,
    );
    const movable = files.filter(entry => entry.kind === "asset" && entry.source);
    if (movable.length > 0) {
      const move = sec.sectionActions.createEl("button", {
        cls: "clickable-icon alp-move-files-button",
        attr: { type: "button", "aria-label": "外部ファイルを移動" },
      });
      setIcon(move, "folder");
      sec.sectionActions.insertBefore(move, sec.sectionActions.querySelector(".alp-info-wrap"));
      setTooltip(move, "外部ファイルを移動");
      move.addEventListener(EVENT.click, (event) => {
        event.preventDefault();
        event.stopPropagation();
        plugin.externalFileActions.showMove(movable);
      });
    }
    if (files.length === 0) {
      sec.createDiv({
        cls: CSS_CLASS.alpEmpty,
        text: "関連ファイルはありません",
      });
      return;
    }
    for (const entry of files) {
      const row = sec.createDiv({ cls: `alp-row alp-${entry.kind}` });
      const name = row.createSpan({
        cls: CSS_CLASS.alpName,
        text: entry.label,
      });
      if (entry.kind === "asset" && entry.source) {
        name.addClass(CSS_CLASS.isLink);
        name.addEventListener(EVENT.click, () =>
          plugin.externalFileActions.openExternal(entry.source),
        );
      } else if (entry.file) {
        name.addClass(CSS_CLASS.isLink);
        name.addEventListener(EVENT.click, () =>
          plugin.app.workspace.getLeaf("tab").openFile(entry.file),
        );
      }
      createEditMenu(plugin, row, entry, ext.file);
    }

}

module.exports = { renderExternalFiles };
