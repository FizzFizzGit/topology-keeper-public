/* ISC License, Copyright (c) 2026 fui. See ../LICENSE. */
/**
 * 再利用用の最小ウィンドウ部品。Obsidian・外部ライブラリには依存しない。
 *
 * 利用方法は二通り:
 * 1. createWindow() で枠を作り、返された body に利用側のDOMを追加する。
 * 2. 既存の枠には createFrame()・attachDrag()・constrain() を組み込む。
 *    Topology Keeper はこの方法で既存CSS・翻訳・設定保存を維持している。
 *
 * 入出力: DOMの位置・表示状態とイベント登録を変更する。ファイルやストレージは
 * 読み書きしない。保存は onPosition、アプリ固有の終了処理は onClose に渡す。
 * 制限: マウス操作用。タッチ、リサイズハンドル、ドッキング、モーダルの
 * フォーカス制御は実装していない。CSSも一緒に読み込むこと。
 */
// CommonJSではexports、通常のscriptタグではグローバル名PortableWindowを公開。
// factoryの評価時にはdocumentへ触れないため、Node上でもテストできる。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortableWindow = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // キーは窓のDOM、値は解除関数。再描画によるハンドルの交換でも登録を重複させない。
  // WeakMapはDOMの生存期間を延ばさないが、操作中のdocumentイベントは明示解除が必要。
  const bindings = new WeakMap();
  // 文書ごとに窓の前後関係を共有する。番号を増やし続けず、登録数の範囲で並べ直す。
  const stacks = new WeakMap();
  function createWindowStack({ baseZIndex = 40 } = {}) {
    const entries = [];
    const paint = () => entries.forEach((entry, index) => { entry.element.style.zIndex = String(baseZIndex + index); });
    return {
      /**
       * pointerdownをキャプチャして、子ボタンが伝播を止めても前へ出す。
       * focusinでも前へ出すためキーボード操作も対象。アプリの操作イベントは止めない。
       * 戻り値のdisposeを窓の破棄時に呼ぶ。非表示の窓は登録を保ったまま再利用できる。
       */
      register(element) {
        const existing = entries.find(entry => entry.element === element);
        if (existing) return existing.controller;
        const previous = element.style.zIndex;
        const entry = { element };
        const bringToFront = () => {
          const index = entries.indexOf(entry);
          if (index < 0) return;
          entries.splice(index, 1);
          entries.push(entry);
          paint();
        };
        const dispose = () => {
          const index = entries.indexOf(entry);
          if (index < 0) return;
          element.removeEventListener('pointerdown', bringToFront, true);
          element.removeEventListener('focusin', bringToFront);
          entries.splice(index, 1);
          element.style.zIndex = previous ?? '';
          paint();
        };
        entry.controller = { bringToFront, dispose };
        entries.push(entry);
        element.addEventListener('pointerdown', bringToFront, true);
        element.addEventListener('focusin', bringToFront);
        paint();
        return entry.controller;
      },
    };
  }
  function registerWindow(element) {
    const doc = element.ownerDocument;
    if (!stacks.has(doc)) stacks.set(doc, createWindowStack());
    return stacks.get(doc).register(element);
  }
  /**
   * 現在の表示寸法を測り、左上座標をビューポート内へ補正する。
   * @param {HTMLElement} element 表示済みのposition:fixed要素。
   * @param {Window} [viewport] 通常はelementの属するwindow。テスト時には差し替え可能。
   * @returns {{x: number, y: number}} 補正後のCSSピクセル座標。保存は呼び出し側の責務。
   * サイズは変更しない。窓が画面より大きい場合は左上を0にするだけなので、
   * 幅・高さの上限と本文のスクロールはCSS側で設定する。
   */
  function constrain(element, viewport = element.ownerDocument.defaultView) {
    const rect = element.getBoundingClientRect();
    const position = {
      x: Math.max(0, Math.min(rect.left, viewport.innerWidth - rect.width)),
      y: Math.max(0, Math.min(rect.top, viewport.innerHeight - rect.height)),
    };
    Object.assign(element.style, { left: `${position.x}px`, top: `${position.y}px`, right: 'auto' });
    return position;
  }

  /**
   * 既存の窓にドラッグ操作を追加する。DOMの生成やCSSの設定は行わない。
   * @param {HTMLElement} element 移動するposition:fixed要素。
   * @param {HTMLElement} handle タイトルバーなど、操作を開始する要素。
   * @param {object} [options]
   * @param {function({x:number,y:number}): void} [options.onPosition]
   *   移動を完了したときに一度呼ぶ。単なるクリックや解除時には呼ばない。
   *   非同期保存の完了待ち・例外処理は行わないため、利用側で失敗を処理すること。
   * @param {Window} [options.viewport] 座標制限に用いるwindow。
   * @param {function(): boolean} [options.canDrag] 操作開始時にドラッグを許可するか。
   * @returns {function(): void} 解除関数。窓の破棄・再描画前に呼ぶ。
   */
  function attachDrag(element, handle, { onPosition = () => {}, canDrag = () => true, viewport = element.ownerDocument.defaultView } = {}) {
    // 同じ窓への再登録は、旧ハンドルと操作途中のリスナーを先に解除する。
    bindings.get(element)?.();
    const doc = element.ownerDocument;
    // nullなら待機中。関数ならドラッグ中で、引数trueは完了、falseは取消。
    let finish = null;
    const down = event => {
      // 閉じるボタンや入力欄のクリックを、窓移動として奪わない。
      if (!canDrag() || event.button !== 0 || event.target.closest('button, input, select, textarea, a, [contenteditable], [role="button"]')) return;
      finish?.(false);
      const rect = element.getBoundingClientRect();
      // 押した場所と窓左上の差を維持し、開始時に窓がポインタへ飛ばないようにする。
      const dx = event.clientX - rect.left, dy = event.clientY - rect.top;
      let moved = false;
      const move = e => {
        moved = true;
        element.style.left = `${e.clientX - dx}px`;
        element.style.top = `${e.clientY - dy}px`;
        constrain(element, viewport);
      };
      const up = () => finish?.(true);
      finish = save => {
        // コールバックより先に解除する。保存処理が再描画しても旧操作を残さない。
        doc.removeEventListener('mousemove', move);
        doc.removeEventListener('mouseup', up);
        viewport.removeEventListener('blur', up);
        finish = null;
        if (save && moved) onPosition(constrain(element, viewport));
      };
      // 窓の外でも移動・ボタン解放を受け取る。ブラウザがフォーカスを失った場合も終了。
      doc.addEventListener('mousemove', move);
      doc.addEventListener('mouseup', up);
      viewport.addEventListener('blur', up);
      event.preventDefault(); // タイトル文字列の選択など、マウス操作の既定動作を止める。
    };
    const dispose = () => {
      // 解除は取消扱い。閉じる途中の座標を利用側へ勝手に保存しない。
      finish?.(false);
      handle.removeEventListener('mousedown', down);
      // 古い解除関数を後から呼んでも、新しい登録の管理情報は消さない。
      if (bindings.get(element) === dispose) bindings.delete(element);
    };
    handle.addEventListener('mousedown', down);
    bindings.set(element, dispose);
    return dispose;
  }
  /** 登録時の解除関数を持っていなくても解除できる。未登録なら何もしない。 */
  function detachDrag(element) { bindings.get(element)?.(); }

  /**
   * 利用側で保存・検証した共通表示設定をCSS変数へ反映する。保存・再描画は行わない。
   * fontScaleは80〜140の百分率、maxHeightPercentは50〜100、widthPxは240〜640px。
   * minHeightPx・minWidthPxは0〜640px。0は下限なし。CSSで下限を上限以下に抑える。
   * widthPxは自動伸縮の上限としてCSSが参照する（保存キー名は互換性のため維持）。
   * 高さ上限・幅の0は既存CSSの既定値を使用する。
   * 値の欠落・不正値は既定へ戻す。初期値へ戻した際に以前の高さ指定も取り除く。
   * CSS側では --pw-font-scale（倍率）・--pw-max-height（vh）・--pw-width（px）を参照。
   * 小さい画面に収めるため、CSS側でmax-widthも指定すること（同梱CSS参照）。
   */
  function applyAppearance(element, { fontScale = 100, maxHeightPercent = 0, widthPx = 0, minHeightPx, minWidthPx } = {}) {
    const scale = Number.isFinite(fontScale) ? Math.max(80, Math.min(140, fontScale)) : 100;
    element.style.setProperty('--pw-font-scale', String(scale / 100));
    if (Number.isFinite(maxHeightPercent) && maxHeightPercent !== 0) {
      element.style.setProperty('--pw-max-height', `${Math.max(50, Math.min(100, maxHeightPercent))}vh`);
    } else element.style.removeProperty('--pw-max-height');
    if (Number.isFinite(widthPx) && widthPx !== 0) {
      element.style.setProperty('--pw-width', `${Math.max(240, Math.min(640, widthPx))}px`);
    } else element.style.removeProperty('--pw-width');
    // 明示的な0pxは下限なし。未指定は利用側CSSの既定値へ戻す（窓と説明で別々）。
    if (Number.isFinite(minHeightPx)) {
      element.style.setProperty('--pw-min-height', `${Math.max(0, Math.min(640, minHeightPx))}px`);
    } else element.style.removeProperty('--pw-min-height');
    if (Number.isFinite(minWidthPx)) {
      element.style.setProperty('--pw-min-width', `${Math.max(0, Math.min(640, minWidthPx))}px`);
    } else element.style.removeProperty('--pw-min-width');
  }

  /**
   * 既存の外枠へ、空のヘッダーと本文を標準DOMで追加する。
   * @param {HTMLElement} element 追加先。既存の子要素は削除しない。
   * @param {object} [classes] アプリ側のCSSを使う場合のクラス名。
   * @returns {{head:HTMLElement, body:HTMLElement}} 中身・アイコン・操作は利用側が追加。
   * 再描画時は利用側で旧DOMとドラッグ登録を片付けてから呼ぶ。
   * この層は移動・保存・表示状態を持たないので、ペイン内の枠としても使える。
   */
  function createFrame(element, { headClass = 'pw-head', bodyClass = 'pw-body' } = {}) {
    const doc = element.ownerDocument;
    const head = doc.createElement('header');
    head.className = headClass;
    const body = doc.createElement('div');
    body.className = bodyClass;
    element.appendChild(head);
    element.appendChild(body);
    return { head, body };
  }

  /**
   * 標準DOMで窓を生成し、即座に表示する。内容の描画は呼び出し側が担当する。
   * @param {object} [options]
   * @param {HTMLElement} [options.mount] 追加先。省略時はdocument.body。
   *   座標は追加先からの相対位置ではなくビューポート基準。
   *   transformなどでfixed要素の基準を変える祖先の中には置かないこと。
   * @param {string} [options.title] タイトル。HTMLではなくテキストとして表示する。
   * @param {string} [options.closeLabel] 閉じるボタンの翻訳済みラベル。省略時は英語。
   * @param {{x:number,y:number}} [options.position] 有限数のCSSピクセル座標。
   *   外部から復元した値の検証は利用側で行う（デモ参照）。
   * @param {function({x:number,y:number}): void} [options.onPosition] 手動移動完了時の通知。
   * @param {function(): void} [options.onClose] hide()と閉じるボタンで呼ぶ。destroy()では呼ばない。
   * @returns {{element: HTMLElement, head: HTMLElement, body: HTMLElement,
   *   show: function, hide: function, destroy: function}}
   *   bodyへappend()などで内容を追加する。非表示はhide()、再利用を終えるならdestroy()。
   *   body内に利用側が登録したグローバルイベント等は、利用側で別途解除すること。
   */
  function createWindow({ mount, title = '', closeLabel, position = { x: 24, y: 48 }, onPosition, onClose = () => {} } = {}) {
    // 所属documentを使うことで、別ウィンドウのDOMを追加先にした場合も同じ文書で生成。
    const doc = mount?.ownerDocument ?? document;
    mount ??= doc.body;
    
    const element = doc.createElement('section');
    element.className = 'pw-window';
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', title);
    
    // Plugin側もこのフレーム生成を利用する。外枠の見た目と内容の描画は分離する。
    const { head, body } = createFrame(element);
    
    const label = doc.createElement('strong');
    label.textContent = title;
    
    const close = doc.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    // 翻訳辞書は利用アプリが持ち、汎用部品は言語を推測しない。
    close.setAttribute('aria-label', closeLabel ?? (title ? `Close ${title}` : 'Close'));
    
    head.append(label, close);
    mount.append(element);
    const stacking = registerWindow(element);
    Object.assign(element.style, { left: `${position.x}px`, top: `${position.y}px` });
    
    const viewport = doc.defaultView;
    // 自動補正は表示位置だけ変更し、onPositionを呼ばない（保存済みの手動位置とは分離）。
    const resize = () => { if (!element.hidden) constrain(element); };
    const disposeDrag = attachDrag(element, head, { onPosition });
    // 内容追加・detailsの開閉・フォント変更などによる窓寸法の変化も補正する。
    // ResizeObserver非対応環境では、画面resizeとshow時だけ補正する。
    const observer = viewport.ResizeObserver ? new viewport.ResizeObserver(resize) : null;
    
    observer?.observe(element);
    viewport.addEventListener('resize', resize);
    // 非表示でも内容は保持する。監視は継続するがresizeはhidden中に測定しない。
    const hide = () => { element.hidden = true; detachDrag(element); onClose(); };
    close.addEventListener('click', hide);
    resize();
    return { element, head, body,
      // hideで解除した操作を再登録。繰り返しshowしてもattachDrag側で重複を防ぐ。
      show() { element.hidden = false; attachDrag(element, head, { onPosition }); stacking.bringToFront(); resize(); },
      hide,
      // 初期登録とshow後の最新登録の両方を片付ける。destroy後の再表示はサポートしない。
      destroy() { stacking.dispose(); observer?.disconnect(); disposeDrag(); detachDrag(element); viewport.removeEventListener('resize', resize); close.removeEventListener('click', hide); element.remove(); },
    };
  }
  return { constrain, attachDrag, detachDrag, applyAppearance, createFrame, createWindow, createWindowStack, registerWindow };
});
