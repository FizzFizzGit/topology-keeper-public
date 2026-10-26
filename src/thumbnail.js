const { readImageFile } = require("./image-file");

// 外部の画像ファイルから縮小 WebP を作り、指定された Vault 内パスへ保存する。
//
// 【入力】 app は Obsidian の App。srcPath は元画像の OS 絶対パス、thumbVaultPath は
//   保存先の Vault 相対パス（親フォルダは呼び出し側が先に作成済み）。maxEdge は
//   サムネイルの長辺の上限ピクセル数。
// 【処理・出力】 Node の fs で元画像を読み、Blob / createImageBitmap / OffscreenCanvas を使って
//   アスペクト比を保った WebP（品質 0.8）に変換し、app.vault.createBinary に ArrayBuffer を渡す。
//   画像を拡大することはなく、成功時の戻り値は無い。読み込み・変換・保存に失敗した場合は
//   例外をそのまま呼び出し元へ返す。bitmap は成功・失敗にかかわらず最後に close する。
async function makeThumbnail(app, srcPath, thumbVaultPath, maxEdge) {
  const buf = await readImageFile(srcPath);
  const bitmap = await createImageBitmap(new Blob([buf]));
  try {
    const scale = Math.min(
      1,
      maxEdge / Math.max(bitmap.width, bitmap.height),
    );
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas contextを取得できません");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({
      type: "image/webp",
      quality: 0.8,
    });
    await app.vault.createBinary(thumbVaultPath, await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

module.exports = makeThumbnail;
