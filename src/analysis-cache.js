/** 順序に依存せず接続を比較する。ハッシュ衝突を避け、辺の追加・削除を直接確認する。 */
function sameAdjacency(left, right) {
  if (!left || left.size !== right.size) return false;
  for (const [node, neighbors] of right) {
    const previous = left.get(node);
    if (!previous || previous.size !== neighbors.size) return false;
    for (const neighbor of neighbors) if (!previous.has(neighbor)) return false;
  }
  return true;
}
module.exports = { sameAdjacency };
