const fs = require("fs");
const { CONFIG } = require("./plugin-settings");

// ローカル画像を容量制限付きで読む。通常ファイル以外と上限超過は例外にする。
// 読み込み中にファイルが増大しても、上限を超えた時点でストリームを閉じる。
async function readImageFile(filePath) {
  if (!filePath) throw new Error("画像のローカルファイルURLが不正です。");
  if (/^[\\/]{2}/.test(filePath)) throw new Error("ネットワーク画像は対象外です。");
  filePath = await fs.promises.realpath(filePath);
  if (/^[\\/]{2}/.test(filePath)) throw new Error("ネットワーク画像へのリンクは対象外です。");
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > CONFIG.maxImageBytes)
    throw new Error("画像は32 MiB以下の通常ファイルにしてください。");
  const chunks = [];
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    size += chunk.length;
    if (size > CONFIG.maxImageBytes) throw new Error("画像の読み込み上限を超えました。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

module.exports = { readImageFile };
