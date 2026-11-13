const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pageUrl, captureWebPage, hasPageContent } = require('../src/web-thumbnail/web-page-capture');
const { thumbnailMarkdown, WebThumbnailWorkflow } = require('../src/web-thumbnail/web-thumbnail-workflow');
const { createTranslator } = require('../src/i18n/i18n-core');
const fs = require('node:fs');
const vm = require('node:vm');

test('web URLs accept selected links and reject local, executable and credential-bearing URLs', () => {
  for (const value of ['https://example.com/a', '<https://example.com/a>', '[Example](https://example.com/a)', '[Example](<https://example.com/a>)'])
    assert.equal(pageUrl(value), 'https://example.com/a');
  for (const value of ['file:///C:/private.txt', 'javascript:alert(1)', 'data:text/html,hi', 'https://name:secret@example.com', 'not a URL'])
    assert.throws(() => pageUrl(value));
  assert.equal(thumbnailMarkdown('Notes/日本語.md', '_thumbs/web-1.png', 'https://example.com/a', 'A [title]'),
    '> [![A \\[title\\]](<web-1.png>)](<https://example.com/a>)');
});

function browserFixture({ neverLoad = false, captureFails = false, blankFrames = 0 } = {}) {
  let instance;
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); instance = this; this.options = options;
      const session = new EventEmitter();
      session.setPermissionRequestHandler = handler => { this.requestPermission = handler; };
      session.setPermissionCheckHandler = handler => { this.checkPermission = handler; };
      this.webContents = Object.assign(new EventEmitter(), {
        session, setAudioMuted: value => { this.muted = value; },
        setWindowOpenHandler: handler => { this.openHandler = handler; },
        getTitle: () => 'Example page',
        executeJavaScript: async script => { this.readyScript = script; },
        capturePage: async (rect, options) => {
          this.captureCount = (this.captureCount ?? 0) + 1;
          this.captureRect = rect;
          this.captureOptions = options;
          if (captureFails) throw new Error('capture-failed');
          const blank = this.captureCount <= blankFrames;
          return { isEmpty: () => false, getSize: () => ({ width: 1280, height: 900 }),
            toBitmap: () => Buffer.from(blank ? [255, 255, 255, 255, 255, 255, 255, 255] : [255, 255, 255, 255, 0, 0, 0, 255]),
            resize: ({ width }) => {
            this.outputWidth = width;
            return { toPNG: () => Buffer.from([1, 2, 3]) };
          } };
        },
      });
    }
    async loadURL(url) { this.loaded = url; if (neverLoad) await new Promise(() => {}); }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  return { BrowserWindow, instance: () => instance };
}

test('capture uses isolated hidden browser, shrinks screenshot and destroys it after success', async () => {
  const f = browserFixture();
  const result = await captureWebPage('https://example.com', { BrowserWindow: f.BrowserWindow, settleMs: 0 });
  const win = f.instance();
  assert.equal(win.options.show, false);
  assert.equal(win.options.width, 1280);
  assert.equal(win.options.height, 900);
  assert.equal(win.options.minWidth, undefined);
  assert.equal(win.options.minHeight, undefined);
  assert.equal(win.options.webPreferences.offscreen, true);
  assert.ok(win.readyScript.includes('document.fonts'));
  assert.ok(win.readyScript.includes('document.images'));
  assert.deepEqual(win.captureRect, { x: 0, y: 0, width: 1280, height: 900 });
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.ok(!win.options.webPreferences.partition.startsWith('persist:'));
  assert.deepEqual(win.openHandler(), { action: 'deny' });
  assert.equal(win.checkPermission(), false);
  let permission;
  win.requestPermission(null, 'camera', value => { permission = value; });
  assert.equal(permission, false);
  let prevented = false;
  win.webContents.emit('will-redirect', { preventDefault() { prevented = true; } }, 'file:///private');
  assert.equal(prevented, true);
  assert.equal(win.captureOptions.stayHidden, true);
  assert.equal(win.outputWidth, 256);
  assert.equal(win.destroyed, true);
  assert.equal(result.title, 'Example page');
});

