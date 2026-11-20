"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
function setup(options = {}) {
  class Style {
    constructor() { this.values = new Map(); this.writes = 0; }
    getPropertyValue(key) { return this.values.get(key)?.[0] || ""; }
    getPropertyPriority(key) { return this.values.get(key)?.[1] || ""; }
    setProperty(key, value, priority = "") { this.writes++; this.values.set(key, [value, priority]); }
    removeProperty(key) { this.values.delete(key); }
  }
  const parent = { name: "React-owned parent" }, children = [{ name: "native interactive image" }], attrs = new Map(), classes = new Set(), frames = [];
  const node = { parentElement: parent, children, isConnected: true, style: new Style(), open: false,
    hasAttribute: name => attrs.has(name), getAttribute: name => attrs.get(name) ?? null, setAttribute: (name, value) => attrs.set(name, value), removeAttribute: name => attrs.delete(name),
    classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
    matches() { return this.open; }, showPopover() { this.open = true; }, hidePopover() { this.open = false; },
    getBoundingClientRect() { return { width: parseFloat(this.style.getPropertyValue("width")) || 690, height: 200 }; },
    append() { throw new Error("Native children must never be moved"); }, remove() { throw new Error("Native turns must never be removed"); }
  };
  node.style.setProperty("margin", "24px 0px"); node.style.setProperty("color", "rgb(20, 30, 40)");
  const viewport = { clientWidth: 440, clientHeight: 400, scrollTop: 0, addEventListener() {}, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) };
  const slot = { isConnected: true, style: {}, get offsetHeight() { return parseFloat(this.style.height) || 0; }, getBoundingClientRect() { return { top: 120, left: 20, width: Math.min(viewport.clientWidth, this.style.maxWidth?.endsWith("px") ? parseFloat(this.style.maxWidth) : Infinity) }; } };
  const events = new Map();
  const context = vm.createContext({ WeakRef, getComputedStyle: target => ({ display: "block", visibility: "visible", marginTop: "24px", marginBottom: "24px", marginLeft: "0px", getPropertyValue: key => target.style.getPropertyValue(key) || "0px" }), addEventListener(type, handler, config) { events.set(type, { handler, config }); }, requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "native-view.js"), "utf8"), context);
  const native = context.GPTStickyNative.create({ viewport, document: { addEventListener() {} }, ...options });
  return { native, node, parent, children, slot, viewport, events, message: { turn: node, el: node, role: "assistant" } };
}
test("native rendering retains the same DOM parent and interactive children", () => {
  const h = setup(); assert.equal(h.native.mount(h.slot, h.message), true);
  assert.equal(h.node.parentElement, h.parent); assert.equal(h.node.children, h.children); assert.equal(h.node.open, true);
  h.viewport.clientWidth = 900; h.native.layout();
  assert.equal(h.node.getBoundingClientRect().width, 900);
});
test("repeated native layouts do not rewrite identical source styles", () => {
  const h = setup(); h.native.mount(h.slot, h.message); h.native.layout(); const writes = h.node.style.writes;
  h.native.layout(); h.native.layout(); assert.equal(h.node.style.writes, writes);
});
test("closing the card restores source styles and removes only owned attributes", () => {
  const h = setup(); h.native.mount(h.slot, h.message); h.native.clear();
  assert.equal(h.node.open, false); assert.equal(h.node.hasAttribute("popover"), false); assert.equal(h.node.hasAttribute("data-gpt-answer-shelf-native"), false);
  assert.equal(h.node.style.getPropertyValue("margin"), "24px 0px"); assert.equal(h.node.style.getPropertyValue("position"), ""); assert.equal(h.node.style.getPropertyValue("color"), "rgb(20, 30, 40)");
});
test("closing a card preserves a newer style written by the page", () => {
  const h = setup(); h.native.mount(h.slot, h.message); h.node.style.setProperty("color", "red"); h.native.clear();
  assert.equal(h.node.style.getPropertyValue("color"), "red");
});
test("foreign popovers are left untouched and use the backup view", () => {
  const h = setup(); h.node.setAttribute("popover", "auto"); assert.equal(h.native.mount(h.slot, h.message), false);
  assert.equal(h.node.getAttribute("popover"), "auto"); assert.equal(h.node.open, false);
});

test("a widened answer releases nested layout caps and restores them on close", () => {
  const h = setup(), child = { tagName: "DIV", style: new h.node.style.constructor(), parentElement: h.node };
  child.style.setProperty("max-width", "384px"); child.style.setProperty("font-size", "18px");
  h.node.contains = part => part === child; h.message.el = child;
  h.native.mount(h.slot, h.message); h.viewport.clientWidth = 824; h.native.layout();
  assert.equal(h.node.getBoundingClientRect().width, 824);
  assert.equal(child.style.getPropertyValue("max-width"), "none");
  assert.equal(child.style.getPropertyValue("font-size"), "18px");
  h.native.clear(); assert.equal(child.style.getPropertyValue("max-width"), "384px");
  assert.equal(child.style.getPropertyValue("width"), "");
});

test("new slots retain native user spacing after a sidebar rerender", () => {
  const h = setup(); h.message.role = "user"; h.native.mount(h.slot, h.message);
  const replacement = { ...h.slot, style: {} }; h.native.mount(replacement, h.message);
  assert.equal(replacement.style.marginTop, "24px"); assert.equal(replacement.style.width, "calc(100% - 0px)");
});

test("sticky image clicks stop site handlers before reaching the page, only while projected", () => {
  let opened = 0, prevent = 0, stop = 0, accept = true;
  const h = setup({ onOpenMedia() { opened++; return accept; } }); h.native.mount(h.slot, h.message);
  const click = h.events.get("click"); assert.equal(click.config.capture, true);
  const event = { target: { closest: () => h.node }, preventDefault() { prevent++; }, stopImmediatePropagation() { stop++; } };
  click.handler(event); assert.equal(opened, 1); assert.equal(prevent, 1); assert.equal(stop, 1);
  accept = false; click.handler(event); assert.equal(prevent, 1); assert.equal(stop, 1);
  h.native.clear(); click.handler(event); assert.equal(opened, 2);
});

test("a promoted native message asks an open preview to stay above it", () => {
  let raises = 0;
  const h = setup({ onPromote() { raises++; assert.equal(h.node.open, true); } });
  h.native.mount(h.slot, h.message); assert.equal(raises, 1);
  h.native.mount(h.slot, h.message); h.native.layout(); assert.equal(raises, 1);
});
