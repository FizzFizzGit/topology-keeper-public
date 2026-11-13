/** 文字幅を測って最大2行へ収める。収まらない末尾は省略し、画像の外へ出さない。 */
function titleLines(context, title, width, maxLines = 2) {
  const remaining = Array.from(String(title).replace(/\s+/g, ' ').trim());
  const lines = [];
  while (remaining.length && lines.length < maxLines) {
    let line = '';
    while (remaining.length && context.measureText(line + remaining[0]).width <= width) line += remaining.shift();
    if (!line && remaining.length) remaining.shift();
    if (lines.length === maxLines - 1 && remaining.length) {
      while (line && context.measureText(line + '…').width > width) line = Array.from(line).slice(0, -1).join('');
      line += '…';
    }
    lines.push(line.trim());
    while (remaining[0] === ' ') remaining.shift();
  }
  return lines;
}

/**
 * 保存するPNG自身へタイトル枠を描き込む。Markdownやテーマによる別表示に依存しない。
 * 入出力は画像バイト列。Vault操作・通信はしない。オフなら元画像をそのまま返す。
 * 下部に半透明の暗い枠を重ね、白文字でタイトルを描く。画像寸法は変えない。
 * runtimeを差し替え、CanvasのないNodeでも折り返しと描画手順をテストできる。
 */
async function addThumbnailTitle(png, title, { showTitle = true } = {}, runtime = globalThis) {
  if (!showTitle || !String(title).trim()) return png;
  const bitmap = await runtime.createImageBitmap(new Blob([png], { type: 'image/png' }));
  try {
    const canvas = new runtime.OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('thumbnail-canvas-unavailable');
    context.drawImage(bitmap, 0, 0);
    const padding = Math.max(4, Math.min(10, Math.round(bitmap.width * 0.03)));
    const fontSize = Math.max(11, Math.min(20, Math.round(bitmap.width * 0.055)));
    const lineHeight = Math.ceil(fontSize * 1.3);
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    const maxLines = Math.max(1, Math.min(2, Math.floor((bitmap.height - padding * 2) / lineHeight)));
    const lines = titleLines(context, title, bitmap.width - padding * 2, maxLines);
    if (!lines.length) return png;
    const height = Math.min(bitmap.height, lines.length * lineHeight + padding * 2);
    const top = bitmap.height - height;
    context.fillStyle = 'rgba(12, 16, 22, 0.82)';
    context.fillRect(0, top, bitmap.width, height);
    context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    context.lineWidth = 1;
    context.strokeRect(0.5, top + 0.5, bitmap.width - 1, height - 1);
    context.fillStyle = '#ffffff';
    context.textBaseline = 'top';
    lines.forEach((line, index) => context.fillText(line, padding, top + padding + index * lineHeight));
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } finally { bitmap.close(); }
}

module.exports = { titleLines, addThumbnailTitle };
