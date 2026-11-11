// 回転系を全列挙する平面性判定。入力は連結な単純無向グラフ。
// 頂点ごとの辺の巡回順から面を数える。V - E + F = 2 になる順序があれば平面。
// 検証の根拠: https://jeffe.web.engr.illinois.edu/teaching/comptop/2023/notes/09-planar-graphs.html
const MAX_DART_VISITS = 32_000_000;

async function checkSmallPlanarity(graph, tick) {
  let dartCount = 0;
  for (const neighbors of graph.values()) dartCount += neighbors.size;
  let work = dartCount;
  for (const neighbors of graph.values()) {
    // 巡回順は最初の辺を固定できるので、次数 d の候補は (d - 1)! 通り。
    for (let factor = 2; factor < neighbors.size; factor++) {
      work *= factor;
      if (work > MAX_DART_VISITS) return 'undetermined';
    }
  }

  const outgoing = new Map([...graph.keys()].map(node => [node, new Map()]));
  let nextDart = 0;
  for (const [from, neighbors] of graph) {
    for (const to of neighbors) {
      if (outgoing.get(from).has(to)) continue;
      // 同じ辺の往復は連番にし、dart ^ 1 で逆向きを得る。
      outgoing.get(from).set(to, nextDart++);
      outgoing.get(to).set(from, nextDart++);
    }
  }
  const orders = [...outgoing.values()].map(edges => [...edges.values()]);
  const successor = new Int32Array(dartCount);
  const seen = new Int32Array(dartCount);
  const targetFaces = dartCount / 2 - graph.size + 2;
  let checked = 0;

  function hasPlanarFaces() {
    let faces = 0;
    for (let dart = 0; dart < dartCount; dart++) {
      if (seen[dart] === checked) continue;
      faces++;
      let current = dart;
      do {
        seen[current] = checked;
        // 辺をたどった先で巡回順の次の辺へ進むと、同じ面を一周する。
        current = successor[current ^ 1];
      } while (current !== dart);
    }
    return faces === targetFaces;
  }

  function* search(vertex, position = 1) {
    if (vertex === orders.length) {
      if (++checked % 2048 === 0) yield;
      return hasPlanarFaces();
    }
    const order = orders[vertex];
    if (position >= order.length) {
      for (let i = 0; i < order.length; i++) successor[order[i]] = order[(i + 1) % order.length];
      return yield* search(vertex + 1);
    }
    for (let i = position; i < order.length; i++) {
      [order[position], order[i]] = [order[i], order[position]];
      if (yield* search(vertex, position + 1)) return true;
      [order[position], order[i]] = [order[i], order[position]];
    }
    return false;
  }

  const candidates = search(0);
  for (;;) {
    const step = candidates.next();
    if (step.done) return step.value ? 'planar' : 'nonplanar';
    await tick();
  }
}

module.exports = { checkSmallPlanarity };