test('capture retries blank frames and rejects consistently blank output instead of saving it', async () => {
  const retry = browserFixture({ blankFrames: 1 });
  await captureWebPage('https://example.com', { BrowserWindow: retry.BrowserWindow, settleMs: 0 });
  assert.equal(retry.instance().captureCount, 2);
  const blank = browserFixture({ blankFrames: 3 });
  await assert.rejects(captureWebPage('https://example.com', { BrowserWindow: blank.BrowserWindow, settleMs: 0 }), /capture-blank/);
  assert.equal(blank.instance().captureCount, 3);
  assert.equal(blank.instance().destroyed, true);
});

test('empty, partial-size, white, black and transparent frames are not considered usable screenshots', () => {
  const image = bitmap => ({ isEmpty: () => false, getSize: () => ({ width: 1920, height: 1080 }), toBitmap: () => Buffer.from(bitmap) });
  assert.equal(hasPageContent(image([255, 255, 255, 255, 255, 255, 255, 255])), false);
  assert.equal(hasPageContent(image([0, 0, 0, 255, 0, 0, 0, 255])), false);
  assert.equal(hasPageContent(image([1, 2, 3, 0, 4, 5, 6, 0])), false);
  assert.equal(hasPageContent(image([255, 255, 255, 255, 0, 0, 0, 255])), true);
  assert.equal(hasPageContent({ isEmpty: () => true }), false);
  assert.equal(hasPageContent({ ...image([]), getSize: () => ({ width: 10, height: 10 }) }), false);
  assert.equal(hasPageContent({ ...image([255, 255, 255, 255, 0, 0, 0, 255]), getSize: () => ({ width: 640, height: 450 }) }), false);
});

