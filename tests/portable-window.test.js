const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attachDrag, detachDrag, constrain, applyAppearance, createFrame, createWindow, createWindowStack } = require('../src/portable-window');
class Events {
  constructor() { this.handlers = new Map(); }
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of [...(this.handlers.get(name) ?? [])]) fn(event); }
  count(name) { return this.handlers.get(name)?.size ?? 0; }
}
function fixture() {
  const viewport = Object.assign(new Events(), { innerWidth: 800, innerHeight: 600 });
  const doc = Object.assign(new Events(), { defaultView: viewport });
  const handle = new Events();
  const element = { ownerDocument: doc, style: { left: '100px', top: '100px' }, getBoundingClientRect() {
    return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: 200, height: 150 };
  } };
  const down = { button: 0, clientX: 110, clientY: 110, target: { closest: () => null }, preventDefault() {} };
  return { viewport, doc, handle, element, down };
}
test('portable drag clamps to viewport, saves once, and removes document listeners', () => {
  const f = fixture(), positions = [];
  attachDrag(f.element, f.handle, { onPosition: p => positions.push(p) });
  f.handle.emit('mousedown', f.down);
  f.doc.emit('mousemove', { clientX: 1000, clientY: -20 });
  assert.equal(f.element.style.left, '600px');
  assert.equal(f.element.style.top, '0px');
  f.doc.emit('mouseup');
  assert.deepEqual(positions, [{ x: 600, y: 0 }]);
  assert.equal(f.doc.count('mousemove'), 0);
  assert.equal(f.viewport.count('blur'), 0);
});
test('rebinding and disposal cancel active drag without persisting stale position', () => {
  const f = fixture();
  const save = () => { throw new Error('cancelled drag saved'); };
  attachDrag(f.element, f.handle, { onPosition: save });
  f.handle.emit('mousedown', f.down);
  attachDrag(f.element, f.handle, { onPosition: save });
  assert.equal(f.doc.count('mouseup'), 0);
  assert.equal(f.handle.count('mousedown'), 1);
  detachDrag(f.element);
  assert.equal(f.handle.count('mousedown'), 0);
});
test('header controls and non-primary buttons do not drag; viewport shrink corrects position', () => {
  const f = fixture();
  attachDrag(f.element, f.handle);
  f.handle.emit('mousedown', { ...f.down, target: { closest: () => ({}) } });
  f.handle.emit('mousedown', { ...f.down, button: 2 });
  assert.equal(f.doc.count('mousemove'), 0);
  f.viewport.innerWidth = 150;
  assert.deepEqual(constrain(f.element), { x: 0, y: 100 });
});

// 標準DOM相当の最小fixture。ObsidianのcreateDivなどがなくても生成できることを確認。
function documentFixture() {
  const { viewport, doc } = fixture();
  let disconnected = false;
  viewport.ResizeObserver = class {
    observe() {}
    disconnect() { disconnected = true; }
  };
  doc.createElement = tag => Object.assign(new Events(), {
    tagName: tag, ownerDocument: doc, style: {}, children: [], attributes: {}, hidden: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    append(...children) { children.forEach(child => this.appendChild(child)); },
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
    getBoundingClientRect() { return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: 200, height: 150 }; },
  });
  doc.body = doc.createElement('body');
  return { doc, viewport, disconnected: () => disconnected };
}

test('shared frame accepts host CSS and preserves existing children without Obsidian APIs', () => {
  const { doc } = documentFixture();
  const root = doc.createElement('section'), existing = doc.createElement('aside');
  root.appendChild(existing);
  const frame = createFrame(root, { headClass: 'alp-detail-head', bodyClass: 'alp-detail-body' });
  assert.deepEqual(root.children, [existing, frame.head, frame.body]);
  assert.equal(frame.head.className, 'alp-detail-head');
  assert.equal(frame.body.className, 'alp-detail-body');
  assert.equal(frame.head.tagName, 'header');
});

