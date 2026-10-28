// One bounded corpus per plugin instance. No raw note bodies or disk persistence.
class TagSuggestionCache {
  constructor({ maxDocs = 1000, maxBytes = 32 * 1024 * 1024 } = {}) {
    this.maxDocs = maxDocs;
    this.maxBytes = maxBytes;
    this.revision = 0;
    this.entry = null;
    this.disposed = false;
  }
  invalidate() { this.revision++; this.entry = null; this.estimatedBytes = 0; }
  dispose() { this.invalidate(); this.disposed = true; }
  snapshot(app, files) {
    if (this.disposed || files.length > this.maxDocs || files.some(file =>
      !Number.isFinite(file.stat?.mtime) || !Number.isFinite(file.stat?.size))) { this.entry = null; return null; }
    const key = JSON.stringify(files.map(file => [file.path, file.stat.mtime, file.stat.size,
      app.metadataCache.getFileCache(file)]));
    if (key.length * 2 > this.maxBytes) { this.entry = null; return null; }
    return { key, revision: this.revision };
  }
  get(snapshot) {
    if (!snapshot || snapshot.revision !== this.revision || this.entry?.key !== snapshot.key) return null;
    return this.entry.value;
  }
  set(snapshot, value) {
    if (!snapshot || this.disposed || snapshot.revision !== this.revision) return;
    // A conservative serialized-size budget, not a precise JS heap limit.
    const serialized = JSON.stringify([...value.docs.values()], (key, item) => {
      if (key === 'file') return { path: item.path };
      if (Object.prototype.toString.call(item) === '[object Map]') return [...item];
      if (Object.prototype.toString.call(item) === '[object Set]') return [...item];
      return item;
    });
    const indexSize = JSON.stringify([...value.index.vectors], (key, item) => Object.prototype.toString.call(item) === '[object Map]' ? [...item] : item).length;
    this.estimatedBytes = snapshot.key.length * 2 + (serialized.length + indexSize) * 8;
    if (this.estimatedBytes > this.maxBytes) { this.entry = null; return; }
    this.entry = { key: snapshot.key, value };
  }
}
module.exports = { TagSuggestionCache };
