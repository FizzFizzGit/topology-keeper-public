const { fittedView } = require('./graph-geometry');
const CSS_CLASS = { isPanning: 'is-panning' };
const EVENT = { click: 'click', keydown: 'keydown', pointerdown: 'pointerdown', pointermove: 'pointermove',
  pointerup: 'pointerup', pointercancel: 'pointercancel', wheel: 'wheel' };

// SVGの視点・ノード操作だけを管理する。Vaultやプラグインを直接操作しない。
// ノード配列は表示側と共有し、座標変更後はdrawで描画を要求する。
// 返すdisposerはグラフ破棄時に必ず呼ぶ。自動パンのフレーム待機を止める。
function bindGraphInteraction({ svg, scene, nodes, width: W, height: H, zoomOut, zoomIn, reset, draw, onOpen }) {
  const listeners = [];
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener(event, handler, options));
  };
  // 視点変換はscene全体へ適用し、ドラッグは掴んだノードの座標だけを変える。
  let zoom = 1,
    panX = 0,
    panY = 0,
    panning = false,
    lastX = 0,
    lastY = 0;
  let activeNode = null,
    nodeMoved = false,
    downClientX = 0,
    downClientY = 0;
  const applyView = () =>
    scene.setAttribute(
      "transform",
      `translate(${panX} ${panY}) scale(${zoom})`,
    );
  listen(zoomOut, EVENT.click, () => {
    zoom = Math.max(0.001, zoom / 1.25);
    applyView();
  });
  listen(zoomIn, EVENT.click, () => {
    zoom = Math.min(5, zoom * 1.25);
    applyView();
  });
  listen(reset, EVENT.click, () => {
    ({ zoom, panX, panY } = fittedView(nodes, W, H));
    applyView();
  });
  const graphPoint = (event) => {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    return pt.matrixTransform(scene.getScreenCTM().inverse());
  };
  // 端でドラッグを続けると視点を送る。座標空間は広げても、SVGや窓自体は巨大化させない。
  let dragFrame = null, dragPointer = null;
  const autoPan = () => {
    dragFrame = null;
    if (!activeNode || !dragPointer) return;
    const rect = svg.getBoundingClientRect();
    const speed = (position, low, high) => position < low + 36 ? 10 : position > high - 36 ? -10 : 0;
    const dx = speed(dragPointer.clientX, rect.left, rect.right);
    const dy = speed(dragPointer.clientY, rect.top, rect.bottom);
    if (nodeMoved && (dx || dy) && rect.width && rect.height) {
      panX += dx * W / rect.width;
      panY += dy * H / rect.height;
      applyView();
      const point = graphPoint(dragPointer);
      activeNode.x = point.x;
      activeNode.y = point.y;
      draw();
    }
    dragFrame = window.requestAnimationFrame?.(autoPan);
  };
  const stopAutoPan = () => {
    if (dragFrame != null) window.cancelAnimationFrame?.(dragFrame);
    dragFrame = null;
    dragPointer = null;
  };
  listen(svg, 
    EVENT.wheel,
    (event) => {
      event.preventDefault();
      const oldZoom = zoom;
      const factor = Math.exp(-event.deltaY * 0.0012);
      zoom = Math.max(0.001, Math.min(5, zoom * factor));
      if (zoom === oldZoom) return;

      // ポインター位置を基準に拡大縮小し、ズーム時の視点移動を抑える。
      const rect = svg.getBoundingClientRect();
      const px = (event.clientX - rect.left) * (W / rect.width);
      const py = (event.clientY - rect.top) * (H / rect.height);
      const ratio = zoom / oldZoom;
      panX = px - (px - panX) * ratio;
      panY = py - (py - panY) * ratio;
      applyView();
    },
    { passive: false },
  );
  listen(svg, EVENT.pointerdown, (event) => {
    const group = event.target.closest?.(".alp-graph-node");
    const node = group ? nodes.find((n) => n.g === group) : null;
    downClientX = event.clientX;
    downClientY = event.clientY;
    if (node) {
      activeNode = node;
      nodeMoved = false;
      dragPointer = { clientX: event.clientX, clientY: event.clientY };
      dragFrame = window.requestAnimationFrame?.(autoPan);
      svg.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    panning = true;
    lastX = event.clientX;
    lastY = event.clientY;
    svg.setPointerCapture?.(event.pointerId);
    svg.classList.add(CSS_CLASS.isPanning);
  });
  listen(svg, EVENT.pointermove, (event) => {
    if (activeNode) {
      dragPointer = { clientX: event.clientX, clientY: event.clientY };
      const pt = graphPoint(event);
      activeNode.x = pt.x;
      activeNode.y = pt.y;
      if (
        Math.hypot(event.clientX - downClientX, event.clientY - downClientY) >
        4
      )
        nodeMoved = true;
      draw();
      return;
    }
    if (!panning) return;
    const rect = svg.getBoundingClientRect();
    // パンは画面上の移動量に追従させ、ズーム倍率で速度が変わらないようにする。
    panX += (event.clientX - lastX) * (W / rect.width);
    panY += (event.clientY - lastY) * (H / rect.height);
    lastX = event.clientX;
    lastY = event.clientY;
    applyView();
  });
  const stopPointer = (event) => {
    stopAutoPan();
    if (activeNode) {
      const node = activeNode;
      activeNode = null;
      if (nodeMoved) {
        // 座標を初期の枠へ戻さない。外側へ広げた配置もパン・ズームと全体表示で辿れる。
        draw();
      } else if (event?.type !== EVENT.pointercancel && !node.id.startsWith("#")) {
        onOpen(node.id);
      }
    }
    panning = false;
    svg.classList.remove(CSS_CLASS.isPanning);
    if (event?.pointerId !== undefined) {
      try {
        svg.releasePointerCapture?.(event.pointerId);
      } catch (_) {}
    }
  };
  listen(svg, EVENT.pointerup, stopPointer);
  listen(svg, EVENT.pointercancel, stopPointer);
  // Keyboard activation mirrors clicking for accessible note nodes.
  for (const n of nodes) {
    if (n.id.startsWith("#")) continue;
    listen(n.g, EVENT.keydown, (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen(n.id);
      }
    });
  }
  return () => {
    stopAutoPan();
    activeNode = null;
    panning = false;
    svg.classList.remove(CSS_CLASS.isPanning);
    for (const remove of listeners.splice(0)) remove();
  };
}
module.exports = { bindGraphInteraction };