test('capture releases browser on timeout, cancellation and capture error', async () => {
  const timeout = browserFixture({ neverLoad: true });
  await assert.rejects(captureWebPage('https://example.com', { BrowserWindow: timeout.BrowserWindow, timeoutMs: 10 }), /capture-timeout/);
  assert.equal(timeout.instance().destroyed, true);
  const cancelled = browserFixture({ neverLoad: true }), controller = new AbortController();
  const pending = captureWebPage('https://example.com', { BrowserWindow: cancelled.BrowserWindow, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /capture-cancelled/);
  assert.equal(cancelled.instance().destroyed, true);
  const error = browserFixture({ captureFails: true });
  await assert.rejects(captureWebPage('https://example.com', { BrowserWindow: error.BrowserWindow, settleMs: 0 }), /capture-failed/);
  assert.equal(error.instance().destroyed, true);
});

function workflowFixture({ confirm = true, changeDuringSave = false, language = 'en', width = 256, showTitle = true, typedUrl } = {}) {
  const file = { path: 'Notes/source.md', extension: 'md' }, messages = [], files = new Map([[file.path, file]]);
  let content = 'Before https://example.com After', inserted, deleted = 0, captures = 0, saved = 0, closes = 0, captureOptions;
  const editor = {
    getSelection: () => 'https://example.com', getCursor: which => ({ line: 0, ch: which === 'to' ? 26 : 7 }),
    getValue: () => content, replaceRange(value, from, to) { inserted = { value, from, to }; },
  };
  const view = { file };
  const plugin = { saveData: async () => {}, state: { folders: { thumb: '_thumbs' } }, app: { vault: {
    getAbstractFileByPath: name => files.get(name),
    getFiles: () => [...files.values()],
    createFolder: async name => { files.set(name, {}); },
    createBinary: async name => {
      saved++; const image = { path: name }; files.set(name, image);
      if (changeDuringSave) content += ' edited';
      return image;
    },
    delete: async image => { deleted++; files.delete(image.path); },
  } } };
  let cancel;
  const workflow = new WebThumbnailWorkflow(plugin, {
    decorate: async png => png,
    t: createTranslator(language), notice: message => messages.push(message), getBrowserWindow: () => function () {},
    capture: async (_url, options) => { captures++; captureOptions = options; return { png: Buffer.from([1, 2, 3]), title: 'Example', url: 'https://example.com/' }; },
    createModal: (_url, abort) => {
      cancel = abort;
      return { configure: async () => ({ width, showTitle, ...(typedUrl ? { url: typedUrl } : {}) }), open() {}, confirm: async () => { if (!confirm) abort(); return confirm; }, close() { closes++; } };
    },
  });
  return { workflow, plugin, editor, view, messages, files, setContent: value => { content = value; }, cancel: () => cancel?.(),
    state: () => ({ inserted, deleted, captures, saved, closes, captureOptions }) };
}

test('confirmed capture saves one PNG and replaces only the original selection with a clickable image', async () => {
  const f = workflowFixture();
  await f.workflow.run(f.editor, f.view);
  const result = f.state();
  assert.equal(result.saved, 1);
  assert.match(result.inserted.value.trim(), /^> \[!\[Example\]\(<[\w-]+\.png>\)\]\(<https:\/\/example.com\/>\)$/);
  assert.equal(result.inserted.from.ch, 7);
  assert.equal(result.inserted.to.ch, 26);
  assert.equal(result.deleted, 0);
  assert.equal(f.workflow.controller, null);
});

test('URL insertion preserves frontmatter when cursor is before or inside properties, including EOF', async () => {
  for (const content of ['---\ntags: [sample]\n---\nBody', '---\r\ntags: [sample]\r\n---']) {
    const f = workflowFixture({ typedUrl: 'https://example.com' });
    f.setContent(content);
    f.editor.getSelection = () => '';
    f.editor.getCursor = () => ({ line: 0, ch: 0 });
    await f.workflow.run(f.editor, f.view, { promptUrl: true });
    const { inserted } = f.state();
    const lines = content.split('\n');
    assert.ok(inserted.from.line >= 2);
    assert.deepEqual(inserted.from, inserted.to);
    const prefix = lines.slice(0, inserted.from.line).join('\n')
      + (inserted.from.line ? '\n' : '') + lines[inserted.from.line].slice(0, inserted.from.ch);
    assert.ok((prefix + inserted.value).startsWith(content.split('Body')[0]));
  }
});

test('preview cancellation does not create files or modify the editor', async () => {
  const f = workflowFixture({ confirm: false });
  await f.workflow.run(f.editor, f.view);
  assert.equal(f.state().saved, 0);
  assert.equal(f.state().inserted, undefined);
});

test('changes while saving cancel insertion and clean up only the newly created image', async () => {
  const f = workflowFixture({ changeDuringSave: true });
  await f.workflow.run(f.editor, f.view);
  assert.equal(f.state().inserted, undefined);
  assert.equal(f.state().deleted, 1);
  assert.ok(f.files.has('Notes/source.md'));
  assert.ok(f.messages.some(message => message.includes('source note changed')));
});

test('changed note during capture prevents saving; unload aborts pending capture', async () => {
  const f = workflowFixture();
  let finish;
  f.workflow.capture = () => new Promise(resolve => { finish = resolve; });
  const pending = f.workflow.run(f.editor, f.view);
  await Promise.resolve();
  f.setContent('changed');
  finish({ png: Buffer.from([1]), title: 'Example' });
  await pending;
  assert.equal(f.state().saved, 0);
  const g = workflowFixture();
  g.workflow.capture = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('capture-cancelled'))));
  const unloading = g.workflow.run(g.editor, g.view);
  g.workflow.dispose();
  await unloading;
  assert.equal(g.state().saved, 0);
  assert.equal(g.workflow.controller, null);
});

