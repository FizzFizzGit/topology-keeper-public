// Structural evidence only: never infer a tag's role from its name or note text.
const TAG_ROLE_CONFIG = {
  minNotes: 3, minOtherTagCoverage: 0.5, weakScoreThreshold: 0.3,
  relationshipWeight: 0.75, concentrationWeight: 0.25, minEdgeWeight: 0.2,
};
async function assessTagRoles(adjacency, tick) {
  const noteTags = new Map();
  const tagNotes = new Map();
  let work = 0;
  const check = async () => { if (++work % 200 === 0) await tick(); };
  await tick();
  for (const [node, neighbors] of adjacency) {
    if (node.startsWith('#')) {
      const notes = new Set();
      for (const other of neighbors) { await check(); if (!other.startsWith('#')) notes.add(other); }
      tagNotes.set(node, notes);
    } else {
      noteTags.set(node, new Set([...neighbors].filter(other => other.startsWith('#'))));
    }
  }
  // Direct-link components are independent of every tag, including the candidate.
  const component = new Map();
  for (const node of noteTags.keys()) {
    if (component.has(node)) continue;
    const queue = [node];
    component.set(node, node);
    for (let i = 0; i < queue.length; i++) for (const other of adjacency.get(queue[i]) ?? []) {
      await check();
      if (!other.startsWith('#') && !component.has(other)) {
        component.set(other, node); queue.push(other);
      }
    }
  }
  const roles = new Map();
  for (const [tag, notes] of tagNotes) {
    await tick();
    const counts = new Map();
    const components = new Map();
    let directedLinks = 0;
    let otherTagNotes = 0;
    for (const node of notes) {
      const id = component.get(node);
      components.set(id, (components.get(id) ?? 0) + 1);
      let hasSpecificOtherTag = false;
      for (const other of noteTags.get(node) ?? []) {
        await check();
        if (other === tag) continue; // Avoid circular evidence from the candidate.
        const frequency = tagNotes.get(other)?.size ?? 0;
        const weight = frequency ? Math.log(noteTags.size / frequency) : 0;
        if (weight <= 0) continue; // Ubiquitous co-tags provide no discrimination.
        hasSpecificOtherTag = true;
        counts.set(other, (counts.get(other) ?? 0) + 1);
      }
      if (hasSpecificOtherTag) otherTagNotes++;
      for (const other of adjacency.get(node) ?? []) { await check(); if (notes.has(other)) directedLinks++; }
    }
    const count = notes.size;
    const pairs = count * (count - 1) / 2;
    let intersection = 0, union = 0;
    for (const [other, frequency] of counts) {
      await check();
      const weight = Math.log(noteTags.size / tagNotes.get(other).size);
      const sharedPairs = frequency * (frequency - 1) / 2;
      intersection += weight * sharedPairs;
      union += weight * (frequency * (count - 1) - sharedPairs);
    }
    const coTagSimilarity = union ? intersection / union : 0;
    const directDensity = pairs ? directedLinks / 2 / pairs : 0;
    let largest = 0;
    for (const value of components.values()) largest = Math.max(largest, value);
    const concentration = count > 1 ? (largest - 1) / (count - 1) : 0;
    const coverage = count ? otherTagNotes / count : 0;
    const sufficient = count >= TAG_ROLE_CONFIG.minNotes && (coverage >= TAG_ROLE_CONFIG.minOtherTagCoverage || directedLinks > 0);
    const score = sufficient ? TAG_ROLE_CONFIG.relationshipWeight * Math.max(coTagSimilarity, directDensity)
      + TAG_ROLE_CONFIG.concentrationWeight * concentration : null;
    const role = !sufficient ? 'insufficient' : score < TAG_ROLE_CONFIG.weakScoreThreshold ? 'cross-cutting' : 'cohesive';
    roles.set(tag, { tag, role, score, weight: role === 'cross-cutting'
      ? TAG_ROLE_CONFIG.minEdgeWeight + (1 - TAG_ROLE_CONFIG.minEdgeWeight) * score : 1,
      noteCount: count, coTagSimilarity, directDensity, concentration,
      componentCount: components.size, otherTagCoverage: coverage });
  }
  await tick();
  return roles;
}

module.exports = { assessTagRoles, TAG_ROLE_CONFIG };
