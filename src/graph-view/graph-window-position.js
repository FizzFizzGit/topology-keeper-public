// 部分グラフ窓のpx座標を復元し、タイトルバー移動後にプラグイン設定へ保存する。
// 入力は窓DOMとプラグイン。返却する関数は移動・画面サイズ変更のリスナーを解除する。
function bindGraphWindowPosition(plugin, panel, head) {
  const size = plugin.state.graphSize;
  if (size) {
    panel.style.width = `${Math.min(size.width, window.innerWidth * 0.96)}px`;
    panel.style.height = `${Math.min(size.height, window.innerHeight * 0.96)}px`;
  }
  const constrain = (x, y) => {
    const rect = panel.getBoundingClientRect();
    const position = {
      x: Math.max(0, Math.min(window.innerWidth - rect.width, x)),
      y: Math.max(0, Math.min(window.innerHeight - rect.height, y)),
    };
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
    return position;
  };
  const saved = plugin.state.graphPos;
  if (saved) constrain(saved.x, saved.y);
  else {
    const rect = panel.getBoundingClientRect();
    constrain(rect.left, rect.top);
  }
  let lastRect = panel.getBoundingClientRect();
  let sizeTimer = null;
  let pendingSize = false;
  const saveSize = () => {
    if (sizeTimer !== null) clearTimeout(sizeTimer);
    sizeTimer = null;
    if (!pendingSize) return;
    pendingSize = false;
    plugin.state.graphSize = { width: lastRect.width, height: lastRect.height };
    plugin.state.graphPos = { x: lastRect.left, y: lastRect.top };
    plugin.saveData(plugin.state);
  };
  const observeSize = () => {
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (rect.width === lastRect.width && rect.height === lastRect.height) return;
    const position = constrain(rect.left, rect.top);
    lastRect = { ...position, left: position.x, top: position.y, width: rect.width, height: rect.height };
    pendingSize = true;
    if (sizeTimer !== null) clearTimeout(sizeTimer);
    sizeTimer = setTimeout(saveSize, 250);
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(observeSize) : null;
  observer?.observe(panel);
  let move = null;
  let moved = false;
  const stop = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    document.removeEventListener("pointercancel", stop);
    window.removeEventListener("blur", stop);
    move = null;
    if (moved) {
      moved = false;
      const rect = panel.getBoundingClientRect();
      plugin.state.graphPos = constrain(rect.left, rect.top);
      lastRect = { left: plugin.state.graphPos.x, top: plugin.state.graphPos.y, width: rect.width, height: rect.height };
      plugin.saveData(plugin.state);
    }
  };
  const start = event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    stop();
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX, startY = event.clientY;
    move = e => {
      moved = true;
      constrain(rect.left + e.clientX - startX, rect.top + e.clientY - startY);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    event.preventDefault();
  };
  const resize = () => {
    const rect = panel.getBoundingClientRect();
    constrain(rect.left, rect.top);
    observeSize();
  };
  head.addEventListener("pointerdown", start);
  window.addEventListener("resize", resize);
  document.addEventListener('pointerup', saveSize);
  return () => {
    observeSize();
    observer?.disconnect();
    saveSize();
    stop();
    head.removeEventListener("pointerdown", start);
    window.removeEventListener("resize", resize);
    document.removeEventListener('pointerup', saveSize);
  };
}


module.exports = { bindGraphWindowPosition };
