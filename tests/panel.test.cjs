"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), P = require("../panel.js");
function setup() {
  const events = {}, handles = {}, doc = { addEventListener(type, fn) { events[type] = fn; } };
  const win = { innerWidth: 1400, innerHeight: 900, addEventListener() {} };
  let moved = 0;
  const panel = { style: {}, ownerDocument: doc, setAttribute() {}, removeAttribute() {}, getBoundingClientRect() { return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; } };
  const handle = { addEventListener(type, fn) { handles[type] = fn; }, setPointerCapture() {}, releasePointerCapture() {} };
  const controller = P.create({ panel, handle, window: win, onMove() { moved++; } });
  const pointer = (x, y, extra = {}) => ({ pointerId: 1, button: 0, clientX: x, clientY: y, preventDefault() {}, target: { closest: () => null }, ...extra });
  return { controller, panel, win, events, handles, pointer, get moved() { return moved; } };
}
test("directory, small note and wide note share the same default dock and top", () => {
  const h = setup();
  for (const width of [400, 560, 860, 400]) {
    const box = h.controller.place({ width, height: 846 });
    assert.equal(box.top, 64); assert.equal(1400 - box.left - box.width, 20); assert.equal(box.top + box.height, 884);
  }
});
test("dragging moves content, persists across modes and stays within the viewport", () => {
  const h = setup(), before = h.controller.place({ width: 560, height: 600 });
  h.handles.pointerdown(h.pointer(900, 80)); h.events.pointermove(h.pointer(740, 56)); h.events.pointerup(h.pointer(740, 56));
  assert.equal(h.panel.getBoundingClientRect().left, before.left - 160); assert.equal(h.panel.getBoundingClientRect().top, 40); assert.equal(h.moved, 1);
  const directory = h.controller.place({ width: 400, height: 600 });
  assert.equal(directory.left + directory.width, before.left + before.width - 160); assert.equal(directory.top, 40);
  h.handles.pointerdown(h.pointer(740, 56)); h.events.pointermove(h.pointer(-9000, -9000)); h.events.pointercancel(h.pointer(0, 0));
  assert.equal(h.panel.getBoundingClientRect().left, 12); assert.equal(h.panel.getBoundingClientRect().top, 16); assert.equal(h.controller.dragging, false);
  h.win.innerWidth = 390; h.win.innerHeight = 640;
  const phone = h.controller.place({ width: 860, height: 846 }); assert.equal(phone.width, 366); assert.ok(phone.left + phone.width <= 378); assert.ok(phone.top + phone.height <= 624);
});
test("title buttons and secondary pointers cannot start or take over a drag", () => {
  const h = setup(); h.controller.place({ width: 560, height: 600 });
  h.handles.pointerdown(h.pointer(0, 0, { target: { closest: () => ({}) } })); assert.equal(h.controller.dragging, false);
  h.handles.pointerdown(h.pointer(0, 0)); const before = h.panel.style.left;
  h.events.pointermove(h.pointer(100, 100, { pointerId: 2 })); assert.equal(h.panel.style.left, before);
  h.events.pointercancel(h.pointer(0, 0)); assert.equal(h.controller.dragging, false);
});
