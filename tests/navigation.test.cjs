"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), C = require("../core.js"), N = require("../navigation.js");
function scenario({ replaceBeforeScroll = false, replaceOnScroll = false, contents = false, switchConversation = false, lazy = false, answerOnly = false, startAt = 0 } = {}) {
  let scrollTop = startAt, current, frames = 0, replacements = 0, conversation = "c:test";
  let ready = !lazy;
  const view = { innerHeight: 800, getComputedStyle: () => ({ overflowY: "auto" }) };
  const scroller = { parentElement: null, scrollHeight: 5000, clientHeight: 800, clientTop: 0, get scrollTop() { return scrollTop; }, getBoundingClientRect: () => ({ top: 0, bottom: 800 }), scrollTo({ top }) { scrollTop = top; if (replaceOnScroll && replacements < 3) replace(); } };
  const doc = { defaultView: view, scrollingElement: scroller };
  const entry = { userMessageId: "fallback:user:old", userText: "为什么？", question: "为什么？", answer: "完整的回答。", answerMessageId: "native-answer-9" };
  const note = { id: "n1", conversation: "c:test" };
  function create() {
    const el = { isConnected: true, ownerDocument: doc, parentElement: scroller, getBoundingClientRect: () => contents ? ({ top: 0, height: 0, width: 0 }) : ({ top: 1600 - scrollTop, bottom: 1760 - scrollTop, width: 700, height: 160 }), scrollIntoView() { scrollTop = 1600; } };
    const textElement = { isConnected: true, ownerDocument: doc, parentElement: scroller, scrollIntoView() { ready = true; scrollTop = 1600; } };
    const range = { startContainer: { parentElement: textElement }, getClientRects: () => el.isConnected && ready ? [{ top: 1700 - scrollTop, bottom: 1726 - scrollTop, height: 26, width: 200 }] : [] };
    return { el, turn: el, text: answerOnly ? entry.answer : entry.userText, role: answerOnly ? "assistant" : "user", id: answerOnly ? entry.answerMessageId : "fallback:user:new", index: 9, range, textElement };
  }
  function replace() { if (current) { current.el.isConnected = false; current.textElement.isConnected = false; } current = create(); replacements++; }
  current = create();

  const answer = { role: "assistant", text: entry.answer, id: entry.answerMessageId };
  const nav = N.create({ core: C, getConversation: () => conversation, reader: { read: () => answerOnly ? [current] : [current, answer], range: message => message.range }, nextFrame: async () => { frames++; if (replaceBeforeScroll && frames === 1) replace(); if (switchConversation && frames === 1) conversation = "c:other"; } });
  return { nav, note, entry, get replacements() { return replacements; }, get top() { return scrollTop; } };
}
test("an already visible restore target stays at the same viewport position", async () => {
  const s = scenario({ startAt: 1300, replaceOnScroll: true });
  const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "located");
  assert.equal(s.top, 1300);
  assert.equal(s.replacements, 0);
  assert.equal(result.beforeTop, result.afterTop);
});
test("a footer archive aligns its question even if it was already low in the viewport", async () => {
  const s = scenario({ startAt: 1300 });
  const result = await s.nav.jump(s.note, s.entry, { questionOnly: true, alignQuestion: true });
  assert.equal(result.code, "located");
  assert.equal(result.kind, "question");
  assert.ok(result.beforeTop > 300);
  assert.ok(result.afterTop > 0 && result.afterTop <= 90);
  assert.equal(result.historySteps, undefined);
});
test("restoring an answer rebinds its question if the page replaces the message", async () => {
  const s = scenario({ replaceBeforeScroll: true }); const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "located"); assert.equal(result.inView, true); assert.ok(result.rebound >= 1);
});
test("scroll-induced rerenders are retried against the fresh question node", async () => {
  const s = scenario({ replaceOnScroll: true }); const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "located"); assert.equal(s.replacements, 1); assert.ok(result.rebound >= 1);
});
test("display-contents user containers are located using the visible question text", async () => {
  const s = scenario({ contents: true }); const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "located"); assert.equal(result.inView, true);
});
test("offscreen lazy content is brought into view through the question text element", async () => {
  const s = scenario({ lazy: true, contents: true }); const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "located"); assert.equal(result.inView, true); assert.ok(result.attempts >= 2);
});
test("a navigation stops when the user switches conversations", async () => {
  const s = scenario({ switchConversation: true }); const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "different-conversation"); assert.equal(s.nav.diagnostic().sameConversation, false);
});
test("rapid navigation requests are queued rather than silently skipped", async () => {
  const s = scenario({ replaceBeforeScroll: true }); const results = await Promise.all([s.nav.jump(s.note, s.entry), s.nav.jump(s.note, s.entry)]);
  assert.ok(results.every(result => result.code === "located"));
});

test("a virtualized question can be located through its verified native answer", async () => {
  const s = scenario({ answerOnly: true, replaceBeforeScroll: true }); const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "located"); assert.equal(result.kind, "answer"); assert.equal(result.inView, true);
  assert.match(result.message, /定位原问答/);
});

