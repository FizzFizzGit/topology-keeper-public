const { findBiconnectedComponents, splitStructuralAreas, findNonPlanar, getRemainderKind, REMAINDER_LABELS } = require('./graph-analysis');

// Membership uses the original note graph, never the reduced planarity graph.
// IDs encode sorted membership without hashing collisions or delimiter ambiguity.
const areaId = nodes => `area:${JSON.stringify([...nodes].sort())}`;
function induced(graph, nodes) {
  return new Map([...nodes].map(node => [node,
    new Set([...(graph.get(node) ?? [])].filter(other => nodes.has(other)))]));
}

async function buildAreaModel(adjacency, tick, { scope = '', connected = false } = {}) {
  await tick();
  const notes = new Map();
  let work = 0;
  for (const [node, neighbors] of adjacency) {
    if (++work % 200 === 0) await tick();
    if (node.startsWith('#')) continue;
    notes.set(node, new Set([...neighbors].filter(other => !other.startsWith('#'))));
  }
  const byId = new Map();
  const components = [];
  if (connected) {
    const remaining = new Set(notes.keys());
    while (remaining.size) {
      const queue = [remaining.values().next().value];
      remaining.delete(queue[0]);
      for (let i = 0; i < queue.length; i++) {
        if (++work % 200 === 0) await tick();
        for (const neighbor of notes.get(queue[i])) if (remaining.delete(neighbor)) queue.push(neighbor);
      }
      if (queue.length >= 2) components.push(new Set(queue));
    }
  }
  for (const block of connected ? components : await findBiconnectedComponents(notes, tick)) {
    if (block.size < (connected ? 2 : 3)) continue;
    const graph = induced(notes, block);
    for (const group of connected ? [block] : await splitStructuralAreas(graph, tick)) {
      for (const members of connected ? [group] : await findBiconnectedComponents(induced(graph, group), tick)) {
        if (members.size < (connected ? 2 : 3)) continue;
        await tick();
        const nodes = [...members].sort();
        const links = [];
        for (const node of nodes) {
          for (const other of notes.get(node)) {
            if (++work % 200 === 0) await tick();
            if (node < other && members.has(other)) links.push([node, other]);
          }
        }
        links.sort(([a, b], [c, d]) => a.localeCompare(c) || b.localeCompare(d));
        const id = scope ? JSON.stringify([scope, areaId(nodes)]) : areaId(nodes);
        byId.set(id, { id, nodes, links, graphBasis: 'direct-note-links' });
      }
    }
  }
  const originalAreas = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const area of originalAreas) {
    const analysis = await findNonPlanar(induced(notes, new Set(area.nodes)), tick);
    area.classification = analysis.definite.length ? 'nonplanar'
      : analysis.suspect.length || analysis.truncated ? 'undetermined' : 'planar';
  }
  const combinedAreas = await combineAreas(adjacency, originalAreas, tick);
  return { version: 1, graphBasis: 'direct-note-links', originalAreas, combinedAreas };
}

async function combineAreas(adjacency, originalAreas, tick, crossParent = false) {
  let work = 0;
  const membership = new Map();
  for (const area of originalAreas) for (const node of area.nodes) {
    if (!membership.has(node)) membership.set(node, []);
    membership.get(node).push(area.id);
  }
  const combinedAreas = [];
  for (const [tag, neighbors] of adjacency) {
    if (!tag.startsWith('#')) continue;
    const evidence = new Map();
    for (const node of neighbors) {
      if (++work % 200 === 0) await tick();
      for (const id of membership.get(node) ?? []) {
        if (!evidence.has(id)) evidence.set(id, new Set());
        evidence.get(id).add(node);
      }
    }
    // Preserve exact evidence per pair. A shared articulation note alone
    // cannot establish a cross-area relationship.
    const entries = [...evidence].sort(([a], [b]) => a.localeCompare(b));
    const connections = [];
    const connectedIds = new Set();
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      if (++work % 200 === 0) await tick();
      const [a, aNodes] = entries[i];
      const [b, bNodes] = entries[j];
      if (crossParent) {
        const areaA = originalAreas.find(area => area.id === a);
        const areaB = originalAreas.find(area => area.id === b);
        if (areaA.parentId === areaB.parentId) continue;
        // Overlapping parent windows of the same notes are not a crossing.
        if (!areaA.nodes.some(node => !areaB.nodes.includes(node)) ||
            !areaB.nodes.some(node => !areaA.nodes.includes(node))) continue;
        if (![...aNodes].some(node => !areaB.nodes.includes(node)) ||
            ![...bNodes].some(node => !areaA.nodes.includes(node))) continue;
      }
      if (new Set([...aNodes, ...bNodes]).size < 2) continue;
      connections.push({ areaIds: [a, b] });
      connectedIds.add(a);
      connectedIds.add(b);
    }
    if (!connections.length) continue;
    const members = entries.filter(([id]) => connectedIds.has(id))
      .map(([id, nodes]) => ({ areaId: id, nodes: [...nodes].sort() }));
    combinedAreas.push({ id: `combined:${JSON.stringify([tag, ...members.map(item => item.areaId)])}`,
      tag, areaIds: members.map(item => item.areaId), members, connections });
  }
  combinedAreas.sort((a, b) => a.tag.localeCompare(b.tag));
  await tick();
  return combinedAreas;
}

