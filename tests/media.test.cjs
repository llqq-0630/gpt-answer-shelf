"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), M = require("../media.js"), R = require("../rich.js");
function scenario({ small = false, wrapped = false, role = null, outside = false } = {}) {
  const control = { nodeType: 1, closest: selector => selector === "img" ? null : control, querySelectorAll: () => [image], getAttribute: name => name === "role" ? role : null, hasAttribute: () => false };
  const image = { nodeType: 1, closest: selector => selector === "img" ? image : wrapped ? control : null, getBoundingClientRect: () => ({ width: small ? 54 : 380, height: small ? 54 : 240 }) };
  const turn = { contains: node => !outside && [image, control].includes(node) };
  return { image, turn, event: { target: wrapped ? control : image, button: 0 } };
}
test("native photographs and their image buttons open the sticky preview", () => {
  for (const wrapped of [false, true]) { const s = scenario({ wrapped }); assert.equal(M.nativeImage(s.event, s.turn), s.image); }
});
test("gallery thumbnails, tab controls and unrelated message images retain their actions", () => {
  for (const options of [{ small: true, wrapped: true }, { wrapped: true, role: "tab" }, { outside: true }]) {
    const s = scenario(options); assert.equal(M.nativeImage(s.event, s.turn), null);
  }
  const s = scenario(), action = { closest: selector => selector === "img" ? null : action, querySelectorAll: () => [] };
  assert.equal(M.nativeImage({ target: action, button: 0 }, { contains: () => true }), null);
});
test("image context menus and modifier clicks keep the browser's native actions", () => {
  const s = scenario();
  for (const extra of [{ button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) assert.equal(M.nativeImage({ ...s.event, ...extra }, s.turn), null);
});
test("preview images use the displayed source and preserve dimensions without active markup", () => {
  const image = { currentSrc: "https://images.example/full.png", src: "https://images.example/thumb.png", naturalWidth: 1200, naturalHeight: 800, alt: "图像 <示例>", complete: false,
    hasAttribute: () => false, getBoundingClientRect: () => ({ width: 380, height: 240 }) };
  const result = R.imageForPreview(image);
  assert.equal(result.attrs.src, image.currentSrc); assert.equal(result.attrs.alt, image.alt);
  assert.deepEqual(result.size, { width: 1200, height: 800 }); assert.equal(result.tag, "img");
  assert.equal(R.imageForPreview({ ...image, currentSrc: "javascript:alert(1)" }), null);
});
