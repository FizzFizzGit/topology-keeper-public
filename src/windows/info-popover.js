// 説明の内容・言語・Obsidianを知らない、標準DOMだけの表示制御。
// 利用側はtipへ内容を描いてからattachInfoPopoverを呼び、破棄前にdisposeする。
const bindings = new WeakMap();

function hideInfoPopover(tip) { bindings.get(tip)?.hide(); }
function disposeInfoPopover(tip) { bindings.get(tip)?.dispose(); }

/**
 * 入力: 説明ボタンとbody直下のposition:fixedポップオーバー。
 * 出力: hidden・aria-expanded・位置を更新。ファイルや保存状態には触れない。
 * 説明はボタンを覆って開き、互いへの移動以外は即座に閉じる。
 */
function attachInfoPopover(button, tip, {
  viewport = tip.ownerDocument.defaultView,
} = {}) {
  disposeInfoPopover(tip);
  const listeners = [];
  const hide = () => {
    tip.setAttribute('hidden', 'hidden');
    button.setAttribute('aria-expanded', 'false');
  };
  const show = () => {
    tip.removeAttribute('hidden');
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    const margin = Math.min(12, viewport.innerWidth / 2, viewport.innerHeight / 2);
    const width = Math.max(0, Math.min(320, viewport.innerWidth - margin * 2));
    // ボタンを覆ったまま、説明を展開できる上下の余白を比べる。
    tip.style.width = `${width}px`;
    const maxHeight = Math.max(0, Math.min(520, viewport.innerHeight * 0.7));
    tip.style.maxHeight = `${maxHeight}px`;
    tip.style.left = `${Math.max(0, Math.min(rect.right - width, viewport.innerWidth - width))}px`;
    const height = tip.getBoundingClientRect().height;
    const above = Math.max(0, rect.bottom - margin);
    const below = Math.max(0, viewport.innerHeight - margin - rect.top);
    const placeBelow = height <= below || below >= above;
    const availableHeight = placeBelow ? below : above;
    tip.style.maxHeight = `${Math.min(maxHeight, availableHeight)}px`;
    tip.style.top = `${placeBelow ? rect.top : rect.bottom - Math.min(height, availableHeight)}px`;
  };
  const on = (element, name, handler) => {
    element.addEventListener(name, handler);
    listeners.push(() => element.removeEventListener(name, handler));
  };
  hide();
  on(button, 'mouseenter', show);
  on(button, 'mouseleave', event => { if (!tip.contains(event.relatedTarget)) hide(); });
  on(button, 'focus', show);
  on(button, 'blur', event => { if (!tip.contains(event.relatedTarget)) hide(); });
  on(button, 'click', event => { event.preventDefault(); event.stopPropagation(); show(); });
  on(button, 'keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); }
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
  });
  on(tip, 'mouseleave', event => { if (!button.contains(event.relatedTarget)) hide(); });
  on(tip, 'focusout', event => {
    if (!button.contains(event.relatedTarget) && !tip.contains(event.relatedTarget)) hide();
  });
  const dispose = () => {
    hide();
    listeners.forEach(remove => remove());
    if (bindings.get(tip)?.dispose === dispose) bindings.delete(tip);
  };
  bindings.set(tip, { show, hide, dispose });
  return { show, hide, dispose };
}

module.exports = { attachInfoPopover, hideInfoPopover, disposeInfoPopover };