// Analyze direct-link components inside each legacy finding. Parent boundaries
// come from originalNodes (edge provenance), not a guessed overlap with reduced vertices.
async function buildAreaHierarchy(adjacency, planar, tick) {
  const parents = [];
  const originalAreas = [];
  const combinedAreas = [];
  for (const kind of ['safe', 'definite', 'hotspots', 'remainder']) {
    for (const [index, finding] of (planar[kind] ?? []).entries()) {
      await tick();
      const parentId = JSON.stringify([kind, [...finding.nodes].sort()]);
      const parentNodes = new Set((finding.originalNodes ?? finding.nodes).filter(node => !node.startsWith('#')));
      const local = new Map();
      let work = 0;
      for (const [node, neighbors] of adjacency) {
        if (++work % 200 === 0) await tick();
        if (!node.startsWith('#') && !parentNodes.has(node)) continue;
        const filtered = new Set([...neighbors].filter(other => other.startsWith('#') || parentNodes.has(other)));
        local.set(node, filtered);
      }
      const model = await buildAreaModel(local, tick, { scope: parentId, connected: true });
      for (const area of model.originalAreas) area.parentId = parentId;
      for (const combined of model.combinedAreas) {
        combined.parentIds = [parentId];
        combined.scope = 'within-parent';
      }
      const labels = { safe: '平面領域', definite: '非平面領域', remainder: 'ホットスポット外の未判定領域', hotspots: 'ホットスポット' };
      parents.push({ id: parentId, kind, labelIndex: index + 1, category: kind === 'remainder' ? getRemainderKind(finding) : kind, label: `${kind === 'remainder' ? REMAINDER_LABELS[getRemainderKind(finding)] : labels[kind]} ${index + 1}`, nodes: [...parentNodes].sort(),
        originalAreaIds: model.originalAreas.map(area => area.id),
        combinedAreaIds: model.combinedAreas.map(area => area.id) });
      originalAreas.push(...model.originalAreas);
      combinedAreas.push(...model.combinedAreas);
    }
  }
  const cross = await combineAreas(adjacency, originalAreas, tick, true);
  const lookup = new Map(originalAreas.map(area => [area.id, area]));
  for (const combined of cross) {
    combined.scope = 'cross-parent';
    combined.parentIds = [...new Set(combined.areaIds.map(id => lookup.get(id).parentId))];
  }
  combinedAreas.push(...cross);
  return { version: 2, graphBasis: 'within-legacy-parent', parents, originalAreas, combinedAreas };
}

// Rebuild selections from the current result, so an open graph cannot keep stale links.
function areaSelection(model, id) {
  const original = model.originalAreas.find(area => area.id === id);
  if (original) {
    const parent = model.parents?.find(parent => parent.id === original.parentId);
    return { ...original, title: parent ? `${parent.label}内の素領域` : '素領域', exact: true, groups: [original] };
  }
  const combined = model.combinedAreas.find(area => area.id === id);
  if (!combined) return null;
  const groups = combined.areaIds.map(areaId => model.originalAreas.find(area => area.id === areaId)).filter(Boolean);
  const nodes = [...new Set([combined.tag, ...groups.flatMap(area => area.nodes)])];
  const links = [...groups.flatMap(area => area.links),
    ...[...new Set(combined.members.flatMap(member => member.nodes))].map(node => [combined.tag, node])];
  const parents = (combined.parentIds ?? []).map(id => model.parents?.find(parent => parent.id === id)?.label).filter(Boolean);
  const label = combined.scope === 'cross-parent' ? '領域間接続' : '結合領域';
  return { id, title: `${label} ${combined.tag}${parents.length ? `（${parents.join('・')}）` : ''}`, nodes, links, groups, tag: combined.tag, exact: true };
}

module.exports = { buildAreaModel, buildAreaHierarchy, areaSelection };
