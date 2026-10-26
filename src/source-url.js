const { fileURLToPath, pathToFileURL } = require("url");
const path = require("path");
// メタノートの frontmatter.source に使う URL と、元ファイル情報の変換。
// 壊れたパーセントエンコードは、デコード前の値をそのまま返す。
const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// cleanPath は区切りを "/" に直した絶対パス。
function toSourceUrl(cleanPath) {
  return pathToFileURL(cleanPath).href
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
}

function filenameFromSource(source) {
  return safeDecode(String(source).split("/").pop());
}

function pathFromSource(source) {
  if (typeof source !== "string") return "";
  try {
    const url = new URL(source);
    if (url.protocol !== "file:" || url.hostname || url.search || url.hash) return "";
    const localPath = fileURLToPath(url);
    if (!path.isAbsolute(localPath) || /^[\\/]{2}/.test(localPath) || localPath.includes("\0")) return "";
    // Windowsの代替データストリームを開かない。
    if (process.platform === "win32" && localPath.slice(2).includes(":")) return "";
    return localPath;
  } catch {
    return "";
  }
}

module.exports = { toSourceUrl, filenameFromSource, pathFromSource };
