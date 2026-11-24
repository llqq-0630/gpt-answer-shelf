"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const C = require("../core.js"), R = require("../rich.js"), S = require("../storage.js");
const M = require("../messages.js");
const { memoryArea } = require("./helpers.cjs");
const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const HIDDEN = "gpt-answer-shelf-hidden-turn";
const snapshot = { version: 1, nodes: [{ tag: "p", ns: "html", attrs: {}, children: [{ text: "可查看的回答。" }] }] };

function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function fixture(options = {}) {
  const area = memoryArea({}, 10485760), store = S.create({ area });
  const opened = [], jumped = [], messages = [], notices = [];
  const state = { notes: new Map(), messages, hiddenTurns: new Set(), saving: new Set(), key: "c:test", hideLinked: true };
  const context = vm.createContext({
    C, R, S, state, HIDDEN, Date, structuredClone, crypto,
    CHANNEL: "gpt-answer-shelf:",
    document: { querySelectorAll: () => [] },
    conversation: () => "c:test",
    currentNotes: () => [...state.notes.values()].filter(note => C.isArchive(note) && !note.deletedAt),
    entryOf: note => note.exchanges[0],
    archiveNotes: () => [...state.notes.values()].filter(note => C.isArchive(note) && C.isArchived(note.exchanges[0]) && !note.deletedAt),
    schedule() {},
    chrome: { runtime: { sendMessage: message => store.handle(message) } },
    readMessages: () => messages,
    reader: { canArchive: message => M.canArchiveReply(message, { completion: false, loaded: 0, pending: 0 }, C), captureResult: () => snapshot },
    openPanel(id) { opened.push(id); },
    closePanel() { context.hideTurns(); },
    reading: { release() {} },
    sync() { context.hideTurns(); },
    navigation: {
      isVisible: () => Boolean(options.nearPair),
      cancel() {},
      capturePair(question, answer) {
        return { question, options: { matchFallback: pair => pair.user.el === question.el || pair.answer.el === answer.el } };
      },
      async jump(note, entry, optionsForJump) {
        jumped.push([note.id, entry.userText, optionsForJump]);
        return { code: options.restoreCode || "located", message: "已定位原问答。" };
      }
    },
    toast(text, action) { notices.push({ text, action }); },
    button(label, action) { return { label, action }; },
    historyToast: "",
    ...options
  });
  vm.runInContext(section("  function acceptNote(", "  function mountArchiveActions(")
    + section("  function hideTurns()", "  function renderSidebar()"), context);
  function message(id, role, text, priorUserText = "") {
    const classes = new Set();
    return {
      id, role, text, priorUserText, el: {},
      turn: { contains(node) { return node === this; }, classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) } }
    };
  }
  const first = { user: message("q1", "user", "这是什么意思？"), answer: message("a1", "assistant", "可查看的回答。", "这是什么意思？") };
  const second = { user: message("q2", "user", first.user.text), answer: message("a2", "assistant", first.answer.text, first.user.text) };
  messages.push(first.user, first.answer, second.user, second.answer);
  return { context, state, area, messages, first, second, opened, jumped, notices };
}
test("a lingering disabled stop control does not block the completed answer", () => {
  const control = { disabled: true, getAttribute: () => "true" };
  const { context, messages } = fixture({ document: { querySelectorAll: () => [control] } });
  assert.equal(context.streamingAnswer(messages), null);
});
test("old turns without completion controls archive independently and open the exact stored answer", async () => {
  const { context, state, first, second, opened } = fixture();
  await context.useQuestionAction(second);
  await context.useQuestionAction(first);
  context.hideTurns();
  const [secondNote, firstNote] = state.notes.values();
  assert.equal(state.notes.size, 2);
  assert.equal(secondNote.exchanges[0].answerMessageId, second.answer.id);
  assert.equal(firstNote.exchanges[0].answerMessageId, first.answer.id);
  for (const pair of [first, second]) {
    assert.equal(pair.user.turn.classList.contains(HIDDEN), false);
    assert.equal(pair.answer.turn.classList.contains(HIDDEN), true);
  }
  assert.deepEqual(opened, []);
  await context.useQuestionAction(second);
  assert.deepEqual(opened, [secondNote.id]);
  assert.equal(state.notes.size, 2);
});

