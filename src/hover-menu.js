const { setIcon } = require("obsidian");
let closeActiveMenu = null;

// 行内に所有させ、リスト再描画時にはメニューも一緒に破棄する。
function attachHoverMenu(trigger, row, items, label = "") {
  let menu = null;
  let timer = null;
  let openTimer = null;
  const cancelOpen = () => { clearTimeout(openTimer); openTimer = null; };
  const cancelClose = () => { clearTimeout(timer); timer = null; };
  const close = () => {
    cancelClose();
    cancelOpen();
    menu?.remove();
    menu = null;
    row.classList.remove("is-editing");
    trigger.setAttr("aria-expanded", "false");
    if (closeActiveMenu === close) closeActiveMenu = null;
  };
  const scheduleClose = () => {
    cancelOpen();
    cancelClose();
    // 対象行からメニューへの短い移動を許容する。
    timer = setTimeout(close, 120);
  };
  const open = () => {
    cancelOpen();
    cancelClose();
    if (trigger.isConnected === false) return;
    if (menu) return;
    closeActiveMenu?.();
    closeActiveMenu = close;
    menu = row.createDiv({ cls: "tk-file-hover-menu", attr: { role: "menu", "aria-label": "ファイルの編集" } });
    row.classList.add("is-editing");
    if (label) menu.createDiv({ cls: "tk-file-hover-title", text: label, attr: { role: "presentation" } });
    trigger.setAttr("aria-expanded", "true");
    const buttons = items.map(item => {
      const button = menu.createEl("button", { cls: "tk-file-hover-item", attr: { type: "button", role: "menuitem" } });
      setIcon(button.createSpan({ cls: "tk-file-hover-icon" }), item.icon);
      button.createSpan({ text: item.title });
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        trigger.focus();
        close();
        item.action();
      });
      return button;
    });
    menu.addEventListener("mouseenter", cancelClose);
    menu.addEventListener("mouseleave", event => {
      if (trigger.contains(event.relatedTarget)) cancelClose();
      else scheduleClose();
    });
    menu.addEventListener("focusin", cancelClose);
    menu.addEventListener("focusout", event => {
      if (!menu?.contains(event.relatedTarget) && event.relatedTarget !== trigger) scheduleClose();
    });
    menu.addEventListener("keydown", event => {
      const index = buttons.indexOf(event.target);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        trigger.focus();
        close();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    });
    const rect = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const win = trigger.ownerDocument.defaultView;
    // リストの下の行に重ならないよう、対象行の横に並べる。
    const left = rect.right + 6 + bounds.width <= win.innerWidth - 4
      ? rect.right + 6
      : rect.left - bounds.width - 6;
    menu.style.left = Math.max(4, Math.min(left, win.innerWidth - bounds.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(rect.top, win.innerHeight - bounds.height - 4)) + "px";
  };
  trigger.addEventListener("mouseenter", () => {
    cancelClose();
    cancelOpen();
    if (menu) return;
    closeActiveMenu?.();
    openTimer = setTimeout(open, 220);
  });
  trigger.addEventListener("mouseleave", scheduleClose);
  trigger.addEventListener("focus", open);
  trigger.addEventListener("blur", event => {
    if (!menu?.contains(event.relatedTarget)) scheduleClose();
  });
  trigger.addEventListener("keydown", event => {
    if (event.target !== trigger) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
      const buttons = menu.querySelectorAll("button");
      buttons[event.key === "ArrowDown" ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
}
module.exports = { attachHoverMenu };
