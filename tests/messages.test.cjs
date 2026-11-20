"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const M = require("../messages.js");
const C = require("../core.js");
test("an existing answer can be archived without a copy or feedback control", () => {
  const facts = { completion: false, loaded: 0, pending: 0 };
  assert.equal(M.canArchiveReply({ role: "assistant", text: "这是网页已经显示的回答。" }, facts, C), true);
});
test("removing the footer requirement still excludes status, error and streaming turns", () => {
  for (const text of ["", "Thinking…", "Generating a response...", "正在加载图片…", "Worked for 4m 3s", "Error in message stream", "生成回答时出错"]) {
    assert.equal(M.canArchiveReply({ role: "assistant", text }, { completion: false }, C), false, text);
  }
  assert.equal(M.canArchiveReply({ role: "assistant", text: "部分内容" }, { inProgress: true }, C), false);
  assert.equal(M.canArchiveReply({ role: "user", text: "用户问句" }, {}, C), false);
});
test("a completed gallery can omit its action bar but must have loaded images", () => {
  const gallery = { role: "assistant", kind: "image", text: "" };
  assert.equal(M.canArchiveReply(gallery, { completion: false, loaded: 3, pending: 0 }, C), true);
  assert.equal(M.canArchiveReply(gallery, { loaded: 2, pending: 1 }, C), false);
  assert.equal(M.canArchiveReply(gallery, { loaded: 0, pending: 0 }, C), false);
  assert.equal(M.canArchiveReply(gallery, { loaded: 1, pending: 0, inProgress: true }, C), false);
});
test("a completed image gallery is recognized without a Markdown answer body", () => {
  const facts = { user: false, images: 3, copy: true, feedback: true, onlyStatus: true, textBody: false };
  assert.equal(M.classifyImageReply(facts), true);
  assert.equal(M.classifyImageReply({ ...facts, feedback: false, onlyStatus: false }), false);
  assert.equal(M.classifyImageReply({ ...facts, images: 0 }), false);
});
test("user attachments and ordinary illustrated prose retain their original roles", () => {
  const facts = { user: false, images: 1, copy: true, feedback: true, onlyStatus: false, textBody: false };
  assert.equal(M.classifyImageReply({ ...facts, user: true }), false);
  assert.equal(M.classifyImageReply({ ...facts, textBody: true }), false);
  assert.equal(M.classifyImageReply({ ...facts, feedback: false }), false);
  assert.equal(M.classifyImageReply({ ...facts, feedback: false, onlyStatus: true, statusText: false, assistant: false }), false);
  assert.equal(M.classifyImageReply({ ...facts, feedback: false, onlyStatus: true, assistant: true }), true);
});
test("renewed signed image URLs retain resource identity while different generated images do not", () => {
  const one = M.imageResource("https://chatgpt.com/files/content?id=file-one&sig=old&width=64");
  const renewed = M.imageResource("https://chatgpt.com/files/content?id=file-one&sig=new&width=1024");
  assert.equal(one, renewed);
  assert.notEqual(one, M.imageResource("https://chatgpt.com/files/content?id=file-two&sig=new"));
  assert.equal(M.imageResource("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
});
