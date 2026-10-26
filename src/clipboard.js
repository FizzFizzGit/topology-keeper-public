// 文字列をクリップボードへコピーする。Clipboard APIが利用できない／拒否された場合はtextarea方式へフォールバックする。
// 入力はコピーする文字列、成功時の戻り値はundefined。コピーできなければ例外を返す。
async function copyTextToClipboard(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      /* fall through to the textarea fallback */
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("クリップボードへのコピーに失敗しました");
}

module.exports = { copyTextToClipboard };
