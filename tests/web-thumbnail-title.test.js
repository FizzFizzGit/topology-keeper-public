const { test } = require('node:test');
const assert = require('node:assert/strict');
const { titleLines, addThumbnailTitle } = require('../src/web-thumbnail/web-thumbnail-title');

test('title wraps and ellipsizes within its available width without splitting emoji', () => {
  const context = { measureText: text => ({ width: Array.from(text).length * 8 }) };
  const lines = titleLines(context, 'あいうえおかきくけこさしすせそ', 48);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  assert.ok(lines.every(line => context.measureText(line).width <= 48));
  assert.deepEqual(titleLines(context, '😀😀😀', 16, 2), ['😀😀', '😀']);
});

test('title overlay is part of saved PNG, keeps original size and releases bitmap', async () => {
  const operations = [];
  let closed = false, dimensions;
  const context = {
    measureText: text => ({ width: Array.from(text).length * 8 }),
    drawImage: (...args) => operations.push(['image', ...args]),
    fillRect: (...args) => operations.push(['band', ...args]),
    strokeRect: (...args) => operations.push(['border', ...args]),
    fillText: (...args) => operations.push(['text', ...args]),
  };
  const runtime = {
    createImageBitmap: async () => ({ width: 256, height: 180, close() { closed = true; } }),
    OffscreenCanvas: class {
      constructor(width, height) { dimensions = [width, height]; }
      getContext() { return context; }
      async convertToBlob() { return new Blob([new Uint8Array([7, 8])], { type: 'image/png' }); }
    },
  };
  const result = await addThumbnailTitle(new Uint8Array([1]), 'ページのタイトル', {}, runtime);
  assert.deepEqual(dimensions, [256, 180]);
  assert.equal(operations[0][0], 'image');
  const band = operations.find(operation => operation[0] === 'band');
  assert.equal(band[1], 0);
  assert.ok(band[2] > 0);
  assert.equal(band[3], 256);
  assert.equal(band[2] + band[4], 180);
  assert.ok(operations.some(operation => operation[0] === 'text'));
  assert.deepEqual([...result], [7, 8]);
  assert.equal(closed, true);
});

test('disabled title returns original image without decoding or generating another PNG', async () => {
  const png = new Uint8Array([1, 2]);
  assert.equal(await addThumbnailTitle(png, 'Title', { showTitle: false }, {}), png);
});
