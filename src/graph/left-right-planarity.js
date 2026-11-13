// Brandes, The Left-Right Planarity Test, Definition 4 and Section 5.
// https://www.uni-konstanz.de/algo/publications/b-lrpt-sub.pdf
// DFSで得た閉路を左右に分けられるか調べる。描画座標や領域の境界は使わない。
async function checkLeftRightPlanarity(graph, tick) {
  const depth = new Map();
  const order = new Map();
  const subtreeEnd = new Map();
  const children = new Map();
  const backEdges = [];
  let work = 0;

  async function visit(node, parent, level) {
    depth.set(node, level);
    order.set(node, order.size);
    const branches = [];
    children.set(node, branches);
    for (const neighbor of graph.get(node)) {
      if (++work % 512 === 0) await tick();
      if (neighbor === parent) continue;
      if (!depth.has(neighbor)) {
        branches.push(neighbor);
        await visit(neighbor, node, level + 1);
      } else if (depth.get(neighbor) < level) {
        backEdges.push({ from: node, toDepth: depth.get(neighbor) });
      }
    }
    // DFS順で、子の部分木に属する頂点は連続した区間をなす。
    subtreeEnd.set(node, order.size);
  }
  for (const node of graph.keys()) if (!depth.has(node)) await visit(node, null, 0);

  const roots = backEdges.map((_, index) => index);
  const ranks = new Uint8Array(backEdges.length);
  const sides = new Uint8Array(backEdges.length);
  function root(index) {
    const parent = roots[index];
    if (parent === index) return index;
    roots[index] = root(parent);
    sides[index] ^= sides[parent];
    return roots[index];
  }
  // sidesには親と同じ側なら0、反対側なら1を持たせる。
  function constrain(a, b, opposite) {
    let left = root(a), right = root(b);
    const difference = sides[a] ^ sides[b] ^ opposite;
    if (left === right) return difference === 0;
    if (ranks[left] < ranks[right]) [left, right] = [right, left];
    roots[right] = left;
    sides[right] = difference;
    if (ranks[left] === ranks[right]) ranks[left]++;
    return true;
  }

  for (const [node, level] of depth) {
    if (level === 0) continue; // 根には枝が共有する親辺がない。
    const branches = children.get(node).map(child => ({
      start: order.get(child), end: subtreeEnd.get(child), returns: [], low: Infinity,
    }));
    for (const [index, edge] of backEdges.entries()) {
      if (++work % 512 === 0) await tick();
      // 親辺を共有する閉路だけが、この分岐点で制約を作る。
      if (edge.toDepth >= level) continue;
      if (edge.from === node) {
        branches.push({ returns: [index], low: edge.toDepth });
        continue;
      }
      const position = order.get(edge.from);
      const branch = branches.find(item => item.start <= position && position < item.end);
      if (!branch) continue;
      branch.returns.push(index);
      branch.low = Math.min(branch.low, edge.toDepth);
    }
    const active = branches.filter(branch => branch.returns.length);
    for (let i = 0; i < active.length; i++) {
      const first = active[i];
      for (const second of active.slice(i + 1)) {
        if (++work % 512 === 0) await tick();
        const left = first.returns.filter(index => backEdges[index].toDepth > second.low);
        const right = second.returns.filter(index => backEdges[index].toDepth > first.low);
        // 相手の最低帰着点より上へ戻る閉路を各枝で同じ側にそろえる。
        // 両方に該当する閉路があれば、枝同士の側は反対でなければならない。
        if (left.some(index => !constrain(left[0], index, 0)) ||
            right.some(index => !constrain(right[0], index, 0)) ||
            (left.length && right.length && !constrain(left[0], right[0], 1))) return 'nonplanar';
      }
    }
  }
  return 'planar';
}

module.exports = { checkLeftRightPlanarity };
