"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const S = require("../storage.js");
const { memoryArea: area } = require("./helpers.cjs");
const note = () => ({ schema: 1, id: "n1", conversation: "c:test", createdAt: 1, updatedAt: 2, deletedAt: null,
  anchor: { quote: "原句", originalText: "原句所在的回答" }, exchanges: [{ id: "e1", question: "Q", answer: "A" }], pending: null });

test("two tab writes from the same version cannot silently overwrite each other", async () => {
  const storage = area(), store = S.create({ area: storage, now: () => 100 });
  const initial = (await store.request({ operation: "save", note: note(), expectedRevision: 0 })).note;
  const a = structuredClone(initial), b = structuredClone(initial);
  a.exchanges.push({ id: "e2", question: "first tab", answer: "answer" });
  b.exchanges.push({ id: "e3", question: "second tab", answer: "answer" });
  const results = await Promise.all([store.handle({ operation: "save", note: a, expectedRevision: 1 }), store.handle({ operation: "save", note: b, expectedRevision: 1 })]);
  assert.equal(results[0].ok, true); assert.equal(results[1].code, "conflict");
  const saved = (await storage.get(null))[S.key(initial)];
  assert.equal(saved.exchanges.at(-1).id, "e2"); assert.equal(saved.revision, 2); assert.equal(saved.updatedAt, 101);
});

test("delete releases payload under quota, fences stale writes, and permits one explicit undo", async () => {
  const original = note(); original.exchanges[0].answer = "x".repeat(8000);
  const storage = area({ [S.key(original)]: original }, 10000), store = S.create({ area: storage, now: () => 100 });
  const deleted = await store.request({ operation: "save", note: { ...original, deletedAt: 99 }, expectedRevision: 0 });
  const persisted = (await storage.get(null))[S.key(original)];
  assert.equal(persisted.anchor, undefined); assert.deepEqual(persisted.exchanges, []); assert.equal(persisted.pending, null);
  assert.ok(JSON.stringify(persisted).length < 300);
  const second = { ...note(), id: "n2" }; second.exchanges[0].answer = "y".repeat(8000);
  await store.request({ operation: "save", note: second, expectedRevision: 0 });
  assert.equal((await store.handle({ operation: "save", note: original, expectedRevision: 0 })).code, "conflict");
  assert.equal((await store.handle({ operation: "save", note: original, expectedRevision: deleted.note.revision })).code, "conflict");
  // Use a fresh store to verify that even a worker restart retains the deletion fence.
  const restarted = S.create({ area: storage });
  assert.equal((await restarted.handle({ operation: "save", note: original, expectedRevision: 0 })).code, "conflict");
  const small = { ...original, exchanges: [{ id: "e1", question: "Q", answer: "restored" }] };
  const restored = await restarted.request({ operation: "restore", note: small, expectedRevision: deleted.note.revision });
  assert.equal(restored.note.deletedAt, null); assert.equal(restored.note.exchanges[0].answer, "restored");
  assert.equal((await restarted.handle({ operation: "restore", note: small, expectedRevision: deleted.note.revision })).code, "conflict");
});

test("old deleted notes are compacted without changing live notes or preferences", async () => {
  const deleted = { ...note(), deletedAt: 10 }, live = { ...note(), id: "live" };
  const prefs = { hideLinked: false };
  const storage = area({ [S.key(deleted)]: deleted, [S.key(live)]: live, "gpt-sticky:prefs": prefs });
  const store = S.create({ area: storage });
  assert.equal((await store.request({ operation: "compact" })).notes.length, 1);
  const saved = await storage.get(null);
  assert.equal(saved[S.key(deleted)].anchor, undefined);
  assert.deepEqual(saved[S.key(live)], live); assert.deepEqual(saved["gpt-sticky:prefs"], prefs);
  assert.equal((await store.request({ operation: "compact" })).notes.length, 0);
});

test("imports use current storage versions, select the newest duplicate, and reject stale follow-up saves", async () => {
  const storage = area(), store = S.create({ area: storage, now: () => 10 });
  const initial = (await store.request({ operation: "save", note: note(), expectedRevision: 0 })).note;
  const newer = { ...note(), updatedAt: 100, exchanges: [{ id: "e2", question: "Q", answer: "from backup" }] };
  const older = { ...newer, updatedAt: 50 };
  const imported = await store.request({ operation: "import", notes: [newer, older] });
  assert.equal(imported.notes.length, 1); assert.equal(imported.notes[0].updatedAt, 100);
  assert.equal(imported.notes[0].revision, 2);
  assert.equal((await store.handle({ operation: "save", note: initial, expectedRevision: initial.revision })).code, "conflict");
  assert.equal((await store.request({ operation: "import", notes: [older] })).notes.length, 0);
});

test("failed storage commits preserve existing data and do not block later requests", async () => {
  const storage = area({}, 1000), store = S.create({ area: storage });
  const tooLarge = note(); tooLarge.exchanges[0].answer = "x".repeat(2000);
  const failed = await store.handle({ operation: "save", note: tooLarge, expectedRevision: 0 });
  assert.equal(failed.code, "quota"); assert.deepEqual(await storage.get(null), {});
  assert.equal((await store.request({ operation: "save", note: note(), expectedRevision: 0 })).note.revision, 1);
});