test('preview has translated controls, shows a local image and releases its object URL on confirmation', async () => {
  for (const language of ['ja', 'en']) {
    const t = createTranslator(language), revoked = [];
    class Element {
      constructor(options = {}) { this.options = options; this.children = []; this.events = {}; }
      createEl(tag, options) { const child = new Element({ ...options, tag }); this.children.push(child); return child; }
      createDiv(options) { return this.createEl('div', options); }
      createSpan(options) { return this.createEl('span', options); }
      addEventListener(name, callback) { this.events[name] = callback; }
      empty() { this.children = []; }
    }
    class Modal {
      constructor() { this.contentEl = new Element(); }
      setTitle(title) { this.title = title; }
      open() { this.onOpen(); }
      close() { this.onClose(); }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/web-thumbnail/web-thumbnail-modal'), 'utf8'), {
      module, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL: value => revoked.push(value) },
      require: name => name === 'obsidian' ? { Modal } : name.endsWith('/i18n') ? { t } : require('node:module').createRequire(require.resolve('../src/web-thumbnail/web-thumbnail-modal'))(name),
    });
    let aborted = false;
    const modal = new module.exports.WebThumbnailModal({}, 'https://example.com', () => { aborted = true; });
    const configured = modal.configure();
    assert.equal(modal.title, t('webThumbnail.title'));
    const nodes = element => [element, ...element.children.flatMap(nodes)];
    const width = nodes(modal.contentEl).find(node => node.options.attr?.type === 'number');
    const url = nodes(modal.contentEl).find(node => node.options.attr?.inputmode === 'url');
    assert.equal(url.value, 'https://example.com');
    url.value = 'https://changed.example/page';
    assert.equal(width.value, '256');
    width.value = '128';
    nodes(modal.contentEl).find(node => node.options.text === t('webThumbnail.capture')).events.click();
    const options = await configured;
    assert.equal(options.width, 128);
    assert.equal(options.url, 'https://changed.example/page');
    const pending = modal.confirm({ png: Buffer.from([1]), title: 'Example', url: 'https://example.com' });
    assert.equal(nodes(modal.contentEl).find(node => node.options.tag === 'img').options.attr.src, 'blob:test');
    nodes(modal.contentEl).find(node => node.options.text === t('webThumbnail.insert')).events.click();
    assert.equal(await pending, true);
    assert.equal(aborted, false);
    assert.deepEqual(revoked, ['blob:test']);
  }
});

test('chosen width reaches capture, is recorded for cleanup and can omit the title', async () => {
  const f = workflowFixture({ width: 128, showTitle: false });
  await f.workflow.run(f.editor, f.view);
  assert.equal(f.state().captureOptions.thumbnailWidth, 128);
  assert.ok(f.state().inserted.value.trim().startsWith('> [![Example]'));
  assert.equal(f.state().inserted.value.includes('../'), false);
  assert.equal(f.state().inserted.value.includes('web-'), false);
  const { loadSettings } = require('../src/settings/plugin-settings');
  const restored = loadSettings(JSON.parse(JSON.stringify(f.plugin.state)));
  assert.deepEqual(Object.values(restored.webThumbnailFiles), [128]);
});

test('UUID image styling respects the recorded custom width and does not claim unrelated UUIDs', () => {
  const { styleWebThumbnails, normalizeWebThumbnailFiles } = require('../src/web-thumbnail/web-thumbnail-data');
  const name = '12345678-1234-4123-8123-123456789abc.png';
  const known = { getAttribute: () => `app://vault/_thumbs/${name}`, style: {} };
  const unknown = { getAttribute: () => 'app://vault/12345678-1234-4123-8123-123456789abd.png', style: {} };
  const records = normalizeWebThumbnailFiles({ [`_thumbs/${name}`]: 96, '../unsafe.png': 256 });
  styleWebThumbnails({ querySelectorAll: () => [known, unknown] }, records);
  assert.equal(known.style.maxWidth, 'min(100%, 96px)');
  assert.deepEqual(unknown.style, {});
  assert.equal(Object.keys(records).length, 1);
});

test('button flow accepts a typed URL without a selection and inserts at the saved cursor', async () => {
  const f = workflowFixture({ typedUrl: 'https://typed.example/page' });
  f.editor.getSelection = () => '';
  await f.workflow.run(f.editor, f.view, { promptUrl: true });
  const result = f.state();
  assert.equal(result.saved, 1);
  assert.equal(result.inserted.from.ch, 7);
  assert.equal(result.inserted.to.ch, 7);
  assert.ok(result.inserted.value.includes('https://typed.example/page'));
});
