const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('hover menu has no click opener, bridges pointer movement, closes on exit and after action', () => {
  let pending = null;
  const context = { module: { exports: {} }, require: () => ({ setIcon() {} }),
    setTimeout: callback => { pending = callback; return callback; },
    clearTimeout: id => { if (pending === id) pending = null; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/hover-menu'), 'utf8'), context);
  class Element {
    constructor() { this.children = []; this.events = {}; this.attrs = {}; this.style = { setProperty(name, value) { this[name] = value; } }; this.classList = new Set(); this.classList.remove = value => this.classList.delete(value); this.classList.add = Set.prototype.add.bind(this.classList); }
    createEl(tag, options = {}) { const child = new Element(); child.tag = tag; child.options = options; child.parent = this; this.children.push(child); return child; }
    createDiv(options) { return this.createEl("div", options); } createSpan(options) { return this.createEl("span", options); }
    setAttr(key, value) { this.attrs[key] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    getBoundingClientRect() { return { left: 280, top: 20, bottom: 40, right: 300, width: 200, height: 100 }; }
    contains(element) { return this.children.includes(element); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { this.events.focus?.(); }
  }
  const row = new Element();
  const trigger = new Element();
  const body = new Element();
  trigger.ownerDocument = {
    body,
    defaultView: {
      innerWidth: 1000,
      innerHeight: 800,
      getComputedStyle: () => ({ getPropertyValue: () => "1.2" }),
    },
  };
  let invoked = 0;
  context.module.exports.attachHoverMenu(trigger, row, [{ title: '名前の変更', icon: 'pencil', action: () => { invoked++; } }], '対象.txt');
  assert.equal(trigger.events.click, undefined);
  trigger.events.mouseenter();
  assert.equal(body.children.length, 0);
  trigger.events.mouseleave();
  pending();
  assert.equal(body.children.length, 0);
  trigger.events.mouseenter();
  pending();
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].children[0].options.text, '対象.txt');
  assert.equal(row.children.length, 0);
  assert.equal(body.children[0].style["--pw-font-scale"], "1.2");
  assert.ok(row.classList.has('is-editing'));
  assert.equal(body.children[0].style.left, '306px');
  assert.equal(body.children[0].style.top, '20px');
  assert.equal(trigger.attrs['aria-expanded'], 'true');
  trigger.events.mouseleave();
  assert.ok(pending);
  body.children[0].events.mouseenter();
  assert.equal(pending, null);
  body.children[0].events.mouseleave({ relatedTarget: null });
  pending();
  assert.equal(body.children.length, 0);
  assert.equal(trigger.attrs['aria-expanded'], 'false');
  assert.equal(row.classList.has('is-editing'), false);
  trigger.events.mouseenter();
  pending();
  body.children[0].children[1].events.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(invoked, 1);
  assert.equal(body.children.length, 0);
  trigger.events.focus();
  assert.equal(body.children.length, 1);
  trigger.events.keydown({ target: trigger, key: 'Escape', preventDefault() {} });
  assert.equal(body.children.length, 0);
  trigger.events.mouseenter();
  context.module.exports.closeActiveHoverMenu();
  assert.equal(pending, null);
  trigger.events.focus();
  context.module.exports.closeActiveHoverMenu();
  assert.equal(body.children.length, 0);
});
