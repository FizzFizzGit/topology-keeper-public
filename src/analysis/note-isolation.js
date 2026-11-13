const { readNoteMetadata, propertyLinkTargets } = require('../shared/note-metadata');
// Read-only ordinary-note analysis, separate from generated-file cleanup.
function findIsolatedNotes(app, { isManaged, getAllTags, allowedFolder = '', linksProperty = 'links' }) {
  const { files, caches, ready } = readNoteMetadata(app, file => !isManaged(file));
  const byPath = new Map(files.map(file => [file.path, file]));
  if (!ready) return { isolated: [], tagOnly: [], allowed: [], ready: false };
  const linked = new Set();
  const connect = (source, target) => {
    if (source !== target && byPath.has(source) && byPath.has(target)) {
      linked.add(source); linked.add(target);
    }
  };
  for (const [source, destinations] of Object.entries(app.metadataCache.resolvedLinks ?? {})) {
    for (const [target, count] of Object.entries(destinations)) if (count > 0) connect(source, target);
  }
  const tagsByPath = new Map();
  const tagCounts = new Map();
  for (const file of files) {
    const cache = caches.get(file.path);
    for (const target of propertyLinkTargets(app, file, cache, linksProperty)) connect(file.path, target.path);
    const tags = new Set(getAllTags(cache) ?? []);
    tagsByPath.set(file.path, tags);
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const result = { isolated: [], tagOnly: [], allowed: [], ready: true };
  for (const file of files) {
    if (linked.has(file.path)) continue;
    if (allowedFolder && file.path.startsWith(allowedFolder + '/')) result.allowed.push(file);
    else if ([...tagsByPath.get(file.path)].some(tag => tagCounts.get(tag) > 1)) result.tagOnly.push(file);
    else result.isolated.push(file);
  }
  for (const key of ['isolated', 'tagOnly', 'allowed']) result[key].sort((a, b) => a.path.localeCompare(b.path));
  return result;
}
module.exports = { findIsolatedNotes };
