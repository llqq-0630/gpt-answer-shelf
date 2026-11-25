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

test("the shared limit counts UTF-8 bytes and a lower limit still allows shrinking records", async () => {
  const storage = area(), store = S.create({ area: storage });
  assert.equal((await store.request({ operation: "settings" })).settings.limitBytes, 1024 * S.MIB);
  const large = note(); large.exchanges[0].answer = "图".repeat(400000);
  const saved = (await store.request({ operation: "save", note: large, expectedRevision: 0 })).note;
  assert.equal((await store.request({ operation: "settings" })).usedBytes, Buffer.byteLength(JSON.stringify(saved)));
  assert.equal((await store.handle({ operation: "limit", bytes: -1 })).ok, false);
  await store.request({ operation: "limit", bytes: S.MIB });
  const restarted = S.create({ area: storage });
  assert.equal((await restarted.request({ operation: "settings" })).settings.limitBytes, S.MIB);
  const elsewhere = { ...note(), id: "elsewhere", conversation: "c:other" };
  assert.equal((await restarted.handle({ operation: "save", note: elsewhere, expectedRevision: 0 })).code, "quota");
  assert.deepEqual((await restarted.request({ operation: "read", conversation: large.conversation, id: large.id })).note, saved);
  await restarted.request({ operation: "save", note: { ...saved, exchanges: note().exchanges }, expectedRevision: saved.revision });
  assert.equal((await restarted.handle({ operation: "save", note: elsewhere, expectedRevision: 0 })).ok, true);
});

test("legacy notes are indexed once, and lists page within the conversation without sending rich snapshots", async () => {
  const archives = [
    { ...note(), id: "a", mode: "archive" }, { ...note(), id: "b", mode: "archive" },
    { ...note(), id: "c", mode: "archive", conversation: "c:elsewhere" }
  ];
  for (const archive of archives) archive.exchanges[0] = { question: "Q", userText: "Q", answer: "", placement: "sidebar",
    answerDocument: { version: 1, nodes: [{ text: "x".repeat(7 * S.MIB) }] } };
  const storage = area(Object.fromEntries(archives.map(archive => [S.key(archive), archive])));
  const originalGet = storage.get;
  const reads = [];
  storage.get = keys => { reads.push(keys); return originalGet(keys); };
  const store = S.create({ area: storage });
  const first = await store.request({ operation: "list", conversation: "c:test" });
  assert.ok(first.next);
  assert.deepEqual(first.notes.map(archive => archive.id), ["a"]);
  const second = await store.request({ operation: "list", conversation: "c:test", after: first.next });
  assert.deepEqual(second.notes.map(archive => archive.id), ["b"]);
  assert.equal(second.next, null);
  assert.equal(second.notes[0].exchanges[0].answerDocument, undefined);
  assert.equal(require("../core.js").isArchived(second.notes[0].exchanges[0]), true);
  const read = await store.request({ operation: "read", conversation: "c:test", id: "b" });
  assert.deepEqual(read.note, archives[1]);
  assert.equal(reads.filter(keys => keys === null).length, 1);
  assert.equal(reads.some(keys => Array.isArray(keys) && keys.includes(S.key(archives[2]))), false);
});