test("restoring one answer releases its snapshot and leaves the other answer archived", async () => {
  const { context, state, area, first, second, jumped } = fixture();
  await context.useQuestionAction(first);
  await context.useQuestionAction(second);
  context.hideTurns();
  const [firstNote, secondNote] = state.notes.values();
  await context.restoreAnswer(secondNote.id);
  const records = await area.get(null);
  assert.equal(records[S.key(firstNote)].exchanges[0].placement, "sidebar");
  assert.equal(records[S.key(secondNote)].exchanges[0].placement, "main");
  assert.equal(records[S.key(secondNote)].exchanges[0].answerDocument, undefined);
  assert.equal(first.answer.turn.classList.contains(HIDDEN), true);
  assert.equal(second.answer.turn.classList.contains(HIDDEN), false);
  assert.deepEqual(jumped, [[secondNote.id, second.user.text, undefined]]);
  await context.useQuestionAction(second);
  assert.equal(state.notes.size, 2);
  assert.equal(state.notes.get(secondNote.id).exchanges[0].placement, "sidebar");
});

test("the answer footer aligns its own question after collapsing the answer", async () => {
  const { context, state, second, jumped } = fixture();
  await context.activateArchiveAction(second, { alignQuestion: true });
  const [note] = state.notes.values();
  assert.equal(second.answer.turn.classList.contains(HIDDEN), true);
  assert.equal(jumped.length, 1);
  assert.equal(jumped[0][0], note.id);
  assert.equal(jumped[0][2].questionOnly, true);
  assert.equal(jumped[0][2].alignQuestion, true);
  assert.equal(jumped[0][2].anchor.question, second.user);
  assert.equal(jumped[0][2].searchHistory, undefined);
});
test("undo and its history lookup keep the same footer anchor", async () => {
  const { context, second, jumped, notices } = fixture({ restoreCode: "question-not-found" });
  await context.activateArchiveAction(second, { alignQuestion: true });
  const anchor = jumped[0][2].anchor, undo = notices.at(-1).action;
  assert.equal(undo.label, "撤销");
  await undo.action();
  assert.equal(jumped[1][2].anchor, anchor);
  await notices.at(-1).action.action();
  assert.equal(jumped[2][2].anchor, anchor);
  assert.equal(jumped[2][2].searchHistory, true);
});

test("a pending scroll adjustment does not block opening the answer just archived", async () => {
  const { context, state, second, opened } = fixture({ nearPair: true });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  context.navigation.jump = () => pending;
  const archive = context.activateArchiveAction(second);
  try {
    await new Promise(resolve => setImmediate(resolve));
    const [note] = state.notes.values();
    assert.equal(state.saving.size, 0);
    await context.activateArchiveAction(second);
    assert.deepEqual(opened, [note.id]);
  } finally {
    release({ code: "located" });
    await archive;
  }
});

test("an unloaded restore only starts a history search when the user clicks the separate action", async () => {
  const { context, state, first, jumped, notices } = fixture({ restoreCode: "question-not-found" });
  await context.useQuestionAction(first);
  await context.restoreAnswer([...state.notes.keys()][0]);
  assert.equal(jumped.length, 1);
  assert.equal(jumped[0][2], undefined);
  const retry = notices.at(-1).action;
  assert.equal(retry.label, "查找原问答");
  await retry.action();
  assert.equal(jumped[1][2].searchHistory, true);
  assert.equal(jumped[1][2].alignQuestion, true);
});

test("an answer replaced during snapshot capture is left visible", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { context, first, messages, state } = fixture({ R: { ...R, materialize: () => pending } });
  const save = context.useQuestionAction(first);
  messages[1] = { ...first.answer, text: "网页生成了另一条回答。" };
  finish(null);
  await assert.rejects(save, /这组问答已变化/);
  assert.equal(state.notes.size, 0);
  assert.equal(first.answer.turn.classList.contains(HIDDEN), false);
});

test("the two archive entry points share one save for the same answer", async () => {
  let finish, captures = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const { context, first, state } = fixture({ R: { ...R, materialize: () => { captures++; return pending; } } });
  const fromQuestion = context.activateArchiveAction(first);
  await context.activateArchiveAction(first);
  assert.equal(captures, 1);
  finish(snapshot);
  await fromQuestion;
  assert.equal(state.notes.size, 1);
  assert.equal(state.saving.size, 0);
});

test("old sticky records do not hide answers in the independent archive extension", () => {
  const { context, state, first } = fixture();
  context.acceptNote({ id: "other", schema: 1, mode: "sticky", conversation: "c:test", revision: 3, exchanges: [
    { userText: first.user.text, answer: first.answer.text, placement: "sidebar" }
  ] });
  context.hideTurns();
  assert.equal(state.notes.size, 0);
  assert.equal(first.answer.turn.classList.contains(HIDDEN), false);
});
