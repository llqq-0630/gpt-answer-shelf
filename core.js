(function (root) {
  "use strict";
  const normalize = value => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const sameText = (a, b) => normalize(a) === normalize(b);
  const clip = (value, length) => String(value || "").slice(0, length);
  const text = value => typeof value === "string" ? value : "";
  const BACKUP_MAX_BYTES = 64 * 1024 * 1024;
  const isNativeId = id => Boolean(id && !id.startsWith("fallback:") && !/^conversation-turn(?:-|:|$)/.test(id));
  const nativeIdMatches = (saved, current) => isNativeId(saved) && saved === current;
  const compatibleId = (saved, current) => !isNativeId(saved) || !isNativeId(current) || saved === current;
  const isArchive = note => Boolean(note?.schema === 1 && note.mode === "archive"
    && Array.isArray(note.exchanges) && note.exchanges.length === 1
    && note.exchanges[0] && typeof note.exchanges[0] === "object");
  const hasAnswer = entry => !isLoadError(entry.answer) && Boolean(normalize(entry.answer)
    || entry.hasStoredDocument === true || root.GPTStickyRich?.hasContent(entry.answerDocument));
  const isArchived = entry => Boolean(entry && entry.placement === "sidebar" && hasAnswer(entry));

  function hash(value) {
    let result = 2166136261;
    for (const char of normalize(value)) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }
  function conversationKey(url) {
    try {
      const match = new URL(url).pathname.match(/\/(c|share)\/([^/]+)/);
      return match ? match[1] + ":" + match[2] : null;
    } catch { return null; }
  }
  function isLoadError(value) {
    return /^(?:this response (?:couldn['’]?t load|could not be loaded)|unable to load (?:this |the )?response|something went wrong|an error occurred while generating (?:a|the|this) response|error in message stream|无法加载(?:此|该)?回答|(?:此|该)?回答(?:无法加载|加载失败)|生成(?:此|该)?回答时出错)[.!。！]?(?:\s*(?:retry|try again|重试|重新加载)[.!。！]?)?$/i.test(normalize(value));
  }
  function responseAfter(user, messages) {
    const index = messages.indexOf(user);
    if (index < 0) return null;
    let answer = null;
    for (let i = index + 1; i < messages.length; i++) {
      if (messages[i].role === "user" || messages[i].role === "boundary") break;
      if (messages[i].role === "assistant") answer = messages[i];
    }
    return answer;
  }
  function matchesAnswer(entry, message) {
    if (!sameText(message.text, entry.answer) || isLoadError(message.text)) return false;
    return entry.responseKind === "image"
      ? message.kind === "image" && message.mediaKey === entry.mediaKey
      : message.kind !== "image";
  }
  function findLinkedPair(entry, messages, { matchFallback } = {}) {
    const pairs = questionsForEntry(entry, messages, { allowPreview: true })
      .map(user => ({ user, answer: responseAfter(user, messages) }))
      .filter(pair => pair.answer && matchesAnswer(entry, pair.answer)
        && compatibleId(entry.answerMessageId, pair.answer.id));
    const native = pairs.find(pair => nativeIdMatches(entry.userMessageId, pair.user.id)
      || nativeIdMatches(entry.answerMessageId, pair.answer.id));
    if (native) return native;
    const eligible = matchFallback ? pairs.filter(pair => matchFallback(pair, messages)) : pairs;
    return eligible.length === 1 ? eligible[0] : null;
  }
  const previewPrefix = value => value
    .replace(/\s+(?:show more(?: of (?:the|this|your) message)?|显示更多|展开(?:全部|消息)?)$/i, "")
    .replace(/\s*(?:…|\.{3})$/, "").trimEnd();
  function questionsForEntry(entry, messages, { allowPreview = false } = {}) {
    const saved = normalize(entry?.userText);
    if (!saved) return [];
    return messages.filter(message => {
      if (message.role !== "user" || !compatibleId(entry.userMessageId, message.id)) return false;
      const current = normalize(message.text);
      if (current === saved) return true;
      if (!allowPreview || !current) return false;
      // A folded prompt is used only with an identified turn or a matching
      // complete answer, never as a standalone text match.
      const prefix = message.collapsed && previewPrefix(current);
      const savedPrefix = entry.userTextCollapsed && previewPrefix(saved);
      return Boolean(prefix && saved.startsWith(prefix) || savedPrefix && current.startsWith(savedPrefix));
    });
  }
  function questionForEntry(entry, messages, options) {
    const users = questionsForEntry(entry, messages, { allowPreview: true });
    const native = users.find(message => nativeIdMatches(entry.userMessageId, message.id));
    if (native) return native;
    // A confirmed live slot can survive a redraw of the answer. Otherwise
    // identical wording alone cannot identify a question in a partial page.
    const scoped = options?.matchQuestion && users.filter(options.matchQuestion);
    if (scoped?.length === 1) return scoped[0];
    return findLinkedPair(entry, messages, options)?.user || null;
  }
  function storedAnswer(entry, messages, options) {
    if (!entry) return null;
    const pair = findLinkedPair(entry, messages, options);
    if (pair) return pair.answer;
    const candidates = messages.filter(message => message.role === "assistant" && matchesAnswer(entry, message)
      && compatibleId(entry.answerMessageId, message.id));
    const live = options?.matchAnswer && candidates.find(options.matchAnswer);
    if (live) return live;
    const withQuestion = candidates.filter(message => !normalize(message.priorUserText) || sameText(message.priorUserText, entry.userText));
    const native = withQuestion.find(message => nativeIdMatches(entry.answerMessageId, message.id));
    return native || (!options?.matchFallback && entry.responseKind === "image" && entry.mediaKey && withQuestion.length === 1 ? withQuestion[0] : null);
  }
  function sanitizeNote(raw) {
    if (!isArchive(raw) || !/^\w[\w:-]{0,160}$/.test(raw.id || "") || !/^(c|share):[\w-]{1,160}$/.test(raw.conversation || "")) {
      throw new Error("收纳记录格式不正确。");
    }
    const item = raw.exchanges[0];
    const userText = text(item?.userText), answer = text(item?.answer);
    const answerDocument = root.GPTStickyRich?.sanitize(item?.answerDocument);
    const image = item?.responseKind === "image" && /^[a-z\d]{1,64}$/i.test(item.mediaKey || "");
    if (!normalize(userText) || !hasAnswer({ answer, answerDocument }) || item.responseKind === "image" && !image) {
      throw new Error("收纳记录缺少有效的问句或回答。");
    }
    const now = Date.now();
    return {
      schema: 1, mode: "archive", id: raw.id, conversation: raw.conversation,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
      deletedAt: null,
      exchanges: [{
        id: clip(item.id, 200), question: text(item.question) || userText, userText, answer,
        userMessageId: clip(item.userMessageId, 200), answerMessageId: clip(item.answerMessageId, 200),
        ...(item.userTextCollapsed === true ? { userTextCollapsed: true } : {}),
        ...(answerDocument ? { answerDocument } : {}),
        ...(image ? { responseKind: "image", mediaKey: item.mediaKey } : {}),
        placement: item.placement === "sidebar" ? "sidebar" : "main",
        status: "saved", createdAt: Number.isFinite(item.createdAt) ? item.createdAt : now
      }]
    };
  }
  const api = { BACKUP_MAX_BYTES, normalize, sameText, isNativeId, compatibleId, clip, hash, conversationKey, isArchive, hasAnswer, isArchived, isLoadError, questionsForEntry, questionForEntry, responseAfter, findLinkedPair, storedAnswer, sanitizeNote };
  root.GPTStickyCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