function historyScenario({ direction = "older", nested = false, missing = false, cancel = false, changeConversation = false, duplicate = false, interruptAtEdge = false } = {}) {
  let top = direction === "older" ? 3200 : 0, clock = 100, ready = false, waits = 0, conversation = "c:test";
  if (interruptAtEdge) top = 0;
  const initial = top, moves = [], updates = [];
  const scroller = { isConnected: true, scrollHeight: 5000, clientHeight: 800, clientTop: 0, parentElement: null,
    get scrollTop() { return top; }, scrollLeft: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
    scrollTo({ top: next }) { top = Math.max(0, Math.min(4200, next)); moves.push(top); } };
  const docRoot = nested ? { isConnected: true, scrollHeight: 800, clientHeight: 800, scrollTop: 0, scrollTo() {} } : scroller;
  const doc = { scrollingElement: docRoot, defaultView: { innerHeight: 800, getComputedStyle: () => ({ overflowY: "auto" }) } };
  const note = { id: "n", conversation };
  const entry = { userText: "为什么？", question: "为什么？", userMessageId: "native-question" };
  const targetTop = direction === "older" ? 180 : 2600;
  const el = { isConnected: true, ownerDocument: doc, parentElement: scroller,
    getBoundingClientRect: () => ({ top: targetTop - top, bottom: targetTop + 40 - top, height: 40, width: 600 }) };
  const question = { id: duplicate ? "fallback:user:reloaded" : entry.userMessageId, role: "user", text: entry.userText, index: 7, el, turn: el };
  const tailEl = { isConnected: true, ownerDocument: doc, parentElement: scroller,
    getBoundingClientRect: () => ({ top: -top - 100, bottom: -top - 50, width: 600, height: 50 }) };
  const tail = { id: "tail", role: "assistant", text: "其他回答", el: tailEl, turn: tailEl, index: 8 };
  const read = () => [...(ready ? duplicate ? [question, { ...question, id: "fallback:user:duplicate" }] : [question] : []), tail];
  const range = message => ({ startContainer: { parentElement: message.el }, getClientRects: () => [message.el.getBoundingClientRect()] });
  const nav = N.create({ core: C, reader: { read, range }, document: doc, getConversation: () => conversation, now: () => clock,
    nextFrame: async () => { if (interruptAtEdge) { nav.cancel({ restorePosition: false }); top = 733; } }, onUpdate: status => updates.push(status.code),
    waitForHistory: async (_, timeout) => {
      clock += timeout; waits++;
      if (cancel && waits === 2) nav.cancel();
      if (changeConversation && waits === 2) conversation = "c:other";
      if (!missing && (direction === "older" ? top < 500 : top > 2200)) ready = true;
    } });
  return { nav, note, entry, moves, updates, initial, get top() { return top; }, get waits() { return waits; } };
}
test("a normal restore leaves the viewport alone when the original turn is not loaded", async () => {
  const s = historyScenario();
  const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "question-not-found");
  assert.equal(s.top, s.initial);
  assert.deepEqual(s.moves, []);
  assert.equal(s.waits, 0);
});
test("unloaded older messages are loaded by scrolling before their exact message is located", async () => {
  const s = historyScenario(); const result = await s.nav.jump(s.note, s.entry, { searchHistory: true });
  assert.equal(result.code, "located"); assert.equal(result.historyLoaded, true); assert.equal(result.inView, true);
  assert.ok(s.moves.some(top => top < 500)); assert.ok(s.updates.includes("loading-history"));
});
test("an unavailable later question is located by searching forward in the nested conversation scroller", async () => {
  const s = historyScenario({ direction: "newer", nested: true }); const result = await s.nav.jump(s.note, s.entry, { searchHistory: true });
  assert.equal(result.code, "located"); assert.equal(result.historyDirection, "newer"); assert.equal(result.scrollers, 2);
  assert.ok(s.moves.some(top => top > 2200));
});
test("a missing or ambiguous history target stops after a bounded search and restores the previous scroll", async () => {
  for (const options of [{ missing: true }, { duplicate: true }]) {
    const s = historyScenario(options); const result = await s.nav.jump(s.note, s.entry, { searchHistory: true });
    assert.equal(result.code, "question-not-found"); assert.equal(s.top, s.initial);
    assert.ok(s.waits > 1 && s.waits <= 150);
  }
});
test("history search can be cancelled and never restores an old scroll into a changed conversation", async () => {
  const cancelled = historyScenario({ cancel: true });
  assert.equal((await cancelled.nav.jump(cancelled.note, cancelled.entry, { searchHistory: true })).code, "cancelled");
  assert.equal(cancelled.top, cancelled.initial); assert.equal(cancelled.waits, 2);
  const switched = historyScenario({ changeConversation: true });
  assert.equal((await switched.nav.jump(switched.note, switched.entry, { searchHistory: true })).code, "different-conversation");
  assert.notEqual(switched.top, switched.initial); assert.equal(switched.waits, 2);
});
test("manual interruption during an edge-loading frame prevents a delayed scroll from overriding the user", async () => {
  const s = historyScenario({ missing: true, interruptAtEdge: true });
  assert.equal((await s.nav.jump(s.note, s.entry, { searchHistory: true })).code, "cancelled");
  assert.equal(s.top, 733); assert.equal(s.waits, 0);
});
