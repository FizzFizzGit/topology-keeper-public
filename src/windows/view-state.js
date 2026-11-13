// 表示する値だけを取り出す。分析内容の全JSONを比較せず、メイン窓の更新条件を明確にする。
// 詳細窓は独自の差分判定を持つため、ここで同じ件数でも詳細の更新を止めない。
function indicatorState(r) {
  const managedCount = r ? r.orphans.length + r.strayThumbs.length + r.orphanBases.length : 0;
  // 通常ノートと管理データの要確認数を合算する。解析待ちは未確定値として扱う。
  const orphanCount = r && r.maintenanceReady !== false && (!r.noteIsolation || r.noteIsolation.ready)
    ? (r.noteIsolation?.isolated.length ?? 0) + managedCount : null;
  const crossingCount = (r?.distanceAnalysis?.model ?? r?.areaModel)?.parents.length ?? null;
  return { managedCount, orphanCount, crossingCount };
}
module.exports = { indicatorState };
