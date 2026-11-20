"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
function setup() {
  let conversation = "c:one", sourceVersion = 1;
  const page = { scrollTop: 200, scrollLeft: 0, isConnected: true, parentElement: null }, source = { parentElement: page };
  const events = new Map();
  const context = vm.createContext({ getComputedStyle: () => ({ overflowY: "auto" }), addEventListener(type, listener) { events.set(type, listener); }, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "reading.js"), "utf8"), context);
  const reading = context.GPTStickyReading.create({ getConversation: () => conversation, document: { scrollingElement: page }, resolve: () => ({ node: source, rect: () => ({ top: 500 + (sourceVersion - 1) * 40 - page.scrollTop }) }) });
  return { reading, page, events, changeConversation() { conversation = "c:other"; }, rerender() { sourceVersion++; } };
}
test("native auto-scroll is restored to the captured reading position", () => {
  const h = setup(); h.reading.capture({ id: "note" }); h.page.scrollTop = 2400; h.reading.restore();
  assert.equal(h.page.scrollTop, 200); h.reading.release(); assert.equal(h.reading.active, false);
});
test("a rebuilt source is resolved again to retain its previous visual position", () => {
  const h = setup(); h.reading.capture({ id: "note" }); h.rerender(); h.page.scrollTop = 2400; h.reading.restore();
  assert.equal(h.page.scrollTop, 240);
});
test("a source reflow does not create repeated scroll restoration feedback", () => {
  const h = setup(); h.reading.capture({ id: "note" }); h.rerender();
  let offset = 2400, writes = 0;
  Object.defineProperty(h.page, "scrollTop", { get: () => offset, set: value => { if (value !== offset) writes++; offset = value; } });
  h.reading.restore(); const afterFirst = writes;
  h.reading.restore(); h.reading.restore();
  assert.equal(offset, 240); assert.equal(writes, afterFirst);
});
test("a conversation change never restores scroll in the new conversation", () => {
  const h = setup(); h.reading.capture({ id: "note" }); h.changeConversation(); h.page.scrollTop = 1000; h.reading.release();
  assert.equal(h.page.scrollTop, 1000);
});

test("manual main-page scrolling releases the bookmark and keeps the newly chosen position", () => {
  const h = setup(); h.reading.capture({ id: "note" });
  h.events.get("wheel")({ type: "wheel", target: { closest: () => null } }); h.page.scrollTop = 600;
  h.reading.pin(); h.reading.release(); assert.equal(h.page.scrollTop, 600); assert.equal(h.reading.active, false);
});

test("scrolling the card keeps auto-scroll protection, while main scrollbar drags and page keys release it", () => {
  const h = setup(); h.reading.capture({ id: "note" });
  h.events.get("wheel")({ type: "wheel", target: { closest: () => ({}) } }); assert.equal(h.reading.active, true);
  for (const type of ["pointerdown", "touchstart", "keydown"]) {
    h.reading.capture({ id: "note" }); h.events.get(type)({ type, key: "PageDown", target: { closest: () => null } }); assert.equal(h.reading.active, false);
  }
});
