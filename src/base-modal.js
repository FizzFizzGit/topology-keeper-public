const { Modal } = require("obsidian");

const CSS_CLASS = {
  modalButtonContainer: "modal-button-container",
  modalError: "topology-keeper-modal-error",
  modCta: "mod-cta",
};
const UI_TEXT = { cancel: "キャンセル", create: "作成" };
const EVENT = { click: "click", keydown: "keydown" };

// window.prompt() は Obsidian の実行環境で利用できないため、Obsidian の Modal を使う。
//
// 新しい Base の「ビュー名」を入力させる。
//   waitForValue() の戻り値（Promise）:
//     入力された文字列（前後の空白は除去済み・空ではない）、またはキャンセル／閉じたときは null。
//   受け取った名前は Base ファイルの中のビュー名になる（base-manager.js の makeBaseContent）。
//   Base のファイル名にはならない（ファイル名は UUID）。
class BaseNameModal extends Modal {
  constructor(app) {
    super(app);
    this.result = null;
    this.finished = false;
  }

  waitForValue() {
    return new Promise((resolve) => {
      this.resolveResult = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("新しいBaseを作成");
    contentEl.createEl("p", { text: "ビュー名を入力してください。" });

    const input = contentEl.createEl("input", { attr: { type: "text" } });
    input.placeholder = "例：参考資料";
    input.style.width = "100%";
    input.focus();

    const error = contentEl.createEl("p", { cls: CSS_CLASS.modalError });
    error.style.display = "none";

    const buttons = contentEl.createDiv({
      cls: CSS_CLASS.modalButtonContainer,
    });
    const cancel = buttons.createEl("button", { text: UI_TEXT.cancel });
    cancel.addEventListener(EVENT.click, () => this.close());

    const create = buttons.createEl("button", { text: UI_TEXT.create });
    create.addClass(CSS_CLASS.modCta);
    const submit = () => {
      const value = input.value.trim();
      if (!value) {
        error.setText("ビュー名を入力してください。");
        error.style.display = "block";
        input.focus();
        return;
      }
      this.result = value;
      this.finished = true;
      this.close();
    };
    create.addEventListener(EVENT.click, submit);
    input.addEventListener(EVENT.keydown, (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
    if (this.resolveResult)
      this.resolveResult(this.finished ? this.result : null);
  }
}


// Baseのフィルタ条件にするタグを選択する。既存タグに加えて手入力もできる。
//
//   availableTags : 選択肢にするタグ名の配列。"#" なし（例 ["資料", "研究/分類"]）。
//                   base-workflow.js の createStandalone が、Vault 内の全 Markdown ノートが持つタグ
//                   （getAllTags の結果から "#" を外したもの）を集めて渡す。
//   waitForTags() の戻り値（Promise）:
//     選択したタグと手入力のタグを合わせた文字列配列（"#" なし・重複なし）、またはキャンセル時は null。
//     空配列はキャンセルではなく「タグ条件なしで作成する」の意味なので、null と区別して扱うこと。
//     手入力の区切りは空白・カンマ・セミコロン。先頭の "#" は取り除く。
//   受け取ったタグは Base の絞り込み条件 `file.hasTag("<タグ>")` になる（base-manager.js の makeBaseContent）。
class BaseTagModal extends Modal {
  constructor(app, availableTags) {
    super(app);
    this.availableTags = availableTags;
    this.result = null;
    this.finished = false;
  }

  waitForTags() {
    return new Promise((resolve) => {
      this.resolveResult = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Baseのタグフィルタ");
    contentEl.createEl("p", { text: "このBaseに表示するメタノートのタグを選択してください。複数選ぶと、すべてのタグを持つノートに絞り込みます。" });

    const list = contentEl.createDiv();
    list.style.maxHeight = "40vh";
    list.style.overflowY = "auto";
    list.style.padding = "2px 0";
    const checks = [];
    if (this.availableTags.length) {
      for (const tag of this.availableTags) {
        const row = list.createEl("label");
        row.style.display = "block";
        row.style.padding = "2px 0";
        const cb = row.createEl("input", { attr: { type: "checkbox" } });
        cb.style.marginRight = "8px";
        row.createSpan({ text: `#${tag}` });
        checks.push([tag, cb]);
      }
    } else {
      list.createEl("p", { text: "既存タグはありません。下の欄から追加できます。" });
    }

    contentEl.createEl("p", { text: "追加のタグ（空白・カンマ区切り）" });
    const free = contentEl.createEl("input", { attr: { type: "text", placeholder: "例：資料 研究/分類" } });
    free.style.width = "100%";

    const buttons = contentEl.createDiv({ cls: CSS_CLASS.modalButtonContainer });
    const cancel = buttons.createEl("button", { text: UI_TEXT.cancel });
    cancel.addEventListener(EVENT.click, () => this.close());
    const create = buttons.createEl("button", { text: "Baseを作成", cls: CSS_CLASS.modCta });
    create.addEventListener(EVENT.click, () => {
      const picked = checks.filter(([, cb]) => cb.checked).map(([tag]) => tag);
      const typed = free.value.split(/[\s,;]+/).map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean);
      this.result = [...new Set([...picked, ...typed])];
      this.finished = true;
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
    if (this.resolveResult) this.resolveResult(this.finished ? this.result : null);
  }
}

module.exports = { BaseNameModal, BaseTagModal };
