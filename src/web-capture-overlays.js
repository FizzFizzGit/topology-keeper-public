/**
 * 撮影用の一時ページだけを整える。クリックは行わず、同意・購入などの操作を発生させない。
 * ページ内で実行するため、外部変数・Node APIには依存させない。
 */
function hideCaptureOverlays() {
  const width = window.innerWidth, height = window.innerHeight;
  let hidden = 0;
  for (const element of document.querySelectorAll('body *')) {
    // bodyやアプリのルート全体は対象外。通常の本文・ゲーム盤面を残す。
    const style = getComputedStyle(element);
    const modal = element.getAttribute('aria-modal') === 'true'
      || element.getAttribute('role') === 'dialog';
    if (!modal && style.position !== 'fixed') continue;
    const rect = element.getBoundingClientRect();
    const area = Math.max(0, Math.min(width, rect.right) - Math.max(0, rect.left))
      * Math.max(0, Math.min(height, rect.bottom) - Math.max(0, rect.top));
    if (area < width * height * 0.15 || style.display === 'none' || style.visibility === 'hidden') continue;
    const identity = `${element.id} ${element.className} ${element.getAttribute('aria-label') || ''}`;
    const advert = /(?:advert|interstitial|promotion|popup|pop-up|ad-overlay|ad-modal|広告)/i.test(identity);
    // modalの祖先（MUIなどのbackdropを含む固定ルート）を隠せば暗幕も残らない。
    const dialog = modal || element.querySelector('[aria-modal="true"], [role="dialog"]');
    if (!advert && !dialog) continue;
    if (!modal && !advert && element.querySelector('main, canvas, [role="main"]')) continue;
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('pointer-events', 'none', 'important');
    hidden++;
  }
  return hidden;
}

const HIDE_CAPTURE_OVERLAYS_SCRIPT = `(${hideCaptureOverlays.toString()})()`;
module.exports = { hideCaptureOverlays, HIDE_CAPTURE_OVERLAYS_SCRIPT };
