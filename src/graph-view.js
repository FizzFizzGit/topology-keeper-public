const UI_TEXT = { close: "閉じる" };
const CSS_CLASS = { isPanning: "is-panning" };
const EVENT = {
  click: "click",
  keydown: "keydown",
  pointerdown: "pointerdown",
  pointermove: "pointermove",
  pointerup: "pointerup",
  pointercancel: "pointercancel",
  wheel: "wheel",
};
const nodeLabel = (id) =>
  id.startsWith("#") ? id : id.split("/").pop().replace(/\.md$/, "");

// 部分グラフ窓のpx座標を復元し、タイトルバー移動後にプラグイン設定へ保存する。
// 入力は窓DOMとプラグイン。返却する関数は移動・画面サイズ変更のリスナーを解除する。
function bindGraphWindowPosition(plugin, panel, head) {
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
  };
  head.addEventListener("pointerdown", start);
  window.addEventListener("resize", resize);
  return () => {
    stop();
    head.removeEventListener("pointerdown", start);
    window.removeEventListener("resize", resize);
  };
}

// 選択したエリアを、周辺ノードと境界候補辺も含めて SVG グラフとして描く。
//
// 【入力】
//   plugin.maint.graphAdj : グラフ全体の隣接表 Map<頂点ID, Set<頂点ID>>（graph-analysis.js の buildAdjacency の
//                           結果。maintenance-workflow.js が保持する）。まだ計算前（null）なら何も描かない。
//                           頂点IDはノートの Vault 相対パス、またはタグ（"#" 付き）。
//   selection             : { nodes, links, boundaryLinks }。detail-window.js の renderFindingActions が、
//                           平面性未確定のエリア（item）から作る。
//     nodes : 領域に含まれる頂点IDの配列。adj に無いIDは捨てる。
//     links : 領域の辺 [[u, v], ...]。これは「縮約後のグラフ」の辺で、元の adj には無い辺
//             （次数2の頂点を飛び越える辺）を含むことがある。そのような辺は「縮約された辺」として区別して描く。
//   parent                : 描画先の DOM 要素（詳細窓の「エリア分析」欄）。
// 【出力】 戻り値は無い。parent の中にグラフのパネルを追加する。次の副作用がある。
//   ・plugin.maint.graphCleanup に、Escape キーのリスナーを外す関数を設定する（再描画のたびに
//     plugin.disposeGraphListeners() が呼んで解除する）。
//   ・閉じる操作で plugin.maint.selectedCluster を null に戻して再描画する。
//   ・ノート（"#" で始まらない頂点）のクリックで、そのノートを新しいタブで開く。
//   ノードの配置（力学モデルで計算）や拡大縮小は、この関数の中だけで持ち、保存しない。
//   描画のたびにゼロから計算し直すため、ドラッグで調整した配置は再描画で失われる。
//   表示するのは、領域の頂点（中核。次数の高い順に最大90）と、その隣接頂点（周辺。最大35）まで。
function renderClusterGraph(plugin, parent, selection) {
  const adj = plugin.maint.graphAdj;
  if (!adj) return;
  const allSelectedIds = [
    ...new Set((selection.nodes ?? []).filter((id) => adj.has(id))),
  ];
  const selectedIds = allSelectedIds
    .sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))
    .slice(0, 90);
  const selected = new Set(selectedIds);
  if (!selected.size) return;

  const maxContext = 35;
  const context = new Set();
  const boundaryLinks = selection.boundaryLinks ?? [];
  const boundaryKeys = new Set(
    boundaryLinks.map(([u, v]) =>
      u < v ? `${u}\0${v}` : `${v}\0${u}`,
    ),
  );
  const boundaryContext = new Set();
  for (const id of selected) {
    for (const neighbor of adj.get(id) ?? []) {
      if (!selected.has(neighbor)) context.add(neighbor);
    }
  }
  for (const [u, v] of boundaryLinks) {
    if (selected.has(u) && !selected.has(v)) boundaryContext.add(v);
    if (selected.has(v) && !selected.has(u)) boundaryContext.add(u);
  }
  for (const id of boundaryContext) context.add(id);
  const contextList = [...context]
    .sort(
      (a, b) =>
        Number(boundaryContext.has(b)) - Number(boundaryContext.has(a)) ||
        (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0),
    )
    .slice(0, maxContext);
  const ids = [...selectedIds, ...contextList];
  const idSet = new Set(ids);
  // edges の各要素 { a, b, contracted, boundary }（a, b は頂点ID）。まず adj の実辺を集め、
  // selection.links / boundaryLinks の未登録辺は次数2抑制後の辺として足す。
  // edgeKeys は「u\0v」（u < v）の形の重複防止用のキー。
  const edges = [];
  const edgeKeys = new Set();
  for (const u of ids) {
    for (const v of adj.get(u) ?? []) {
      if (idSet.has(v) && u < v) {
        edges.push({
          a: u,
          b: v,
          contracted: false,
          boundary: boundaryKeys.has(`${u}\0${v}`),
        });
        edgeKeys.add(`${u}\0${v}`);
      }
    }
  }
  for (const [u, v] of selection.links ?? []) {
    const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
    if (idSet.has(u) && idSet.has(v) && !edgeKeys.has(key)) {
      edges.push({ a: u, b: v, contracted: true });
      edgeKeys.add(key);
    }
  }
  for (const [u, v] of boundaryLinks) {
    const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
    if (idSet.has(u) && idSet.has(v) && !edgeKeys.has(key)) {
      edges.push({ a: u, b: v, contracted: true, boundary: true });
      edgeKeys.add(key);
    }
  }

  const panel = parent.createDiv({ cls: "alp-graph-panel" });
  panel.setAttr("role", "dialog");
  panel.setAttr("aria-modal", "true");
  panel.setAttr("aria-label", "ホットスポットのグラフ");
  const head = panel.createDiv({ cls: "alp-graph-head" });
  head.createSpan({
    text: `グラフ表示：中核 ${selected.size}${allSelectedIds.length > selected.size ? ` / ${allSelectedIds.length}` : ""}ノード`,
  });
  const controls = head.createDiv({ cls: "alp-graph-controls" });
  const zoomOut = controls.createEl("button", {
    text: "−",
    attr: { "aria-label": "縮小" },
  });
  const zoomIn = controls.createEl("button", {
    text: "+",
    attr: { "aria-label": "拡大" },
  });
  const reset = controls.createEl("button", {
    text: "全体",
    attr: { "aria-label": "全体表示" },
  });
  const close = head.createEl("button", {
    text: UI_TEXT.close,
    cls: "alp-graph-close",
  });
  const onKeyDown = (event) => {
    if (event.key === "Escape") closeGraph();
  };
  // 再描画でパネルが作り直されても古いリスナーが残らないよう、解除関数を保持する。
  plugin.disposeGraphListeners();
  const disposePosition = bindGraphWindowPosition(plugin, panel, head);
  plugin.maint.graphCleanup = () => {
    disposePosition();
    document.removeEventListener("keydown", onKeyDown);
  };
  const closeGraph = () => {
    plugin.disposeGraphListeners();
    plugin.maint.selectedCluster = null;
    if (plugin.detailVisible) plugin.renderDetailWindow();
    else plugin.mainView.render(true);
  };
  close.addEventListener(EVENT.click, closeGraph);
  document.addEventListener(EVENT.keydown, onKeyDown);
  const graphHelp = panel.createDiv({ cls: "alp-graph-help" });
  const helpButton = graphHelp.createEl("button", {
    text: "ⓘ 操作方法",
    cls: "alp-graph-help-button",
  });
  const helpText = graphHelp.createDiv({
    cls: "alp-small alp-graph-help-text",
    text: "ノードをドラッグして配置を調整できます。ノートをクリックすると編集用タブで開きます。ホイールまたは＋／−で拡大縮小、空白部分のドラッグで表示を移動します。ウィンドウの右下をドラッグするとサイズ変更できます。",
  });
  helpText.hidden = true;
  helpButton.addEventListener(EVENT.click, () => {
    helpText.hidden = !helpText.hidden;
  });

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 1600 1000");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "ドラッグして配置を調整できるホットスポットのグラフ",
  );
  svg.classList.add("alp-graph-svg");
  panel.appendChild(svg);
  const scene = document.createElementNS(ns, "g");
  svg.appendChild(scene);

  const centerX = 800,
    centerY = 500;
  const nodes = ids.map((id, i) => {
    // Golden-angle seed avoids putting all nodes on a few axes before the force layout starts.
    const angle = i * 2.399963229728653;
    const radius = 45 + Math.sqrt(i + 1) * (selected.has(id) ? 70 : 125);
    const label = nodeLabel(id);
    return {
      id,
      selected: selected.has(id),
      label,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      labelWidth: Math.max(55, Math.min(420, label.length * 9 + 16)),
      g: null,
      labelEl: null,
      circle: null,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const simEdges = edges
    .map((edge) => ({ ...edge, a: byId.get(edge.a), b: byId.get(edge.b) }))
    .filter((edge) => edge.a && edge.b);

  // Force-directed layout: stronger link attraction, pair repulsion, label-box collision avoidance,
  // and weak gravity. Unlike the previous version, context nodes have no fixed corner targets.
  const relax = (steps, pinned = null) => {
    const repulsion = 18000;
    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x,
            dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (i + 1) * 0.7;
            dy = (j + 1) * 0.4;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const minD = 68;
          const push =
            repulsion / Math.max(2500, d2) +
            (d < minD ? (minD - d) * 0.12 : 0);
          const fx = (dx / d) * push,
            fy = (dy / d) * push;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;

          // Approximate text rectangles to push apart labels that would overlap.
          const ay1 = a.y - 13,
            ay2 = a.y + 13;
          const by1 = b.y - 13,
            by2 = b.y + 13;
          const ax1 = a.x + 13,
            ax2 = ax1 + a.labelWidth;
          const bx1 = b.x + 13,
            bx2 = bx1 + b.labelWidth;
          const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
          const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);
          if (overlapX > 0 && overlapY > 0) {
            const sign = a.x <= b.x ? -1 : 1;
            const labelPush = Math.min(3.5, overlapX * 0.025 + 0.5);
            a.vx += sign * labelPush;
            b.vx -= sign * labelPush;
            const ySign = a.y <= b.y ? -1 : 1;
            a.vy += ySign * overlapY * 0.035;
            b.vy -= ySign * overlapY * 0.035;
          }
        }
      }
      for (const edge of simEdges) {
        const { a, b } = edge;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const target = edge.contracted
          ? 205
          : a.selected && b.selected
            ? 175
            : 215;
        const force = (d - target) * 0.018;
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
        b.vx -= (dx / d) * force;
        b.vy -= (dy / d) * force;
      }
      for (const n of nodes) {
        // Mild central gravity keeps the graph in one navigable area without pinning nodes to corners.
        n.vx += (centerX - n.x) * 0.0007;
        n.vy += (centerY - n.y) * 0.0007;
        n.vx *= 0.72;
        n.vy *= 0.72;
        if (n.id !== pinned) {
          n.x += Math.max(-22, Math.min(22, n.vx));
          n.y += Math.max(-22, Math.min(22, n.vy));
        } else {
          n.vx = 0;
          n.vy = 0;
        }
      }
    }
  };
  relax(480);

  // Fit the coordinate space to the laid-out graph, retaining enough room for complete labels.
  const bounds = () => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - 20);
      minY = Math.min(minY, n.y - 25);
      maxX = Math.max(maxX, n.x + n.labelWidth + 25);
      maxY = Math.max(maxY, n.y + 25);
    }
    return { minX, minY, maxX, maxY };
  };
  const b = bounds();
  const W = Math.max(1200, b.maxX - b.minX + 160);
  const H = Math.max(760, b.maxY - b.minY + 160);
  for (const n of nodes) {
    n.x += 80 - b.minX;
    n.y += 80 - b.minY;
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const edgeEls = [];
  for (const edge of simEdges) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute(
      "class",
      `${edge.a.selected && edge.b.selected ? "alp-graph-edge is-selected" : "alp-graph-edge"}${edge.contracted ? " is-contracted" : ""}${edge.boundary ? " is-boundary" : ""}`,
    );
    scene.appendChild(line);
    edgeEls.push({ edge, el: line });
  }
  for (const n of nodes) {
    const g = document.createElementNS(ns, "g");
    g.setAttribute(
      "class",
      `${n.selected ? "alp-graph-node is-selected" : "alp-graph-node"}${n.id.startsWith("#") ? " is-tag" : " is-openable"}`,
    );
    g.setAttribute("tabindex", n.id.startsWith("#") ? "-1" : "0");
    if (!n.id.startsWith("#")) {
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", `ノートを開く: ${n.id}`);
    }
    // 見た目の円より広い透明なヒット領域を用意し、ノードをつかみやすくする。
    const hitArea = document.createElementNS(ns, "circle");
    hitArea.setAttribute("r", Math.max(14, n.selected ? 16 : 14));
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("stroke", "none");
    hitArea.setAttribute("class", "alp-graph-node-hit");
    g.appendChild(hitArea);
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", n.selected ? 9 : 6);
    g.appendChild(circle);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", 13);
    label.setAttribute("y", 5);
    label.textContent = n.label;
    label.setAttribute("title", n.id);
    g.appendChild(label);
    const title = document.createElementNS(ns, "title");
    title.textContent = n.id;
    g.appendChild(title);
    scene.appendChild(g);
    n.g = g;
    n.labelEl = label;
    n.circle = circle;
  }
  const draw = () => {
    for (const { edge, el } of edgeEls) {
      el.setAttribute("x1", edge.a.x);
      el.setAttribute("y1", edge.a.y);
      el.setAttribute("x2", edge.b.x);
      el.setAttribute("y2", edge.b.y);
    }
    for (const n of nodes)
      n.g.setAttribute("transform", `translate(${n.x} ${n.y})`);
  };
  draw();

  // Pan/zoom applies to the whole scene. Dragging a node changes its position and relaxes neighbors.
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
  zoomOut.addEventListener(EVENT.click, () => {
    zoom = Math.max(0.25, zoom / 1.25);
    applyView();
  });
  zoomIn.addEventListener(EVENT.click, () => {
    zoom = Math.min(5, zoom * 1.25);
    applyView();
  });
  reset.addEventListener(EVENT.click, () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyView();
  });
  const graphPoint = (event) => {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    return pt.matrixTransform(scene.getScreenCTM().inverse());
  };
  svg.addEventListener(
    EVENT.wheel,
    (event) => {
      event.preventDefault();
      const oldZoom = zoom;
      const factor = Math.exp(-event.deltaY * 0.0012);
      zoom = Math.max(0.25, Math.min(5, zoom * factor));
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
  svg.addEventListener(EVENT.pointerdown, (event) => {
    const group = event.target.closest?.(".alp-graph-node");
    const node = group ? nodes.find((n) => n.g === group) : null;
    downClientX = event.clientX;
    downClientY = event.clientY;
    if (node) {
      activeNode = node;
      nodeMoved = false;
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
  svg.addEventListener(EVENT.pointermove, (event) => {
    if (activeNode) {
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
    if (activeNode) {
      const node = activeNode;
      activeNode = null;
      if (nodeMoved) {
        // ドラッグ後に全体の力学レイアウトを再計算すると、他ノードも動いて
        // グラフ全体がずれて見える。掴んだノードだけを表示範囲に収める。
        node.x = Math.max(20, Math.min(W - node.labelWidth - 20, node.x));
        node.y = Math.max(30, Math.min(H - 30, node.y));
        draw();
      } else if (!node.id.startsWith("#")) {
        closeGraph();
        plugin.app.workspace.openLinkText(node.id, "", "tab");
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
  svg.addEventListener(EVENT.pointerup, stopPointer);
  svg.addEventListener(EVENT.pointercancel, stopPointer);
  // Keyboard activation mirrors clicking for accessible note nodes.
  for (const n of nodes) {
    if (n.id.startsWith("#")) continue;
    n.g.addEventListener(EVENT.keydown, (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closeGraph();
        plugin.app.workspace.openLinkText(n.id, "", "tab");
      }
    });
  }
  const legend = panel.createDiv({ cls: "alp-graph-legend" });
  legend.createSpan({ cls: "alp-graph-dot is-selected" });
  legend.createSpan({ text: "ホットスポット" });
  legend.createSpan({ cls: "alp-graph-dot" });
  legend.createSpan({ text: "周辺ノード" });
  legend.createSpan({ cls: "alp-graph-line is-contracted" });
  legend.createSpan({ text: "縮約経路" });
  if (boundaryLinks.length) {
    legend.createSpan({ cls: "alp-graph-line is-boundary" });
    legend.createSpan({ text: "境界候補" });
  }
}

module.exports = { renderClusterGraph, bindGraphWindowPosition };
