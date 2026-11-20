"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
require("../rich.js");

const entry = { id: "e1", question: "什么意思？", userText: "这个步骤是什么意思？", answer: "先检查输入。", userMessageId: "q1", answerMessageId: "a1", placement: "sidebar" };
const message = (id, role, text, extra = {}) => ({ id, role, text, ...extra });
const pair = id => [
  message("q" + id, "user", entry.userText),
  message("a" + id, "assistant", entry.answer, { priorUserText: entry.userText })
];
const note = { schema: 1, mode: "archive", id: "n1", conversation: "c:one", exchanges: [entry] };

test("conversation keys survive query, branch and project paths", () => {
  assert.equal(C.conversationKey("https://chatgpt.com/g/project/c/abc?branch=2"), "c:abc");
  assert.equal(C.conversationKey("https://chatgpt.com/share/example"), "share:example");
  assert.equal(C.conversationKey("https://chatgpt.com/"), null);
});

test("the same question and answer in two native turns retain their own identities", () => {
  const first = pair(1), second = pair(2);
  assert.equal(C.findLinkedPair(entry, [...first, ...second]).answer, first[1]);
  const ambiguous = [...first, ...second].map((item, index) => ({ ...item, id: "fallback:" + index }));
  assert.equal(C.findLinkedPair(entry, ambiguous), null);
  assert.equal(C.questionForEntry(entry, ambiguous), null);
});

test("an unambiguous pair can rebind after its fallback DOM IDs change", () => {
  const [user, answer] = pair(1).map((item, index) => ({ ...item, id: "fallback:new:" + index }));
  assert.deepEqual(C.findLinkedPair(entry, [user, answer]), { user, answer });
});

test("an unloaded answer still permits locating its question by full text", () => {
  const [user] = pair(1);
  assert.equal(C.questionForEntry(entry, [user]), user);
  assert.equal(C.questionForEntry(entry, [{ ...user, text: "已经编辑过的问题。" }]), null);
});

test("a visible older question with the same wording cannot replace the unloaded saved question", () => {
  const [olderQuestion, olderAnswer] = pair(2);
  const saved = { ...entry, userMessageId: "fallback:last", answerMessageId: "fallback:answer", answer: "最后一条回答。" };
  for (const id of [olderQuestion.id, "fallback:older", "conversation-turn-1:user"]) {
    const question = { ...olderQuestion, id };
    assert.equal(C.questionForEntry(saved, [question, olderAnswer]), null);
    assert.equal(C.questionForEntry(saved, [question]), null);
  }
});

test("an unloaded question does not make a reused native answer ID sufficient", () => {
  const [, answer] = pair(1);
  assert.equal(C.storedAnswer(entry, [answer]), answer);
  assert.equal(C.storedAnswer(entry, [{ ...answer, text: "另一分支的回答。" }]), null);
  assert.equal(C.storedAnswer(entry, [{ ...answer, priorUserText: "另一个问题" }]), null);
});

test("boundaries and subsequent questions prevent reading an unrelated answer", () => {
  const [user, answer] = pair(1), next = message("q2", "user", "第二个问题");
  assert.equal(C.responseAfter(user, [user, next, answer]), null);
  assert.equal(C.responseAfter(user, [user, { role: "boundary" }, answer]), null);
});

test("image-only replies require the saved gallery identity", () => {
  const [user] = pair(1);
  const answer = message("a1", "assistant", "", { kind: "image", mediaKey: "gallery1" });
  const saved = { ...entry, answer: "", responseKind: "image", mediaKey: "gallery1" };
  assert.equal(C.findLinkedPair(saved, [user, answer]).answer, answer);
  assert.equal(C.storedAnswer(saved, [{ ...answer, id: "fallback:new" }]).mediaKey, "gallery1");
  assert.equal(C.findLinkedPair(saved, [user, { ...answer, mediaKey: "gallery2" }]), null);
  assert.equal(C.storedAnswer(saved, [message("a1", "assistant", "")]), null);
});

test("the demo's previously saved archive imports with its placement and full text", () => {
  const long = "这是一条长问句。".repeat(1600);
  const restored = C.sanitizeNote({ ...note, anchor: { quote: "旧记录的问句" }, pending: null,
    exchanges: [{ ...entry, userText: long, question: long, placement: "main" }] });
  assert.equal(restored.mode, "archive");
  assert.equal(restored.exchanges[0].question, long);
  assert.equal(restored.exchanges[0].placement, "main");
  assert.equal(restored.anchor, undefined);
  assert.equal(restored.pending, undefined);
});

test("imports reject foreign record types, invalid scope and incomplete answers", () => {
  assert.throws(() => C.sanitizeNote({ ...note, mode: "sticky" }), /格式/);
  assert.throws(() => C.sanitizeNote({ ...note, conversation: "https://example.com" }), /格式/);
  assert.throws(() => C.sanitizeNote({ ...note, exchanges: [{ ...entry, answer: "This response couldn't load" }] }), /有效/);
  assert.throws(() => C.sanitizeNote({ ...note, exchanges: [{ ...entry, userText: "" }] }), /有效/);
});
