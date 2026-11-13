const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { HIDE_CAPTURE_OVERLAYS_SCRIPT } = require('../src/web-thumbnail/web-capture-overlays');

test('capture hides large ad and modal layers while preserving page content and game canvas', () => {
  const element = ({ position = 'fixed', id = '', role, dialog = false, canvas = false, small = false } = {}) => ({
    id, className: '', properties: {},
    computed: { position, display: 'block', visibility: 'visible' },
    getAttribute: key => key === 'role' ? role : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: small ? 50 : 1280, bottom: small ? 50 : 900 }),
    querySelector: selector => selector.includes('canvas') ? canvas : dialog,
    style: { setProperty(key, value) { this.owner.properties[key] = value; } },
  });
  const elements = [element({ id: 'promotion-overlay' }), element({ role: 'dialog' }),
    element({ dialog: true }), element({ dialog: true, canvas: true }),
    element(), element({ position: 'static', id: 'advert-article' }), element({ id: 'popup', small: true })];
  for (const item of elements) item.style.owner = item;
  const count = vm.runInNewContext(HIDE_CAPTURE_OVERLAYS_SCRIPT, {
    window: { innerWidth: 1280, innerHeight: 900 },
    document: { querySelectorAll: () => elements }, getComputedStyle: item => item.computed,
  });
  assert.equal(count, 3);
  for (const item of elements.slice(0, 3)) assert.equal(item.properties.visibility, 'hidden');
  for (const item of elements.slice(3)) assert.deepEqual(item.properties, {});
});
