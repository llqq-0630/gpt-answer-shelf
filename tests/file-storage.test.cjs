"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const S = require("../storage.js"), F = require("../file-storage.js");
const { memoryArea } = require("./helpers.cjs");

function makeFolder(name, control = {}) {
  const directories = new Map(), files = new Map();
  return {
    name, directories, files,
    async queryPermission() { return control.permission || "granted"; },
    async isSameEntry(other) { return other === this; },
    async getDirectoryHandle(key, { create } = {}) {
      if (create && !directories.has(key)) directories.set(key, makeFolder(key, control));
      if (!directories.has(key)) throw new DOMException("Directory missing", "NotFoundError");
      return directories.get(key);
    },
    async getFileHandle(key, { create } = {}) {
      if (create && !files.has(key)) files.set(key, "");
      if (!files.has(key)) throw new DOMException("File missing", "NotFoundError");
      return {
        async getFile() { return new Blob([files.get(key)]); },
        async createWritable() {
          let content;
          return {
            async write(value) { content = value; },
            async close() { if (control.fail === key) throw new Error("Disk write failed"); files.set(key, content); },
            async abort() {}
          };
        }
      };
    },
    async *keys() { yield* files.keys(); },
    async removeEntry(key) { files.delete(key); }
  };
}
function testStore(area) {
  const handles = new Map();
  const folders = { ...F, async getHandle(id) { return handles.get(id); },
    async saveHandle(id, handle) { handles.set(id, handle); }, async removeHandle(id) { handles.delete(id); } };
  return S.create({ area, folders });
}
const record = (id, answer = "回答") => ({
  schema: 1, mode: "archive", conversation: "c:fixture", id, revision: 4, createdAt: 1, updatedAt: 2,
  exchanges: [{ id: "e", userText: "问题", answer, placement: "sidebar" }]
});
const read = (store, id) => store.request({ operation: "read", conversation: "c:fixture", id });

test("migration moves legacy notes and new writes between a chosen folder and browser storage", async () => {
  const original = record("old"), prefs = { hideLinked: true };
  const area = memoryArea({ [S.key(original)]: original, "gpt-sticky:prefs": prefs });
  const store = testStore(area), first = makeFolder("First");
  first.files.set("unrelated.txt", "preserve");
  await store.request({ operation: "location", folder: first });
  assert.equal((await store.request({ operation: "settings" })).settings.folder.name, "First");
  assert.deepEqual((await read(store, "old")).note, original);
  assert.equal((await area.get(S.key(original)))[S.key(original)], undefined);
  const add = record("new", "新的回答");
  const saved = (await store.request({ operation: "save", note: add, expectedRevision: 0 })).note;
  assert.equal((await area.get(S.key(add)))[S.key(add)], undefined);
  await store.request({ operation: "location", folder: first });
  assert.deepEqual((await read(store, "new")).note, saved);
  const second = makeFolder("Second");
  await store.request({ operation: "location", folder: second });
  assert.equal((await store.request({ operation: "settings" })).settings.folder.name, "Second");
  assert.deepEqual((await read(store, "new")).note, saved);
  assert.equal(first.files.get("unrelated.txt"), "preserve");
  assert.deepEqual([...first.directories.values().next().value.files.keys()], ["index.json"]);
  await store.request({ operation: "location", folder: null });
  assert.equal((await store.request({ operation: "settings" })).settings.folder, null);
  assert.deepEqual((await area.get(S.key(original)))[S.key(original)], original);
  assert.deepEqual((await area.get(S.key(add)))[S.key(add)], saved);
  assert.deepEqual((await area.get("gpt-sticky:prefs"))["gpt-sticky:prefs"], prefs);
});

test("failed copies and folder index writes leave authoritative records intact and can be retried", async () => {
  const original = record("old"), area = memoryArea({ [S.key(original)]: original });
  const store = testStore(area), control = { fail: "index.json" }, folder = makeFolder("Target", control);
  assert.equal((await store.handle({ operation: "location", folder })).ok, false);
  assert.equal((await store.request({ operation: "settings" })).settings.folder, null);
  assert.deepEqual((await read(store, "old")).note, original);
  // Simulate a tab closing before an earlier copy could clean a staged file.
  const library = [...folder.directories.values()][0];
  library.files.set(`note-${crypto.randomUUID()}.json`, "orphan");
  control.fail = null;
  await store.request({ operation: "location", folder });
  assert.equal(folder.directories.size, 1);
  assert.equal(library.files.size, 2);
  assert.deepEqual((await read(store, "old")).note, original);
  control.fail = "index.json";
  assert.equal((await store.handle({ operation: "save", note: record("new"), expectedRevision: 0 })).ok, false);
  assert.deepEqual((await read(store, "old")).note, original);
  assert.equal((await read(store, "new")).note, null);
  control.permission = "prompt";
  const unavailable = await store.request({ operation: "settings" });
  assert.equal(unavailable.usedBytes, null);
  assert.match(unavailable.warning, /重新授权/);
  assert.equal((await store.handle({ operation: "location", folder: null })).ok, false);
  control.permission = "granted";
  assert.deepEqual((await read(store, "old")).note, original);
});

test("folder quotas reject the whole import before files are written", async () => {
  const store = testStore(memoryArea()), folder = makeFolder("Quota");
  await store.request({ operation: "location", folder });
  await store.request({ operation: "limit", bytes: S.MIB });
  const payload = "图".repeat(190000);
  const result = await store.handle({ operation: "import", notes: [record("a", payload), record("b", payload)] });
  assert.equal(result.code, "quota");
  assert.deepEqual((await store.request({ operation: "list", conversation: "c:fixture" })).notes, []);
  assert.equal((await store.request({ operation: "settings" })).usedBytes, 0);
});
