// Webサムネイルの識別規則と表示幅。撮影・本文描画・孤立判定で同じ定義を使う。
// 任意のPNGを管理対象へ広げず、この機能が生成した名前にだけ限定する。
const WEB_THUMBNAIL_WIDTH = 256;
const UUID_PNG_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;

function isUuidPngName(name) { return UUID_PNG_NAME.test(name); }
function normalizeThumbnailOptions(value) {
  return { width: Number.isFinite(value?.width) ? Math.round(Math.max(64, Math.min(1024, value.width))) : WEB_THUMBNAIL_WIDTH,
    showTitle: value?.showTitle !== false };
}

// UUID名だけでは他アプリの画像と区別できないため、生成したパスと幅を保存して識別する。
function normalizeWebThumbnailFiles(value) {
  const records = {};
  for (const [path, width] of Object.entries(value && typeof value === 'object' ? value : {})) {
    const parts = path.split('/');
    if (/[\\:\0]/.test(path) || parts.some(part => !part || part === '.' || part === '..') || !isUuidPngName(parts.at(-1))) continue;
    records[path] = normalizeThumbnailOptions({ width }).width;
  }
  return records;
}

// 生成記録に保存した幅を閲覧表示へ反映する。画像や本文自体は変更しない。
function styleWebThumbnails(element, records = {}) {
  const sizes = new Map(Object.entries(records).map(([path, width]) => [path.split('/').pop(), width]));
  for (const image of element.querySelectorAll('img')) {
    let name;
    try { name = decodeURIComponent((image.getAttribute('src') ?? '').split(/[?#]/)[0].split('/').pop()); }
    catch { continue; }
    const width = sizes.get(name);
    if (!width) continue;
    image.style.maxWidth = `min(100%, ${width}px)`;
    image.style.height = 'auto';
  }
}

module.exports = { WEB_THUMBNAIL_WIDTH, isUuidPngName, normalizeThumbnailOptions, normalizeWebThumbnailFiles, styleWebThumbnails };
