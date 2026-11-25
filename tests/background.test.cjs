"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const store = require("../storage.js");
const folders = require("../file-storage.js");
const { memoryArea } = require("./helpers.cjs");

test("the worker uses storage without registering a context menu", () => {
  assert.deepEqual(require("../manifest.json").permissions, ["storage", "unlimitedStorage"]);
  assert.equal(typeof worker(), "function");
});
test("storage requests keep the message channel open and validate the sender", async () => {
  const receive = worker();
  const request = { type: "gpt-answer-shelf:store", operation: "compact" };
  let rejected;
  receive(request, { url: "https://example.com/" }, value => { rejected = value; });
  assert.equal(rejected.ok, false);
  const result = await new Promise(resolve => {
    assert.equal(receive(request, { url: "https://chatgpt.com/c/test" }, resolve), true);
  });
  assert.equal(result.ok, true);
  for (const operation of ["settings", "location", "limit"]) {
    receive({ ...request, operation }, { url: "https://chatgpt.com/c/test" }, value => { rejected = value; });
    assert.equal(rejected.ok, false);
  }
});

function worker() {
  let receive;
  const chrome = { runtime: { onMessage: { addListener(callback) { receive = callback; } } }, storage: { local: memoryArea() } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), {
    chrome, URL, importScripts() {}, GPTStickyStorage: store, GPTAnswerShelfFolders: folders
  });
  return receive;
}
