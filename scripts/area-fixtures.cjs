const { buildAdjacency, findNonPlanar } = require('../src/graph-analysis');

async function inspect({ name, tags, bridges = [], tagOnly = false }) {
  const files = Array.from({ length: tags.length * 5 }, (_, i) => ({ path: `group${Math.floor(i / 5)}/note${i % 5}.md` }));
  const resolvedLinks = {};
  for (const [i, file] of files.entries()) {
    resolvedLinks[file.path] = Object.fromEntries(tagOnly ? [] : files
      .filter((other, j) => i !== j && Math.floor(i / 5) === Math.floor(j / 5))
      .map(other => [other.path, 1]));
  }
  for (const [a, b] of bridges) resolvedLinks[files[a].path][files[b].path] = 1;
  const graph = buildAdjacency({
    vault: { getMarkdownFiles: () => files },
    metadataCache: { resolvedLinks,
      getFileCache: file => ({ tags: tags[Math.floor(files.indexOf(file) / 5)] }) },
  }, { isManaged: () => false, isManagedPath: () => false, getAllTags: cache => cache.tags });
  const result = await findNonPlanar(graph, async () => {});
  return { name, areas: ['safe', 'definite', 'suspect'].flatMap(kind => result[kind].map(area => ({
    kind, nodes: [...area.nodes].sort(),
  }))) };
}
const cases = [
  { name: 'before-tag', tags: [[], []] },
  { name: 'one-shared-tag', tags: [['#shared'], ['#shared']] },
  { name: 'two-shared-tags', tags: [['#x', '#y'], ['#x', '#y']] },
  { name: 'tag-and-direct-bridge', tags: [['#shared'], ['#shared']], bridges: [[0, 5]] },
  { name: 'tag-only', tags: [['#shared'], ['#shared']], tagOnly: true },
  { name: 'tag-chain', tags: [['#x'], ['#x', '#y'], ['#y']] },
];
if (require.main === module) {
  (async () => { for (const fixture of cases) console.log(JSON.stringify(await inspect(fixture))); })()
    .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { inspect, cases };
