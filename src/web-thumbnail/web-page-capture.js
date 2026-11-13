const { randomUUID } = require('crypto');
const { normalizeThumbnailOptions } = require('./web-thumbnail-data');
const { HIDE_CAPTURE_OVERLAYS_SCRIPT } = require('./web-capture-overlays');
// FHD強制とdevice emulationの併用後にホスト終了の報告あり。
// 実機で安定性を確認できるまでは、動作実績のある撮影寸法を使う。
const CAPTURE_SIZE = Object.freeze({ width: 1280, height: 900 });

// ページ内部で実行する固定の待機処理。画像とフォントの準備後、描画フレームを待つ。
// サイトのスクリプトや読み込みが完了しない場合も、各待機を3秒で打ち切る。
const PAGE_READY_SCRIPT = `(async () => {
  const limited = promise => Promise.race([promise, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (document.fonts) await limited(document.fonts.ready);
  await limited(Promise.all(Array.from(document.images).slice(0, 40).map(image => {
    if (image.complete) return Promise.resolve();
    return new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); });
  })));
  await limited(new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
})()`;

/** NativeImageのisEmptyは白紙でもfalse。画素を間引いて単色・全透明の撮影失敗を検出する。 */
function hasPageContent(image) {
  if (!image || image.isEmpty()) return false;
  const size = image.getSize();
  if (size.width < CAPTURE_SIZE.width || size.height < CAPTURE_SIZE.height) return false;
  const bitmap = image.toBitmap();
  const step = Math.max(4, Math.floor(bitmap.length / (4 * 65536)) * 4);
  let first = null;
  for (let offset = 0; offset + 3 < bitmap.length; offset += step) {
    if (!bitmap[offset + 3]) continue;
    const color = `${bitmap[offset]},${bitmap[offset + 1]},${bitmap[offset + 2]}`;
    if (first === null) first = color;
    else if (color !== first) return true;
  }
  return false;
}

/** HTTP(S)の単一URL・Markdownリンク・山括弧URLを受け取り、撮影先を正規化する。 */
function pageUrl(text) {
  const value = String(text ?? '').trim();
  if (/[\r\n]/.test(value)) throw new Error('invalid-url');
  const match = value.match(/^\[[^\]\r\n]*\]\((?:<([^>\r\n]+)>|([^\s]+))\)$/)
    ?? value.match(/^<([^>\r\n]+)>$/);
  const url = new URL(match ? (match[1] ?? match[2]) : value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid-url');
  return url.href;
}

/**
 * 独立した一時セッションの非表示ブラウザでページ上部を撮影する。
 * Electronの取得は利用側、画像保存はworkflow側。この層はVault・ノートに触れない。
 * ページへNode・preload・Obsidianのセッションを渡さず、権限要求・別窓・ダウンロードも拒否する。
 * オフスクリーン描画・画像/フォント待機・単色画像の再試行で白紙撮影を抑える。
 * ログインやCookie画面、任意の遅延描画を自動処理するものではない。
 */
async function captureWebPage(input, { BrowserWindow, signal, timeoutMs = 25000, settleMs = 1500, thumbnailWidth }) {
  const url = pageUrl(input);
  if (signal?.aborted) throw new Error('capture-cancelled');
  let win, timeout, settleTimer, rejectStop, paintedFrame;
  // paintには変更箇所だけの画像が来る場合がある。部分フレームを完成画像として使わない。
  const onPaint = (_event, dirty, image) => {
    if (dirty.x === 0 && dirty.y === 0 && dirty.width >= CAPTURE_SIZE.width && dirty.height >= CAPTURE_SIZE.height) paintedFrame = image;
  };
  const stop = new Promise((_, reject) => { rejectStop = reject; });
  const cancel = () => rejectStop(new Error('capture-cancelled'));
  try {
    win = new BrowserWindow({ ...CAPTURE_SIZE, useContentSize: true, show: false,
      backgroundColor: '#ffffff', paintWhenInitiallyHidden: true,
      webPreferences: { partition: `tk-web-${randomUUID()}`, nodeIntegration: false,
        nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
        offscreen: true, backgroundThrottling: false, navigateOnDragDrop: false, autoplayPolicy: 'user-gesture-required' } });
    const contents = win.webContents;
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.on('will-download', event => event.preventDefault());
    const navigation = (event, target) => {
      try { pageUrl(target); } catch { event.preventDefault(); }
    };
    contents.on('will-navigate', navigation);
    contents.on('will-redirect', navigation);
    contents.on('render-process-gone', () => rejectStop(new Error('capture-renderer-failed')));
    contents.on('paint', onPaint);
    contents.setFrameRate?.(30);
    win.on('closed', cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    timeout = setTimeout(() => rejectStop(new Error('capture-timeout')), timeoutMs);
    const work = async () => {
      await win.loadURL(url);
      contents.startPainting?.();
      await contents.executeJavaScript(PAGE_READY_SCRIPT);
      const wait = ms => new Promise(resolve => { settleTimer = setTimeout(resolve, ms); });
      await wait(settleMs);
      let image;
      for (let attempt = 0; attempt < 3; attempt++) {
        // 遅れて現れる告知にも対応。除去前のpaintフレームは再利用しない。
        paintedFrame = null;
        await contents.executeJavaScript(HIDE_CAPTURE_OVERLAYS_SCRIPT);
        await contents.executeJavaScript(PAGE_READY_SCRIPT);
        // DPIや非表示窓の寸法解釈に任せず、ページ上部の論理ピクセル範囲を指定する。
        image = await contents.capturePage({ x: 0, y: 0, ...CAPTURE_SIZE }, { stayHidden: true, stayAwake: false });
        if (hasPageContent(image)) break;
        // オフスクリーンのpaintイベントは実際に描画されたフレームを持つ。
        if (hasPageContent(paintedFrame)) { image = paintedFrame; break; }
        image = null;
        if (attempt < 2) await wait(Math.max(300, settleMs));
      }
      if (!image) throw new Error('capture-blank');
      const png = image.resize({ width: normalizeThumbnailOptions({ width: thumbnailWidth }).width }).toPNG();
      if (!png.length || png.length > 8 * 1024 * 1024) throw new Error('capture-image-size');
      return { png, title: (contents.getTitle() || new URL(url).hostname).slice(0, 300), url };
    };
    return await Promise.race([work(), stop]);
  } finally {
    clearTimeout(timeout);
    clearTimeout(settleTimer);
    signal?.removeEventListener('abort', cancel);
    if (win && !win.isDestroyed()) {
      win.webContents.removeListener('paint', onPaint);
      win.removeListener('closed', cancel);
      win.destroy();
    }
  }
}

module.exports = { pageUrl, captureWebPage, hasPageContent };
