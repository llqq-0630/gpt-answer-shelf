"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), C = require("../core.js"), N = require("../navigation.js");
function scenario({ replaceBeforeScroll = false, replaceOnScroll = false, contents = false, switchConversation = false, lazy = false, answerOnly = false,
  answerUnloaded = false, reversed = false, startAt = 0, scrollDuringLayout } = {}) {
  let scrollTop = startAt, current, frames = 0, replacements = 0, conversation = "c:test";
  let ready = !lazy;
  const listeners = new Map();
  const view = { innerHeight: 800, getComputedStyle: () => ({ overflowY: "auto", flexDirection: reversed ? "column-reverse" : "column" }),
    addEventListener(type, listener) { listeners.set(type, listener); } };
  const scroller = { parentElement: null, scrollHeight: 5000, clientHeight: 800, clientTop: 0,
    get scrollTop() { return scrollTop; }, getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
    scrollTo({ top }) {
      scrollTop = reversed ? Math.max(-4200, Math.min(0, top)) : top;
      if (replaceOnScroll && replacements < 3) replace();
    } };
  const doc = { defaultView: view, scrollingElement: scroller };
  const entry = { userMessageId: "fallback:user:old", userText: "为什么？", question: "为什么？", answer: "完整的回答。", answerMessageId: "native-answer-9" };
  const note = { id: "n1", conversation: "c:test" };
  function create() {
    const turnTop = reversed ? -3600 : 1600;
    const el = { isConnected: true, ownerDocument: doc, parentElement: scroller,
      getBoundingClientRect: () => contents ? ({ top: 0, height: 0, width: 0 }) : ({ top: turnTop - scrollTop, bottom: turnTop + 160 - scrollTop, width: 700, height: 160 }),
      scrollIntoView() { scrollTop = turnTop; } };
    const textElement = { isConnected: true, ownerDocument: doc, parentElement: scroller, scrollIntoView() { ready = true; scrollTop = turnTop; } };
    const range = { startContainer: { parentElement: textElement }, getClientRects: () => el.isConnected && ready
      ? [{ top: turnTop + 100 - scrollTop, bottom: turnTop + 126 - scrollTop, height: 26, width: 200 }] : [] };
    return { el, turn: el, text: answerOnly ? entry.answer : entry.userText, role: answerOnly ? "assistant" : "user", id: answerOnly ? entry.answerMessageId : "fallback:user:new", index: 9, range, textElement };
  }
  function replace() { if (current) { current.el.isConnected = false; current.textElement.isConnected = false; } current = create(); replacements++; }
  current = create();

  const answer = { role: "assistant", text: entry.answer, id: entry.answerMessageId };
  const reader = { read: () => answerOnly || answerUnloaded ? [current] : [current, answer], range: message => message.range,
    matchesQuestion: (message, text) => message.el.isConnected && message.text === text };
  const nav = N.create({ core: C, reader, document: doc, getConversation: () => conversation,
    waitForLayout: async () => { if (scrollDuringLayout != null) scrollTop = scrollDuringLayout; },
    nextFrame: async () => { frames++; if (replaceBeforeScroll && frames === 1) replace(); if (switchConversation && frames === 1) conversation = "c:other"; } });
  return { nav, note, entry, get question() { return current; }, get replacements() { return replacements; }, get top() { return scrollTop; },
    scroll(top, user = false) {
      if (user) listeners.get("wheel")?.({ type: "wheel", target: scroller });
      scroller.scrollTo({ top });
      listeners.get("scroll")?.({ type: "scroll", target: doc });
    } };
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
test("a footer archive retains the exact live question after the original answer is unmounted", async t => {
  const s = scenario({ answerUnloaded: true });
  t.after(() => s.nav.cancel());
  const result = await s.nav.jump(s.note, s.entry, { questionOnly: true, alignQuestion: true, anchor: s.nav.capturePair(s.question) });
  assert.equal(result.code, "located");
  assert.equal(result.questionIndex, s.question.index);
  assert.equal(result.historySteps, undefined);
});
test("late site scrolling preserves the footer's question until the user scrolls", async t => {
  const s = scenario({ startAt: 1300 });
  t.after(() => s.nav.cancel());
  const result = await s.nav.jump(s.note, s.entry, { questionOnly: true, alignQuestion: true, anchor: s.nav.capturePair(s.question) });
  assert.equal(result.code, "located");
  const aligned = s.top;
  s.scroll(0);
  await Promise.resolve();
  assert.equal(s.top, aligned);
  assert.equal(s.nav.diagnostic().landingCorrections, 1);
  s.scroll(500, true);
  await Promise.resolve();
  assert.equal(s.top, 500);
});
test("a footer can align a question within a reversed scroll container", async () => {
  const s = scenario({ reversed: true, startAt: -300 });
  const result = await s.nav.jump(s.note, s.entry, { questionOnly: true, alignQuestion: true });
  assert.equal(result.code, "located");
  assert.ok(s.top < -3000);
  assert.ok(result.afterTop >= 0 && result.afterTop <= 90);
});
test("restoring an answer keeps the exact question at its previous viewport position when the page scrolls during reflow", async () => {
  const s = scenario({ startAt: 1300, scrollDuringLayout: 1000 });
  const result = await s.nav.jump(s.note, s.entry);
  assert.equal(result.code, "located");
  assert.equal(result.questionIndex, s.question.index);
  assert.equal(s.top, 1300);
  assert.equal(result.beforeTop, result.afterTop);
});
test("an explicit lookup goes straight to the question when the exact pair is already loaded", async () => {
  const s = scenario();
  const result = await s.nav.jump(s.note, s.entry, { searchHistory: true, alignQuestion: true });
  assert.equal(result.code, "located");
  assert.equal(result.questionIndex, s.question.index);
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

function historyScenario({ direction = "older", nested = false, missing = false, cancel = false, changeConversation = false,
  duplicate = false, interruptAtEdge = false, reversed = false, fallbackOnly = false, shiftOnSweep = false } = {}) {
  let top = direction === "older" && !reversed ? 3200 : 0, clock = 100, ready = false, waits = 0, conversation = "c:test";
  let height = 5000, shifted = false, reachedNewEnd = false;
  if (interruptAtEdge) top = 0;
  const initial = top, moves = [], updates = [];
  const scroller = { isConnected: true, get scrollHeight() { return height; }, clientHeight: 800, clientTop: 0, parentElement: null,
    get scrollTop() { return top; }, scrollLeft: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
    scrollTo({ top: next }) { top = reversed ? Math.max(800 - height, Math.min(0, next)) : Math.max(0, Math.min(height - 800, next)); moves.push(top); } };
  const docRoot = nested ? { isConnected: true, scrollHeight: 800, clientHeight: 800, scrollTop: 0, scrollTo() {} } : scroller;
  const doc = { scrollingElement: docRoot, defaultView: { innerHeight: 800,
    getComputedStyle: () => ({ overflowY: "auto", flexDirection: reversed ? "column-reverse" : "column" }) } };
  const note = { id: "n", conversation };
  const entry = { userText: "为什么？", question: "为什么？", userMessageId: fallbackOnly ? "fallback:original" : "native-question" };
  let targetTop = reversed ? -4000 : direction === "older" ? 180 : 2600;
  const el = { isConnected: true, ownerDocument: doc, parentElement: scroller,
    getBoundingClientRect: () => ({ top: targetTop - top, bottom: targetTop + 40 - top, height: 40, width: 600 }) };
  const question = { id: duplicate || fallbackOnly ? "fallback:user:reloaded" : entry.userMessageId, role: "user", text: entry.userText, index: 7, el, turn: el };
  const duplicateEl = { ...el };
  const repeated = { ...question, id: "fallback:user:duplicate", el: duplicateEl, turn: duplicateEl };
  const tailEl = { isConnected: true, ownerDocument: doc, parentElement: scroller,
    getBoundingClientRect: () => ({ top: -top - 100, bottom: -top - 50, width: 600, height: 50 }) };
  const tail = { id: "tail", role: "assistant", text: "其他回答", el: tailEl, turn: tailEl, index: 8 };
  if (shiftOnSweep) entry.answer = tail.text;
  const read = () => [...(ready ? duplicate ? [question, repeated] : [question] : []), tail];
  const range = message => ({ startContainer: { parentElement: message.el }, getClientRects: () => [message.el.getBoundingClientRect()] });
  const nav = N.create({ core: C, reader: { read, range }, document: doc, getConversation: () => conversation, now: () => clock, waitForLayout: async () => {},
    nextFrame: async () => { if (interruptAtEdge) { nav.cancel({ restorePosition: false }); top = 733; } }, onUpdate: status => updates.push(status.code),
    waitForHistory: async (_, timeout) => {
      clock += timeout; waits++;
      if (cancel && waits === 2) nav.cancel();
      if (changeConversation && waits === 2) conversation = "c:other";
      if (shiftOnSweep && ready && top > 1500 && !shifted) {
        height = 9000;
        targetTop = 2700;
        shifted = true;
      }
      if (shifted) {
        if (top >= height - scroller.clientHeight) reachedNewEnd = true;
        ready = reachedNewEnd && Math.abs(top - targetTop) < 500;
      } else if (!missing && (reversed ? top < -3400 : direction === "older" ? top < 500 : top > 2200)) ready = true;
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
test("a single compatible prompt is located after a complete scan even if the old answer no longer matches", async () => {
  const s = historyScenario({ fallbackOnly: true });
  const result = await s.nav.jump(s.note, s.entry, { searchHistory: true });
  assert.equal(result.code, "located");
  assert.equal(result.questionIndex, 7);
  assert.equal(result.historyMatch, "unique-question");
  assert.equal(result.historyCandidates, 1);
  assert.ok(s.moves.some(top => top <= 1) && s.moves.some(top => top >= 4199));
});
test("a verified pair is rediscovered when both saved offsets miss the shifted history window", async () => {
  const s = historyScenario({ fallbackOnly: true, shiftOnSweep: true });
  const result = await s.nav.jump(s.note, s.entry, { searchHistory: true });
  assert.equal(result.code, "located");
  assert.equal(result.questionIndex, 7);
  assert.equal(result.historyMatch, "complete-pair");
  assert.ok(result.returnSteps > 0);
  assert.ok(result.inView);
});
test("history starts by loading older messages when the reverse scroller is at its newest edge", async () => {
  const s = historyScenario({ reversed: true });
  const result = await s.nav.jump(s.note, s.entry, { searchHistory: true });
  assert.equal(result.code, "located");
  assert.equal(result.historyDirection, "older");
  assert.ok(s.moves.some(top => top < -3400));
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
