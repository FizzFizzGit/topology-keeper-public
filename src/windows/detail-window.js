const { renderOrphans } = require('../analysis/isolation-content');
const { createDeferredRefresh } = require('./deferred-refresh');
const { DEFAULT_WINDOW_SIZE } = require('../settings/window-appearance');
const { t } = require('../i18n/i18n');
const { createFrame, constrain, applyAppearance, registerWindow } = require('./portable-window');
const { setIcon, setTooltip } = require("obsidian");
const { createAnalysisContent } = require('../analysis/analysis-content');

// 構造分析・メンテナンスの詳細窓を管理する。
//
// 【責務】詳細窓の生成・表示・位置調整・描画差分の判定・破棄をまとめる。
//   分析本文はanalysis-content.js、孤立本文はisolation-content.jsへ委譲する。
//   Vault の分析やファイル操作は行わず、既存のプラグイン本体が持つ状態と操作口を利用する。
// 【入力】api は描画に必要な状態の取得と、削除・再計算・グラフ表示などの操作口を提供する。
//   options は UI の共通識別子と CONFIG。
// 【出力】DOM のみを更新する。ウィンドウ位置は api.setDetailPosition に渡し、
//   ドラッグ後の保存は api.enableDrag に委譲する。Vault の内容は変更しない。
class DetailWindowView {
  constructor(api, kind = "planar") {
    this.kind = kind;
    this.infoOwner = `detail-${kind}`;
    this.api = api;
    this.deferredRefresh = createDeferredRefresh(() => api.refresh());
    this.CSS_CLASS = api.CSS_CLASS;
    this.UI_TEXT = api.UI_TEXT;
    this.EVENT = api.EVENT;
    this.ICON = api.ICON;
    this.maxFindings = api.maxFindings;
    this.el = null;
    this.visible = false;
    this.analysisContent = createAnalysisContent(api, {
      requestRender: () => this.render(),
      fitContent: () => api.fitWindowToContent?.(this.el),
    }, { t, setIcon, setTooltip });
  }

  open() {
    this.visible = true;
    this.api.setWindowVisible?.(true);
    this.api.updateDetailButton();
    if (!this.el) {
      this.el = document.body.createDiv({ cls: this.CSS_CLASS.alpDetailWin });
      this.stacking = registerWindow(this.el);
      applyAppearance(this.el, this.api.getWindowAppearance?.());
      this.el.dataset.infoOwner = this.infoOwner;
      this.el.setWindowPosition = (position) => this.api.setDetailPosition(position);
    }

    const position = this.api.getDetailPosition();
    if (position) {
      this.el.style.left = `${position.x}px`;
      this.el.style.top = `${position.y}px`;
    } else {
      this.placeAtDefaultPosition();
    }
    // 共通設定の幅をCSSから適用する。インライン幅で設定変更を妨げない。
    this.el.style.width = "";
    this.el.style.right = "auto";
    this.el.classList.remove(this.CSS_CLASS.isHidden);
    this.stacking?.bringToFront();
    this.render(true);
    if (!position) this.placeAtDefaultPosition();
    this.constrainToViewport();
    this.api.saveState?.();
    this.syncPlacement();
  }

  syncPlacement() {
    if (this.el) this.api.placeWindow?.(this.kind, this.el, this.visible, () => this.close());
  }

  windowWidth() {
    const appearance = this.api.getWindowAppearance?.();
    const width = appearance?.widthPx || DEFAULT_WINDOW_SIZE;
    return Math.max(0, Math.min(width, window.innerWidth - 12));
  }

  placeAtDefaultPosition() {
    if (!this.el) return;
    const mainRect = this.api.getMainWindow()?.getBoundingClientRect();
    // 本文描画後の実幅を使用し、内容が広い窓もメイン窓の左に隙間なく置く。
    const width = this.el.getBoundingClientRect().width || this.windowWidth();
    const left = mainRect
      ? Math.max(0, Math.min(mainRect.left - width - 5, window.innerWidth - width))
      : Math.max(0, window.innerWidth - width - 16);
    const top = mainRect
      ? Math.max(0, Math.min(mainRect.top, window.innerHeight - 180))
      : 48;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.right = "auto";
  }

  resetPosition() {
    this.api.setDetailPosition(null);
    this.placeAtDefaultPosition();
    this.constrainToViewport();
  }

  close() {
    this.deferredRefresh.cancel();
    this.renderSignature = null;
    this.disposeDrag?.();
    this.visible = false;
    this.api.setWindowVisible?.(false);
    this.api.saveState?.();
    this.api.updateDetailButton();
    if (this.kind === "planar") this.api.disposeGraphListeners();
    this.api.removeInfoPopovers(this.infoOwner);
    this.el?.addClass(this.CSS_CLASS.isHidden);
    this.syncPlacement();
  }

  dispose() {
    this.deferredRefresh.cancel();
    this.renderSignature = null;
    this.stacking?.dispose();
    this.disposeDrag?.();
    this.visible = false;
    this.api.removeInfoPopovers(this.infoOwner);
    this.el?.remove();
    this.el = null;
  }

  constrainToViewport() {
    const el = this.el;
    if (!el || el.classList.contains(this.CSS_CLASS.isHidden) || el.classList.contains('tk-docked-window')) return;
    this.api.setDetailPosition(constrain(el, window));
  }

  updateDistanceProgress(value) {
    const progress = this.el?.querySelector('.alp-distance-progress');
    if (progress && Number.isFinite(value)) progress.value = value;
  }

