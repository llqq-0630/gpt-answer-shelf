"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const version = require("../manifest.json").version;
const code = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
async function popup(response, rejection) {
  const nodes = new Map(["status", "open", "reload", "help", "version", "check", "diagnose", "diagnostic-report"].map(id => [id, {
    textContent: "", disabled: false, hidden: false, listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; }
  }]));
  const calls = [];
  const context = {
    document: { getElementById(id) { return nodes.get(id); } },
    window: { close() { calls.push("close"); } },
    chrome: {
      runtime: { getManifest() { return { version }; } },
      tabs: {
        async query() { return [{ id: 42 }]; },
        async sendMessage(id, message) { calls.push([id, message.type]); if (rejection) throw rejection; return response; },
        async reload(id) { calls.push([id, "reload"]); }
      }
    }
  };
  vm.runInNewContext(code, context);
  await flush();
  return { nodes, calls };
}
test("a loaded page reports version and answer count, and opens the directory", async () => {
  const { nodes, calls } = await popup({ ok: true, version, pageScriptVersion: version, uiMounted: true, conversationReady: true, questionCount: 3 });
  assert.ok(nodes.get("status").textContent.includes(`已加载 v${version}`));
  assert.match(nodes.get("status").textContent, /3 组可收纳问答/);
  assert.equal(nodes.get("open").disabled, false);
  assert.equal(nodes.get("reload").hidden, true);
  await nodes.get("open").listeners.click();
  assert.deepEqual(calls.at(-2), [42, "gpt-answer-shelf:open"]);
  assert.equal(calls.at(-1), "close");
});
test("a missing content script offers refresh rather than claiming the page is ready", async () => {
  const { nodes, calls } = await popup(null, new Error("Receiving end does not exist"));
  assert.match(nodes.get("status").textContent, /还没有加载收纳扩展/);
  assert.equal(nodes.get("open").disabled, true);
  assert.equal(nodes.get("reload").hidden, false);
  await nodes.get("reload").listeners.click();
  assert.deepEqual(calls.at(-1), [42, "reload"]);
});
test("a startup error remains visible in the popup", async () => {
  const { nodes } = await popup({ ok: false, status: "error", error: "Example startup error" });
  assert.match(nodes.get("status").textContent, /Example startup error/);
  assert.equal(nodes.get("open").disabled, true);
});
test("an older script without a diagnostic reply offers a refresh", async () => {
  const { nodes } = await popup(undefined);
  assert.match(nodes.get("status").textContent, /没有响应/);
  assert.equal(nodes.get("reload").hidden, false);
});
test("an old running content script requires a refresh after updating the extension", async () => {
  const { nodes } = await popup({ ok: true, version: "0.1.0", uiMounted: true, conversationReady: true, questionCount: 3 });
  assert.match(nodes.get("status").textContent, /旧版 v0\.1\.0/);
  assert.equal(nodes.get("reload").hidden, false);
});

test("a live manifest version cannot make an unverified old page look updated", async () => {
  const { nodes } = await popup({ ok: true, version, uiMounted: true, conversationReady: true, questionCount: 3 });
  assert.match(nodes.get("status").textContent, /脚本版本尚未确认/);
  assert.equal(nodes.get("open").disabled, true);
  assert.equal(nodes.get("reload").hidden, false);
});

test("duplicate page interfaces require checking for another enabled copy", async () => {
  const { nodes } = await popup({ ok: true, version, pageScriptVersion: version, uiMounted: true, uiInstances: 2, conversationReady: true, questionCount: 3 });
  assert.match(nodes.get("status").textContent, /多个收纳入口/);
  assert.equal(nodes.get("open").disabled, true);
  assert.equal(nodes.get("reload").hidden, false);
});
test("a new-chat page is recognized as loaded while explaining the conversation requirement", async () => {
  const { nodes } = await popup({ ok: true, version, pageScriptVersion: version, uiMounted: true, conversationReady: false, questionCount: 0 });
  assert.match(nodes.get("status").textContent, /一段 ChatGPT 对话/);
  assert.equal(nodes.get("open").disabled, false);
});
test("an existing conversation with no recognized answers offers structural diagnostics", async () => {
  const { nodes } = await popup({ ok: true, version, pageScriptVersion: version, uiMounted: true, conversationReady: true, questionCount: 0 });
  assert.match(nodes.get("status").textContent, /页面诊断/);
  assert.doesNotMatch(nodes.get("status").textContent, /请等待/);
});
