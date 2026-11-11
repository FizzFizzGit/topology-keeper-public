const { promisify } = require('node:util');
const { gzip, gunzip } = require('node:zlib');
const { createDistanceTable } = require('./graph-distances');

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const VERSION = 1;
const MAX_BYTES = 32 * 1024 * 1024;

async function encodeDistanceCache(result, graph) {
  const { completedAt, model, threshold, candidatePairs, table } = result;
  const adjacency = [...graph].map(([node, neighbors]) => [node, [...neighbors]]);
  // JSONでは到達不能のInfinityはnullになる。保存順は隣接表の頂点順にそろえる。
  const nodes = [...graph.keys()];
  const hops = table && nodes.flatMap(from => nodes.map(to => table.distance(from, to)));
  const bytes = Buffer.from(JSON.stringify({ completedAt, model, threshold, candidatePairs, adjacency, hops }));
  if (bytes.length > MAX_BYTES) throw new RangeError('Distance analysis cache exceeds its size limit');
  return { version: VERSION, payload: (await compress(bytes)).toString('base64') };
}

async function decodeDistanceCache(saved) {
  if (saved?.version !== VERSION || typeof saved.payload !== 'string' || saved.payload.length > MAX_BYTES * 2) return null;
  const bytes = await decompress(Buffer.from(saved.payload, 'base64'), { maxOutputLength: MAX_BYTES });
  const { adjacency, completedAt, model, threshold, candidatePairs, hops } = JSON.parse(bytes.toString('utf8'));
  if (!Number.isFinite(completedAt) || !Number.isFinite(threshold) || threshold < 0 || threshold > 1
      || !Array.isArray(model?.parents) || !Array.isArray(model.originalAreas)
      || !Array.isArray(model.combinedAreas) || !Array.isArray(adjacency)) return null;
  if (!model.parents.every(parent => parent?.kind === 'distance' && Array.isArray(parent.nodes)
      && Array.isArray(parent.originalAreaIds) && Array.isArray(parent.selection?.links))
      || !model.originalAreas.every(area => Array.isArray(area?.nodes) && Array.isArray(area.links))
      || !model.combinedAreas.every(area => Array.isArray(area?.areaIds) && Array.isArray(area.members)
        && Array.isArray(area.connections) && Array.isArray(area.parentIds))
      || !adjacency.every(entry => Array.isArray(entry) && typeof entry[0] === 'string'
        && Array.isArray(entry[1]) && entry[1].every(node => typeof node === 'string'))) return null;
  const graph = new Map(adjacency.map(([node, neighbors]) => [node, new Set(neighbors)]));
  const result = { completedAt, model, threshold, candidatePairs };
  // 以前の結果は距離表なしでも表示できる。次の再計算で表を作る。
  if (Array.isArray(hops) && hops.length === graph.size * graph.size
      && hops.every(value => value === null || (Number.isInteger(value) && value >= 0 && value < graph.size))) {
    result.table = createDistanceTable(graph.keys(), Float64Array.from(hops, value => value ?? Infinity));
  }
  return { result, graph };
}

module.exports = { encodeDistanceCache, decodeDistanceCache };