  render(opening = false) {
    const api = this.api;
    if (!this.el || !this.visible) return;
    // 計算中の表示は結果の差分とは独立して更新する。
    // DOMを保持する場合や、押下中で本文描画を保留する場合も回転を開始・停止する。
    this.el?.querySelectorAll?.('.alp-refresh-btn').forEach(button =>
      button.classList.toggle('is-loading', !!api.isMaintSpinning?.(this.kind)));
    const pointerHeldAt = api.getPointerHeldAt();
    if (!opening && pointerHeldAt && Date.now() - pointerHeldAt < 2000) {
      this.deferredRefresh.schedule();
      return;
    }
    const el = this.el;
    if (!el || !this.visible) return;
    const r = api.getResult();
    const isAnalysis = this.kind === 'planar';
    // 計算結果は完了時に差し替わるので、分析の数MBのJSONを毎回作らず参照を比較する。
    // TFileは同じインスタンスのパスが変わるため、孤立一覧は表示値を比較する。
    const showingDistance = !!r?.distanceAnalysis?.model;
    const signature = isAnalysis
      ? [t('window.analysis'), r?.distanceAnalysis, api.getGraphNodeLimit?.(), JSON.stringify(api.getAreaColors?.()),
        showingDistance ? null : r?.planar, showingDistance ? null : r?.areaModel,
        showingDistance ? null : r?.analysisError, showingDistance ? null : api.isAnalysisRunning?.()]
      : [t('common.orphan'), JSON.stringify(r && [
        r.maintenanceReady,
        r.orphans.map(file => [file.path, api.metaLabel(file)]),
        r.strayThumbs.map(file => [file.path, file.name]),
        r.orphanBases.map(file => [file.path, api.getBaseLabel(file)]),
        r.noteIsolation && [r.noteIsolation.ready, ...['isolated', 'tagOnly', 'allowed']
          .map(key => r.noteIsolation[key].map(file => [file.path, file.basename]))],
      ])];
    const graphRevision = api.getGraphRevision?.();
    const selection = api.getSelectedCluster?.();
    if (this.renderSignature?.every((value, index) => value === signature[index])) {
      if (isAnalysis && (selection !== this.renderedSelection || graphRevision !== this.renderedGraphRevision)) {
        this.analysisContent.refreshSelectedGraph();
        this.renderedSelection = api.getSelectedCluster?.();
        this.renderedGraphRevision = api.getGraphRevision?.();
      }
      return;
    }
    const scrollTop = el.querySelector(".alp-detail-body")?.scrollTop ?? 0;
    if (this.kind === "planar") api.disposeGraphListeners();
    api.removeInfoPopovers(this.infoOwner);
    el.empty();
    this.renderSignature = null; // 描画途中の失敗を「描画済み」としない。

    // メイン窓と同じ生成処理を使い、内容とCSSクラスだけを差し替える。
    const { head, body } = createFrame(el, { headClass: 'alp-detail-head', bodyClass: 'alp-detail-body' });
    const mark = head.createSpan({ cls: "alp-detail-mark" });
    setIcon(mark, this.ICON.chart);
    head.createSpan({
      cls: "alp-detail-title",
      text: this.kind === "orphan" ? t("common.orphan") : t("window.analysis"),
    });
    const refresh = api.iconButton(head, "refresh-cw", t(this.kind === 'orphan' ? 'window.recheckIsolation' : 'window.recheckAnalysis'), () =>
      api.recheck(this.kind),
    );
    refresh?.classList.toggle('is-loading', !!api.isMaintSpinning?.(this.kind));
    const closedByButton = new WeakSet();
    const fit = () => {
      api.fitWindowToContent(el);
      this.constrainToViewport();
    };
    api.iconButton(head, 'fold-vertical', t('window.collapseAll'), () => {
      this.analysisContent.expandedAreas.clear();
      api.collapseSections(body, closedByButton);
      fit();
    });
    api.iconButton(head, "locate-fixed", t("window.resetPosition"), () => {
      this.resetPosition();
      api.saveState();
    });
    api.iconButton(head, "x", t("window.close"), () =>
      this.close(),
    );
    this.disposeDrag?.();
    // ヘッダーはrenderごとに作り直すため、現在の登録を解除できるよう保持する。
    this.disposeDrag = api.enableDrag(el, head);

    // Native details toggle events do not bubble; capture nested sections too.
    body.addEventListener('toggle', event => {
      if (closedByButton.delete(event?.target) && !event.target.open) return;
      fit();
    }, true);
    if (r) {
      const orphanCount =
        r.orphans.length + r.strayThumbs.length + r.orphanBases.length;
      if (this.kind === "orphan") this.renderOrphans(body, r, orphanCount);
      else this.renderPlanar(body, r);
    } else {
      body.createDiv({
        cls: this.CSS_CLASS.alpEmpty,
        text: t("window.checking"),
      });
    }
    body.scrollTop = scrollTop;
    this.renderSignature = signature;
    this.renderedGraphRevision = api.getGraphRevision?.();
    this.renderedSelection = api.getSelectedCluster?.();
    api.fitWindowToContent(el);
  }

  // 窓のライフサイクルと、孤立結果の本文描画を別モジュールにする。
  renderOrphans(body, r, orphanCount) {
    return renderOrphans(body, r, orphanCount, this.api, t);
  }

  // 本文描画は独立ビューへ委譲する。
  renderPlanar(body, result) {
    return this.analysisContent.renderPlanar(body, result);
  }

}

module.exports = DetailWindowView;