test('standalone shell reuses frame, retains body while hidden and cleans up after reopening', () => {
  const f = documentFixture();
  let closed = 0;
  const panel = createWindow({ mount: f.doc.body, title: 'Example', closeLabel: '閉じる', onClose: () => closed++ });
  assert.equal(panel.head.children.at(-1).attributes['aria-label'], '閉じる');
  assert.equal(panel.head.className, 'pw-head');
  assert.equal(panel.body.className, 'pw-body');
  const content = f.doc.createElement('input');
  panel.body.appendChild(content);
  panel.head.children.at(-1).emit('click');
  assert.equal(panel.element.hidden, true);
  assert.equal(closed, 1);
  assert.equal(panel.head.count('mousedown'), 0);
  panel.show();
  panel.show();
  assert.equal(panel.element.hidden, false);
  assert.equal(panel.head.count('mousedown'), 1);
  assert.equal(panel.body.children[0], content);
  panel.destroy();
  assert.equal(f.doc.body.children.length, 0);
  assert.equal(f.viewport.count('resize'), 0);
  assert.equal(panel.head.count('mousedown'), 0);
  assert.equal(f.disconnected(), true);
  assert.equal(closed, 1);
});

test('appearance updates overwrite old settings and returning to defaults releases height override', () => {
  const values = new Map();
  const element = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } };
  applyAppearance(element, { fontScale: 120, maxHeightPercent: 70, widthPx: 480 });
  assert.equal(values.get('--pw-font-scale'), '1.2');
  assert.equal(values.get('--pw-max-height'), '70vh');
  assert.equal(values.get('--pw-width'), '480px');
  applyAppearance(element);
  assert.equal(values.get('--pw-font-scale'), '1');
  assert.equal(values.has('--pw-max-height'), false);
  assert.equal(values.has('--pw-width'), false);
  applyAppearance(element, { fontScale: NaN, maxHeightPercent: Infinity });
  assert.equal(values.get('--pw-font-scale'), '1');
  assert.equal(values.has('--pw-max-height'), false);
});

test('minimum height can be changed or disabled independently from the upper height limit', () => {
  const values = new Map();
  const element = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } };
  applyAppearance(element, { minHeightPx: 280, maxHeightPercent: 70 });
  assert.equal(values.get('--pw-min-height'), '280px');
  assert.equal(values.get('--pw-max-height'), '70vh');
  applyAppearance(element, { minHeightPx: 0, maxHeightPercent: 70 });
  assert.equal(values.get('--pw-min-height'), '0px');
  assert.equal(values.get('--pw-max-height'), '70vh');
  applyAppearance(element);
  assert.equal(values.has('--pw-min-height'), false);
});

test('minimum width supports zero and reset without changing the upper width setting', () => {
  const values = new Map();
  const element = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } };
  applyAppearance(element, { minWidthPx: 280, widthPx: 480 });
  assert.equal(values.get('--pw-min-width'), '280px');
  assert.equal(values.get('--pw-width'), '480px');
  applyAppearance(element, { minWidthPx: 0, widthPx: 480 });
  assert.equal(values.get('--pw-min-width'), '0px');
  assert.equal(values.get('--pw-width'), '480px');
  applyAppearance(element);
  assert.equal(values.has('--pw-min-width'), false);
});

test('window stack raises clicked or focused windows without growing z-indices and cleans up', () => {
  const stack = createWindowStack();
  const windows = Array.from({ length: 3 }, () => Object.assign(new Events(), { style: { zIndex: '' } }));
  const controls = windows.map(element => stack.register(element));
  const indices = () => windows.map(element => Number(element.style.zIndex));
  assert.deepEqual(indices(), [40, 41, 42]);
  windows[0].emit('pointerdown');
  assert.deepEqual(indices(), [42, 40, 41]);
  windows[1].emit('focusin');
  assert.deepEqual(indices(), [41, 42, 40]);
  for (let i = 0; i < 1000; i++) windows[i % 3].emit('pointerdown');
  assert.equal(Math.max(...indices()), 42);
  assert.equal(stack.register(windows[0]), controls[0]);
  controls[0].dispose();
  assert.equal(windows[0].count('pointerdown'), 0);
  assert.equal(windows[0].count('focusin'), 0);
  assert.equal(windows[0].style.zIndex, '');
  controls[0].dispose();
  assert.equal(Math.max(...indices()), 41);
});
