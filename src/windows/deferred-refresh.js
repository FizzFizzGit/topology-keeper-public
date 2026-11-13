// 押下中の再描画を一度だけ予約する。連続イベントでタイマーを積み上げない。
// 所有ビューのclose/disposeでcancelを呼び、破棄後の更新要求を防ぐ。
function createDeferredRefresh(refresh, delay = 300, timers = globalThis) {
  let timer = null;
  return {
    schedule() {
      if (timer !== null) return;
      timer = timers.setTimeout(() => { timer = null; refresh(); }, delay);
    },
    cancel() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
module.exports = { createDeferredRefresh };
