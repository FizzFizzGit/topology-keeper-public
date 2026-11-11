const { bindGraphInteraction } = require('./graph-interaction');
const { bindGraphWindowPosition } = require('./graph-window-position');
const { selectGraph } = require('./graph-selection');
const { layoutGraph } = require('./graph-layout');
const { t } = require('./i18n');
const { setIcon } = require('obsidian');
const { edgeDirections, NODE_STROKE_WIDTH, nodeRadius, arrowTip } = require('./graph-geometry');
const UI_TEXT = { close: t("window.closeAction") };
const EVENT = {
  click: "click",
  keydown: "keydown",
};

// 選択したエリアを、周辺ノードと境界候補辺も含めて SVG グラフとして描く。
//
// 【入力】
//   plugin.maint.graphAdj : グラフ全体の隣接表 Map<頂点ID, Set<頂点ID>>（graph-analysis.js の buildAdjacency の
//                           結果。maintenance-workflow.js が保持する）。まだ計算前（null）なら何も描かない。
//                           頂点IDはノートの Vault 相対パス、またはタグ（"#" 付き）。
//   selection             : { nodes, links, boundaryLinks }。analysis-content.js が、
//                           平面性未確定のエリア（item）から作る。
//     nodes : 領域に含まれる頂点IDの配列。adj に無いIDは捨てる。
//     links : 領域の辺 [[u, v], ...]。これは「縮約後のグラフ」の辺で、元の adj には無い辺
//             （次数2の頂点を飛び越える辺）を含むことがある。そのような辺は「縮約された辺」として区別して描く。
//   parent                : 呼び出し元の分析欄。表示先の文書を特定するために使う。
// 【出力】 戻り値は無い。独立窓は文書直下、サイドパネルは指定されたタブに表示する。
//   ・plugin.maint.graphCleanup に、Escape キーのリスナーを外す関数を設定する（再描画のたびに
//     plugin.disposeGraphListeners() が呼んで解除する）。
//   ・閉じる操作で plugin.maint.selectedCluster を null に戻して再描画する。
//   ・ノート（"#" で始まらない頂点）のクリックで、そのノートを新しいタブで開く。
//   ノードの配置（力学モデルで計算）や拡大縮小は、この関数の中だけで持ち、保存しない。
//   描画のたびにゼロから計算し直すため、ドラッグで調整した配置は再描画で失われる。
//   表示するのは、領域の頂点（中核。次数の高い順に最大90）と、その隣接頂点（周辺。最大35）まで。
function renderClusterGraph(plugin, parent, selection, adj = plugin.maint.graphAdj) {
  if (!adj) return;
  const { allSelectedIds, selected, ids, edges, boundaryLinks } = selectGraph(adj, selection);
  if (!selected.size) return;

  const doc = parent.ownerDocument;
  // 分析欄の祖先にあるサイドパネルの座標やクリッピングから独立させる。
  const panel = doc.body.createDiv({ cls: "alp-graph-panel" });
  const docked = plugin.sidebars && plugin.sidebars.placement('graph') !== 'floating';
  panel.setAttr("role", docked ? "region" : "dialog");
  if (!docked) panel.setAttr("aria-modal", "true");
  panel.setAttr("aria-label", selection.title ?? t("graph.title"));
  const head = panel.createDiv({ cls: "alp-graph-head" });
  head.createSpan({
    text: t('graph.heading', { shown: selected.size, total: allSelectedIds.length > selected.size ? ` / ${allSelectedIds.length}` : '' }),
  });
  const controls = head.createDiv({ cls: "alp-graph-controls" });
  if (selection.groups) panel.createDiv({ cls: 'alp-small',
    text: t('graph.groupHelp', { title: selection.title, tag: selection.tag ? t('graph.tagHelp') : '', limit: allSelectedIds.length > selected.size ? t('graph.limitHelp') : '' }) });
  const zoomOut = controls.createEl("button", {
    text: "−",
    attr: { "aria-label": t("graph.zoomOut") },
  });
  const zoomIn = controls.createEl("button", {
    text: "+",
    attr: { "aria-label": t("graph.zoomIn") },
  });
  const reset = controls.createEl("button", {
    text: t("graph.fit"),
    attr: { "aria-label": t("graph.fitAria") },
  });
  const close = head.createEl("button", {
    cls: "alp-graph-close",
    attr: { type: 'button', title: UI_TEXT.close, 'aria-label': UI_TEXT.close },
  });
  setIcon(close, 'x');
  const onKeyDown = (event) => {
    if (event.key === "Escape") closeGraph();
  };
  // 再描画でパネルが作り直されても古いリスナーが残らないよう、解除関数を保持する。
  plugin.disposeGraphListeners();
  const disposePosition = docked ? null : bindGraphWindowPosition(plugin, panel, head);
  plugin.maint.graphCleanup = () => {
    disposePosition?.();
    plugin.sidebars?.hide('graph');
    doc.removeEventListener("keydown", onKeyDown);
    panel.remove();
  };
  const closeGraph = () => {
    plugin.disposeGraphListeners();
    plugin.maint.selectedCluster = null;
    if (plugin.detailView?.visible) plugin.detailView.render();
    else plugin.mainView.render();
  };
  close.addEventListener(EVENT.click, closeGraph);
  doc.addEventListener(EVENT.keydown, onKeyDown);
  const graphHelp = panel.createDiv({ cls: "alp-graph-help" });
  const helpButton = graphHelp.createEl("button", {
    text: t("graph.help"),
    cls: "alp-graph-help-button",
  });
  const helpText = graphHelp.createDiv({
    cls: "alp-small alp-graph-help-text",
    text: t("graph.helpText"),
  });
  helpText.hidden = true;
  helpButton.addEventListener(EVENT.click, () => {
    helpText.hidden = !helpText.hidden;
  });

  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 1600 1000");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    t('graph.aria', { title: selection.title ?? t('graph.title') }),
  );
  svg.classList.add("alp-graph-svg");
  panel.appendChild(svg);
  const scene = doc.createElementNS(ns, "g");
  svg.appendChild(scene);

  const { nodes, simEdges, width: W, height: H } = layoutGraph(ids, selected, edges);
  const groupPalette = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9'];
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  // 辺・矢印の後にノードと文字を描き、文字の可読性を優先する。
  const arrowLayer = doc.createElementNS(ns, 'g');
  arrowLayer.setAttribute('class', 'alp-graph-arrows');
  arrowLayer.setAttribute('pointer-events', 'none');
  const edgeEls = [];
  for (const edge of simEdges) {
    const line = doc.createElementNS(ns, "line");
    const direction = edgeDirections({ ...edge, a: edge.a.id, b: edge.b.id }, plugin.app?.metadataCache?.resolvedLinks);
    line.setAttribute(
      "class",
      `${edge.a.selected && edge.b.selected ? "alp-graph-edge is-selected" : "alp-graph-edge"}${edge.contracted ? " is-contracted" : ""}${edge.boundary ? " is-boundary" : ""}`,
    );
    scene.appendChild(line);
    // マーカー参照に依存せず、接続先の円周へ先端が接する矢印を直接描く。
    // 相互リンクでは、それぞれの円周に向けて描く。
    const arrows = [];
    for (const reverse of [false, true]) {
      if (!(reverse ? direction.start : direction.end)) continue;
      const arrow = doc.createElementNS(ns, 'polygon');
      arrow.setAttribute('class', `alp-graph-arrow${edge.a.selected && edge.b.selected ? ' is-selected' : ''}${edge.boundary ? ' is-boundary' : ''}`);
      arrow.setAttribute('pointer-events', 'none');
      arrowLayer.appendChild(arrow);
      arrows.push({ el: arrow, reverse });
    }
    edgeEls.push({ edge, el: line, arrows });
  }
  scene.appendChild(arrowLayer);
  for (const n of nodes) {
    const g = doc.createElementNS(ns, "g");
    g.setAttribute(
      "class",
      `${n.selected ? "alp-graph-node is-selected" : "alp-graph-node"}${n.id.startsWith("#") ? " is-tag" : " is-openable"}`,
    );
    g.setAttribute("tabindex", n.id.startsWith("#") ? "-1" : "0");
    if (!n.id.startsWith("#")) {
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", t('graph.openNote', { path: n.id }));
    }
    // 見た目の円より広い透明なヒット領域を用意し、ノードをつかみやすくする。
    const hitArea = doc.createElementNS(ns, "circle");
    hitArea.setAttribute("r", Math.max(14, n.selected ? 16 : 14));
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("stroke", "none");
    // SVGのfill/stroke属性は通常のCSS規則に負ける。
    // .alp-graph-node circle の装飾を受けず、操作範囲だけを広げる。
    hitArea.style.fill = 'transparent';
    hitArea.style.stroke = 'none';
    hitArea.setAttribute("class", "alp-graph-node-hit");
    g.appendChild(hitArea);
    const circle = doc.createElementNS(ns, "circle");
    circle.setAttribute("r", nodeRadius(n));
    circle.style.strokeWidth = String(NODE_STROKE_WIDTH);
    const groupIndices = (selection.groups ?? []).flatMap((group, index) => group.nodes.includes(n.id) ? [index] : []);
    if (groupIndices.length) circle.style.fill = groupPalette[groupIndices[0] % groupPalette.length];
    g.appendChild(circle);
    const label = doc.createElementNS(ns, "text");
    label.setAttribute("x", 13);
    label.setAttribute("y", 5);
    label.textContent = n.label;
    label.setAttribute("title", n.id);
    g.appendChild(label);
    const title = doc.createElementNS(ns, "title");
    title.textContent = n.id;
    g.appendChild(title);
    scene.appendChild(g);
    n.g = g;
  }
  const draw = () => {
    for (const { edge, el, arrows } of edgeEls) {
      // 円の中心まで線を伸ばすと矢印が隠れるため、両端をノードの外周へ短縮する。
      const distance = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y) || 1;
      const start = Math.min((edge.a.selected ? 9 : 6) + 3, distance / 2);
      const end = Math.min((edge.b.selected ? 9 : 6) + 3, distance / 2);
      const dx = (edge.b.x - edge.a.x) / distance, dy = (edge.b.y - edge.a.y) / distance;
      el.setAttribute("x1", edge.a.x + dx * start);
      el.setAttribute("y1", edge.a.y + dy * start);
      el.setAttribute("x2", edge.b.x - dx * end);
      el.setAttribute("y2", edge.b.y - dy * end);
      for (const arrow of arrows) {
        // 円と共通の半径・線幅から算出し、先端のにじみが円に重ならない余白を取る。
        const target = arrow.reverse ? edge.a : edge.b;
        const source = arrow.reverse ? edge.b : edge.a;
        const sign = arrow.reverse ? -1 : 1;
        const { x, y } = arrowTip(source, target);
        const length = Math.min(17, distance * 0.18), half = length * 0.45;
        const baseX = x - dx * length * sign, baseY = y - dy * length * sign;
        arrow.el.setAttribute('points', `${x},${y} ${baseX - dy * half},${baseY + dx * half} ${baseX + dy * half},${baseY - dx * half}`);
      }
    }
    for (const n of nodes)
      n.g.setAttribute("transform", `translate(${n.x} ${n.y})`);
  };
  draw();

  const disposeInteraction = bindGraphInteraction({ svg, scene, nodes, width: W, height: H,
    zoomOut, zoomIn, reset, draw, onOpen: id => {
      closeGraph();
      plugin.app.workspace.openLinkText(id, '', 'tab');
    } });
  const previousCleanup = plugin.maint.graphCleanup;
  plugin.maint.graphCleanup = () => { disposeInteraction(); previousCleanup?.(); };
  const legend = panel.createDiv({ cls: "alp-graph-legend" });
  legend.createSpan({ cls: "alp-graph-dot is-selected" });
  legend.createSpan({ text: t('graph.selected') });
  legend.createSpan({ cls: "alp-graph-dot" });
  legend.createSpan({ text: t("graph.context") });
  legend.createSpan({ cls: "alp-graph-line is-contracted" });
  legend.createSpan({ text: t("graph.contracted") });
  if (boundaryLinks.length) {
    legend.createSpan({ cls: "alp-graph-line is-boundary" });
    legend.createSpan({ text: t("graph.boundary") });
  }
  if (docked) void plugin.sidebars.show('graph', panel, closeGraph);
}

module.exports = { renderClusterGraph };
