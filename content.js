(async function () {
  "use strict";
  const SCRIPT_VERSION = "0.2.15";
  if (globalThis.__gptAnswerShelfLoaded) return;
  globalThis.__gptAnswerShelfLoaded = true;
  const runtime = globalThis.__gptAnswerShelf = { status: "starting", error: "" };
  const CHANNEL = "gpt-answer-shelf:";
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (![CHANNEL + "ping", CHANNEL + "open", CHANNEL + "diagnose"].includes(message?.type)) return;
    const ok = runtime.status === "ready";
    if (ok && message.type === CHANNEL + "open") runtime.open();
    respond({
      ok, status: runtime.status, error: runtime.error,
      version: SCRIPT_VERSION, pageScriptVersion: SCRIPT_VERSION,
      ...(ok ? runtime.inspect() : {}),
      ...(ok && message.type === CHANNEL + "diagnose" ? { report: runtime.diagnose() } : {})
    });
  });

  const C = globalThis.GPTStickyCore;
  const R = globalThis.GPTStickyRich;
  const S = globalThis.GPTStickyStorage;
  const PREFIX = S.PREFIX;
  const PREFS = "gpt-sticky:prefs";
  const HOST = "[data-gpt-answer-shelf]";
  const HIDDEN = "gpt-answer-shelf-hidden-turn";
  const state = {
    notes: new Map(), key: C.conversationKey(location.href), active: null, query: "",
    messages: [], questionActions: new Map(), answerActions: new Map(), saving: new Set(), hiddenTurns: new Set(),
    hideLinked: true, wide: false, timer: null, sidebarSignature: "", nativeAnswer: null, recentArchive: null, waitingForCompletion: false
  };
  const conversation = () => C.conversationKey(location.href);
  const currentNotes = () => [...state.notes.values()].filter(note => note.conversation === state.key && C.isArchive(note) && !note.deletedAt);
  const entryOf = note => note.exchanges[0];
  const archiveNotes = () => currentNotes().filter(note => C.isArchived(entryOf(note)));
  const reader = globalThis.GPTStickyMessages.create({ core: C, getNotes: currentNotes });
  const readMessages = reader.read;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function view(tag, attrs, ...children) {
    const node = el(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value === true ? "" : value);
    node.append(...children);
    return node;
  }
  function button(text, action, style = "quiet") {
    const control = el("button", text, style);
    control.type = "button";
    control.addEventListener("click", async event => {
      if (control.disabled) return;
      control.disabled = true;
      try { await action(event); }
      catch (error) { toast("操作失败：" + error.message); }
      finally { control.disabled = false; }
    });
    return control;
  }
  function theme(host) {
    const html = document.documentElement;
    host.dataset.theme = html.classList.contains("dark") || html.dataset.theme === "dark" || getComputedStyle(html).colorScheme === "dark" ? "dark" : "light";
  }
  function shadowHost(kind) {
    const host = el("div");
    host.dataset.gptAnswerShelf = kind;
    const root = host.attachShadow({ mode: "open" });
    root.append(el("style", globalThis.GPTStickyStyles));
    theme(host);
    return { host, root };
  }

  const ui = shadowHost("portal");
  document.documentElement.append(ui.host);
  ui.root.append(
    view("button", { class: "launcher", type: "button", "aria-label": "打开收纳目录" }, "收纳 ", view("span", { id: "count" }, "0")),
    view("section", { class: "panel", popover: "manual", hidden: true, "aria-label": "GPT 回答收纳" },
      view("div", { class: "panel-head" },
        view("div", { class: "row between" },
          view("span", { class: "title", id: "panel-title" }, "收纳目录"),
          view("div", { class: "row" },
            view("button", { class: "quiet", id: "wide", type: "button", hidden: true }, "宽窗口"),
            view("button", { class: "quiet", id: "close", type: "button", "aria-label": "关闭收纳侧栏" }, "收起"))),
        view("div", { id: "directory-head" },
          view("input", { class: "search", id: "search", type: "search", placeholder: "搜索问句或回答", "aria-label": "搜索收纳" }),
          view("label", { class: "check" }, view("input", { id: "hide-linked", type: "checkbox", checked: true }), " 在主对话中收起已收纳的回答"),
          view("div", { class: "row backup-actions" },
            view("button", { class: "quiet", id: "export", type: "button" }, "导出备份"),
            view("button", { class: "quiet", id: "import", type: "button" }, "导入备份"))),
        view("div", { class: "row", id: "detail-head", hidden: true },
          view("button", { class: "quiet", id: "back", type: "button" }, "‹ 返回收纳目录"),
          view("button", { class: "btn", id: "restore", type: "button" }, "放回主对话")),
        view("input", { id: "import-file", type: "file", accept: "application/json,.json", hidden: true })),
      view("div", { class: "panel-body", tabindex: "0", "aria-label": "收纳的问答" })),
    view("div", { class: "toast", popover: "manual", role: "status", hidden: true })
  );
  const $ = selector => ui.root.querySelector(selector);
  const panel = $(".panel"), body = $(".panel-body");
  const media = globalThis.GPTStickyMedia.create({ root: ui.root, rich: R });
  const nativeView = globalThis.GPTStickyNative.create({ viewport: body,
    onChange: () => { state.sidebarSignature = ""; schedule(); },
    onOpenMedia: (event, turn) => media.openNative(event, turn), onPromote: () => media.raise()
  });
  const reading = globalThis.GPTStickyReading.create({ getConversation: conversation, resolve: note => {
    const options = optionsForNote(note);
    let question = C.questionForEntry(entryOf(note), state.messages, options);
    if (!question?.el.isConnected) question = C.questionForEntry(entryOf(note), readMessages(), options);
    return question ? { node: question.turn, rect: () => question.el.getBoundingClientRect() } : null;
  } });
  const panelPosition = globalThis.GPTStickyPanel.create({ panel, handle: $(".panel-head > .row.between"), onMove: () => nativeView.layout() });
  let historyToast = "";
  const navigation = globalThis.GPTStickyNavigation.create({
    core: C, reader, getConversation: conversation,
    onUpdate: result => {
      if (result.code === "loading-history" && historyToast !== result.message) {
        historyToast = result.message;
        toast(result.message, button("停止查找", () => navigation.cancel()));
      }
    }
  });

  let toastTimer;
  function toast(text, action) {
    clearTimeout(toastTimer);
    const notice = $(".toast");
    const row = view("div", { class: "row" }, el("span", text));
    if (action) row.append(action);
    notice.replaceChildren(row);
    notice.hidden = false;
    try { if (!notice.matches(":popover-open")) notice.showPopover(); } catch {}
    if (text !== historyToast) toastTimer = setTimeout(() => {
      try { if (notice.matches(":popover-open")) notice.hidePopover(); } catch {}
      notice.hidden = true;
    }, action ? 9000 : 5000);
  }
  function positionCard() {
    const detailed = Boolean(state.active);
    const width = Math.min(innerWidth - 24, !detailed ? 400 : state.wide ? Math.max(860, nativeView.width + 48) : 560);
    const height = Math.min(innerHeight - 32, Math.max(400, innerHeight * (detailed && state.wide ? .94 : .8)));
    panelPosition.place({ width, height });
    panel.classList.toggle("answer-card", detailed);
    nativeView.layout();
  }
  function openPanel(noteId = null) {
    navigation.cancel({ restorePosition: false });
    reading.release({ restorePosition: false });
    state.active = noteId;
    if (noteId) reading.capture(state.notes.get(noteId));
    panel.hidden = false;
    try { if (!panel.matches(":popover-open")) panel.showPopover(); } catch {}
    state.sidebarSignature = "";
    renderSidebar();
    body.scrollTop = 0;
    nativeView.layout();
    reading.restore();
  }
  function closePanel({ restorePosition = true } = {}) {
    media.close();
    reading.release({ restorePosition });
    nativeView.clear();
    try { if (panel.matches(":popover-open")) panel.hidePopover(); } catch {}
    panel.hidden = true;
    state.active = null;
    state.sidebarSignature = "";
    hideTurns();
  }

  function acceptNote(note) {
    if ((C.isArchive(note) || note?.schema === 1 && note.deletedAt)
        && S.revision(note) >= S.revision(state.notes.get(note.id))) state.notes.set(note.id, note);
  }
  async function storeRequest(request) {
    const response = await chrome.runtime.sendMessage({ type: CHANNEL + "store", ...request });
    if (response?.ok) return response;
    if (response?.current) acceptNote(response.current);
    schedule();
    throw new Error(response?.error || "收纳扩展未响应，请重新加载扩展并刷新网页。");
  }
  async function saveNote(note, { restore = false, expectedRevision = S.revision(note) } = {}) {
    const response = await storeRequest({ operation: restore ? "restore" : "save", note, expectedRevision });
    acceptNote(response.note);
    schedule();
    return response.note;
  }
  function optionsForNote(note) {
    return state.recentArchive?.id === note.id ? state.recentArchive.anchor.options : undefined;
  }
  async function restoreAnswer(noteId, anchor) {
    const note = state.notes.get(noteId);
    if (!C.isArchive(note) || note.deletedAt || !C.isArchived(entryOf(note)) || note.conversation !== conversation()) return;
    navigation.cancel({ restorePosition: false });
    const updated = structuredClone(note);
    const entry = entryOf(updated);
    entry.placement = "main";
    // The main conversation has the original. Release the stored rich snapshot.
    delete entry.answerDocument;
    await saveNote(updated);
    if (note.conversation !== conversation()) return;
    if (state.recentArchive?.id === noteId) state.recentArchive = null;
    closePanel({ restorePosition: false });
    const result = await navigation.jump(note, entry, anchor ? { anchor } : undefined);
    historyToast = "";
    if (note.conversation !== conversation()) return;
    if (result.code === "located" || result.code === "cancelled") {
      toast("回答已放回主对话。");
      return;
    }
    toast("已放回主对话。原问答暂未定位。", button("查找原问答", async () => {
      const located = await navigation.jump(note, entry, { searchHistory: true, alignQuestion: true, anchor });
      historyToast = "";
      if (note.conversation === conversation()) toast(located.message);
    }));
  }

  function linkedAnswers(messages) {
    const linked = new Map();
    for (const note of currentNotes()) {
      const entry = entryOf(note), pair = C.findLinkedPair(entry, messages, optionsForNote(note));
      if (!pair) continue;
      const current = linked.get(pair.answer);
      if (!current || C.isArchived(entry)) linked.set(pair.answer, note);
    }
    return linked;
  }
  function answerForQuestion(question, messages) {
    if (!C.normalize(question?.text)) return null;
    const answer = C.responseAfter(question, messages);
    if (!answer || answer.turn.contains(question.turn) || C.isLoadError(answer.text)) return null;
    return answer.text || answer.kind === "image" ? answer : null;
  }
  function hasActiveStopControl() {
    const generic = 'button[aria-label="Stop"], button[aria-label="停止"]';
    const controls = 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="停止生成"], button[aria-label="停止回答"], ' + generic;
    return [...document.querySelectorAll(controls)].some(node => {
      if (node.disabled || node.getAttribute("aria-disabled") === "true") return false;
      if (!node.getClientRects().length || node.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(node);
      if (style.visibility !== "visible") return false;
      for (let element = node; element; element = element.parentElement) {
        if (getComputedStyle(element).opacity === "0") return false;
      }
      if (!node.matches(generic) || node.dataset.testid === "stop-button") return true;
      return Boolean(node.closest('form, [data-testid="composer"], [data-testid="composer-container"], .composer')
        ?.querySelector('[contenteditable="true"], textarea'));
    });
  }
  function streamingAnswer(messages) {
    const latest = messages.findLast(message => message.role === "user" || message.role === "assistant");
    return latest?.role === "assistant" && hasActiveStopControl() ? latest : null;
  }
  async function useQuestionAction(expected, { alignQuestion = false } = {}) {
    const key = state.key;
    function resolve() {
      const messages = readMessages();
      const user = messages.find(item => item.role === "user" && item.el === expected.user.el && item.id === expected.user.id && item.text === expected.user.text);
      const answer = answerForQuestion(user, messages);
      if (!key || conversation() !== key || !answer || answer.el !== expected.answer.el
          || answer.id !== expected.answer.id || answer.text !== expected.answer.text || answer.mediaKey !== expected.answer.mediaKey) {
        throw new Error("这组问答已变化，请在主对话中重新选择。");
      }
      return { user, answer, messages };
    }
    const { user, answer, messages } = resolve();
    const linked = linkedAnswers(messages).get(answer);
    if (linked && C.isArchived(entryOf(linked))) {
      state.messages = messages;
      hideTurns();
      openPanel(linked.id);
      return;
    }
    if (streamingAnswer(messages) === answer || !reader.canArchive(answer)) {
      throw new Error("回答或图片尚未加载完成，请稍后再收纳。");
    }
    navigation.cancel({ restorePosition: false });
    reading.release({ restorePosition: false });
    const answerDocument = await R.materialize(reader.captureResult(answer, R));
    const latest = resolve();
    if (streamingAnswer(latest.messages) === latest.answer || !reader.canArchive(latest.answer)) throw new Error("网页还在准备这条回答，请稍后再收纳。");
    const existing = linkedAnswers(latest.messages).get(latest.answer);
    if (existing && C.isArchived(entryOf(existing))) return;
    const createdAt = Date.now();
    const entry = {
      id: existing ? entryOf(existing).id : crypto.randomUUID(),
      question: user.text, userText: user.text, answer: answer.text, answerDocument,
      userMessageId: user.id, answerMessageId: answer.id, placement: "sidebar", status: "saved", createdAt,
      ...(latest.user.collapsed ? { userTextCollapsed: true } : {}),
      ...(answer.kind === "image" ? { responseKind: "image", mediaKey: answer.mediaKey } : {})
    };
    if (!C.hasAnswer(entry)) throw new Error("回答尚未保存成功。");
    const anchor = navigation.capturePair(latest.user, latest.answer, latest.messages);
    if (C.findLinkedPair(entry, latest.messages, anchor.options)?.answer !== latest.answer) {
      throw new Error("当前网页有重复问答，暂时无法准确收纳这一条。");
    }
    const id = existing?.id || ["archive", C.hash(user.id), C.hash(answer.id), C.hash(user.text), C.hash(answer.text + (answer.mediaKey || ""))].join(":");
    const previous = state.notes.get(id);
    const note = { schema: 1, mode: "archive", id, conversation: key, createdAt: existing?.createdAt || createdAt,
      updatedAt: createdAt, deletedAt: null, exchanges: [entry] };
    const nearPair = !alignQuestion && state.hideLinked && (navigation.isVisible(latest.user.el)
      || navigation.isVisible(latest.answer.turn) || navigation.isVisible(latest.answer.el));
    await saveNote(note, { restore: Boolean(previous?.deletedAt), expectedRevision: S.revision(existing || (previous?.deletedAt ? previous : null)) });
    if (key !== conversation()) return;
    state.recentArchive = { id, anchor };
    sync();
    toast("回答已收进侧栏。", button("撤销", () => restoreAnswer(id, anchor)));
    const mountedAnswer = C.storedAnswer(entry, state.messages, anchor.options);
    if (alignQuestion || nearPair && state.hiddenTurns.has(mountedAnswer?.turn)) {
      navigation.jump(note, entry, { questionOnly: true, alignQuestion, anchor });
    }
  }
  async function activateArchiveAction(pair, options) {
    const turn = pair.answer.turn;
    if (state.saving.has(turn)) return;
    state.saving.add(turn);
    try { await useQuestionAction(pair, options); }
    finally { state.saving.delete(turn); }
  }
  function mountArchiveActions(kind, actions, wanted) {
    for (const [turn, item] of wanted) {
      let mounted = actions.get(turn);
      if (!mounted?.host.isConnected) {
        mounted = shadowHost(kind);
        mounted.control = button("", event => {
          event.stopPropagation();
          return activateArchiveAction(mounted.pair, { alignQuestion: kind === "answer" });
        }, "answer-action");
        mounted.root.append(view("div", { class: kind === "question" ? "question-actions" : "answer-actions" }, mounted.control));
        turn.append(mounted.host);
        actions.set(turn, mounted);
      }
      mounted.pair = item.pair;
      const label = item.archived ? "查看回答" : "收进侧栏";
      if (mounted.control.textContent !== label) {
        mounted.control.textContent = label;
        mounted.control.classList.toggle("archived", item.archived);
      }
      theme(mounted.host);
    }
    for (const [turn, mounted] of actions) {
      if (wanted.has(turn)) continue;
      mounted.host.remove();
      actions.delete(turn);
    }
  }
  function renderArchiveActions() {
    const questions = new Map(), footers = new Map();
    const streaming = state.key ? streamingAnswer(state.messages) : null;
    state.waitingForCompletion = Boolean(streaming);
    if (state.key) {
      const linked = linkedAnswers(state.messages);
      for (const user of state.messages) {
        if (user.role !== "user") continue;
        const answer = answerForQuestion(user, state.messages);
        if (!answer) continue;
        const note = linked.get(answer), archived = Boolean(note && C.isArchived(entryOf(note)));
        if (!archived && (answer === streaming || !reader.canArchive(answer))) continue;
        const item = { pair: { user, answer }, archived };
        questions.set(user.turn, item);
        if (!archived) footers.set(answer.turn, item);
      }
    }
    mountArchiveActions("question", state.questionActions, questions);
    mountArchiveActions("answer", state.answerActions, footers);
  }
  function hideTurns() {
    const hidden = new Set();
    if (state.hideLinked) {
      const questions = state.messages.filter(message => message.role === "user");
      for (const note of archiveNotes()) {
        const answer = C.storedAnswer(entryOf(note), state.messages, optionsForNote(note));
        if (answer && !questions.some(question => answer.turn.contains(question.turn))) hidden.add(answer.turn);
      }
    }
    for (const node of state.hiddenTurns) if (!hidden.has(node)) node.classList.remove(HIDDEN);
    for (const node of hidden) if (!node.classList.contains(HIDDEN)) node.classList.add(HIDDEN);
    state.hiddenTurns = hidden;
  }
  function renderSidebar() {
    const notes = archiveNotes();
    $("#count").textContent = String(notes.length);
    $("#hide-linked").checked = state.hideLinked;
    if (panel.hidden) return;
    const note = notes.find(item => item.id === state.active);
    if (!note) state.active = null;
    const positions = new Map(note ? [] : notes.map(item => [item.id, C.questionForEntry(entryOf(item), state.messages, optionsForNote(item))?.index ?? Infinity]));
    if (!note) notes.sort((a, b) => positions.get(a.id) - positions.get(b.id) || a.createdAt - b.createdAt);
    const entry = note && entryOf(note);
    const answer = entry && C.storedAnswer(entry, state.messages, optionsForNote(note));
    const native = answer && state.hiddenTurns.has(answer.turn) ? answer : null;
    const signature = [state.key, state.active, state.query, ui.host.dataset.theme, state.hideLinked,
      note ? note.updatedAt : notes.map(item => item.id + ":" + item.updatedAt).join("|")].join(":");
    if (signature === state.sidebarSignature && state.nativeAnswer === native?.el) return;
    state.sidebarSignature = signature;
    state.nativeAnswer = native?.el;
    const scrollTop = body.scrollTop;
    $("#panel-title").textContent = note ? "收纳的回答" : "收纳目录";
    $("#directory-head").hidden = Boolean(note);
    $("#detail-head").hidden = !note;
    $("#wide").hidden = !note;
    $("#wide").textContent = state.wide ? "恢复小窗" : "宽窗口";
    body.replaceChildren();
    if (!note) {
      nativeView.clear();
      const needle = C.normalize(state.query).toLowerCase();
      const filtered = notes.filter(item => C.normalize(entryOf(item).question + " " + entryOf(item).answer).toLowerCase().includes(needle));
      if (!filtered.length) body.append(el("p", !state.key ? "打开一段 ChatGPT 对话。" : notes.length ? "没有找到匹配的问答。" : "在问句旁点击「收进侧栏」。", "empty"));
      for (const item of filtered) {
        const control = button("", () => openPanel(item.id), "directory-item");
        control.append(el("span", entryOf(item).question, "text"));
        body.append(control);
      }
    } else {
      body.append(el("div", "问：" + entry.question, "question text target-question"));
      const slot = el("div", null, "native-slot");
      const backup = el("div", null, "backup-answer");
      body.append(slot, backup);
      const mounted = native && nativeView.reconcile([{ slot, message: native }]).has(slot);
      slot.hidden = !mounted;
      backup.hidden = Boolean(mounted);
      if (!mounted) {
        nativeView.clear();
        backup.append(el("div", "收纳备份", "muted backup-label"));
        if (R.hasContent(entry.answerDocument)) {
          const rendered = el("div", null, "answer rich");
          rendered.append(R.render(entry.answerDocument, document, { onOpenMedia: node => media.open(node) }));
          backup.append(rendered);
        } else backup.append(el("div", entry.answer, "answer"));
      }
    }
    body.scrollTop = scrollTop;
    positionCard();
    reading.pin();
  }

  $(".launcher").addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
  $("#close").addEventListener("click", () => closePanel());
  $("#back").addEventListener("click", () => openPanel());
  $("#wide").addEventListener("click", () => {
    state.wide = !state.wide;
    $("#wide").textContent = state.wide ? "恢复小窗" : "宽窗口";
    positionCard();
  });
  $("#search").addEventListener("input", event => { state.query = event.target.value; renderSidebar(); });
  $("#hide-linked").addEventListener("change", async event => {
    const hideLinked = event.target.checked;
    try { await chrome.storage.local.set({ [PREFS]: { hideLinked } }); state.hideLinked = hideLinked; }
    catch { toast("设置保存失败，请重试。"); }
    schedule();
  });
  $("#restore").addEventListener("click", async event => {
    const control = event.currentTarget;
    if (control.disabled) return;
    control.disabled = true;
    try { await restoreAnswer(state.active); }
    catch (error) { toast("操作失败：" + error.message); }
    finally { control.disabled = false; }
  });
  $("#export").addEventListener("click", () => {
    const backup = { format: "gpt-answer-shelf-backup", version: 1, notes: archiveNotes() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json;charset=utf-8" }));
    const link = el("a"); link.href = url; link.download = "GPT回答收纳-" + new Date().toISOString().slice(0, 10) + ".json";
    ui.root.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $("#import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > C.BACKUP_MAX_BYTES) throw new Error("备份超过 64 MB，请拆分后导入。");
      const data = JSON.parse(await file.text());
      if (!["gpt-answer-shelf-backup", "gpt-sticky-backup"].includes(data.format) || data.version !== 1 || !Array.isArray(data.notes)) throw new Error("这不是支持的收纳备份。");
      const notes = data.notes.filter(C.isArchive).map(C.sanitizeNote);
      if (!notes.length) throw new Error("文件里没有可导入的收纳记录。");
      const response = await storeRequest({ operation: "import", notes });
      for (const note of response.notes) acceptNote(note);
      schedule();
      toast("已导入 " + response.notes.length + " 条收纳记录。");
    } catch (error) { toast("导入失败：" + error.message); }
    finally { event.target.value = ""; }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden && !media.isOpen) closePanel();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (key.startsWith(PREFIX)) {
        if (change.newValue) acceptNote(change.newValue);
        else if (change.oldValue) state.notes.delete(change.oldValue.id);
      }
      if (key === PREFS && typeof change.newValue?.hideLinked === "boolean") state.hideLinked = change.newValue.hideLinked;
    }
    schedule();
  });
  try {
    const saved = await chrome.storage.local.get(null);
    for (const [key, note] of Object.entries(saved)) if (key.startsWith(PREFIX)) acceptNote(note);
    if (typeof saved[PREFS]?.hideLinked === "boolean") state.hideLinked = saved[PREFS].hideLinked;
  } catch (error) { toast("收纳存储暂不可用：" + error.message); }

  function schedule() {
    if (!state.timer) state.timer = setTimeout(() => { state.timer = null; sync(); }, 160);
  }
  const observer = new MutationObserver(records => {
    const nativeRecords = records.filter(record => !nativeView.isOwnMutation(record) && !record.target.closest?.(HOST));
    if (!nativeRecords.length) return;
    reader.invalidate(nativeRecords);
    navigation.checkLanding();
    schedule();
  });
  const observation = { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["class", "style", "hidden", "inert", "role", "src", "srcset", "alt", "title", "disabled", "aria-label", "aria-describedby", "aria-hidden", "aria-disabled", "aria-busy", "aria-expanded", "data-testid", "data-theme", "data-is-streaming", "data-message-author-role", "data-message-role", "data-message-id", "data-turn", "data-turn-id"] };
  let roots = new Set();
  function mediaLoaded(event) {
    if (event.target.matches?.("img,iframe") && !event.target.closest(HOST)) schedule();
  }
  function observe() {
    const next = reader.roots(state.messages);
    if (next.size === roots.size && [...next].every(node => roots.has(node))) return;
    observer.disconnect();
    for (const node of roots) node.removeEventListener("load", mediaLoaded, true);
    for (const node of next) { observer.observe(node, observation); node.addEventListener("load", mediaLoaded, true); }
    roots = next;
  }
  function sync() {
    if (!ui.host.isConnected) document.documentElement.append(ui.host);
    const key = conversation();
    if (key !== state.key) {
      navigation.cancel({ restorePosition: false });
      state.recentArchive = null;
      closePanel({ restorePosition: false });
      state.key = key;
      state.query = "";
      $("#search").value = "";
    }
    state.messages = readMessages();
    observe();
    theme(ui.host);
    hideTurns();
    renderArchiveActions();
    renderSidebar();
    nativeView.layout();
    reading.pin();
    navigation.checkLanding();
  }
  setInterval(() => {
    // A CSS transition can hide the Stop button without a DOM mutation once
    // the response finishes. Only check the control while a reply is waiting.
    if (conversation() !== state.key || state.waitingForCompletion && !document.hidden && !hasActiveStopControl()) schedule();
  }, 700);
  window.addEventListener("popstate", schedule);
  window.addEventListener("resize", () => { if (!panel.hidden) positionCard(); schedule(); });
  sync();
  runtime.inspect = () => ({
    uiMounted: ui.host.isConnected && Boolean($(".launcher").getClientRects().length),
    uiInstances: document.querySelectorAll('[data-gpt-answer-shelf="portal"]').length,
    conversationReady: Boolean(conversation()), questionCount: state.questionActions.size,
    answerButtonCount: state.answerActions.size, recognizedQuestions: state.messages.filter(message => message.role === "user").length,
    assistantCount: state.messages.filter(message => message.role === "assistant").length
  });
  runtime.open = () => {
    if (!ui.host.isConnected) document.documentElement.append(ui.host);
    openPanel();
  };
  runtime.diagnose = () => ({
    version: SCRIPT_VERSION, host: location.hostname, ...runtime.inspect(),
    archivedCount: archiveNotes().length, hiddenCount: state.hiddenTurns.size, nativeViews: nativeView.count,
    structures: Object.fromEntries(['[data-message-author-role]', '[data-message-role]', '[data-turn]', 'article', '[class*="MarkdownRoot-"]', '[class*="block-"]'].map(selector => [selector, document.querySelectorAll(selector).length])),
    navigation: navigation.diagnostic()
  });
  runtime.status = "ready";
})().catch(error => {
  if (globalThis.__gptAnswerShelf) {
    globalThis.__gptAnswerShelf.status = "error";
    globalThis.__gptAnswerShelf.error = error.message || String(error);
  }
  globalThis.__gptAnswerShelfLoaded = false;
  console.error("[GPT 回答收纳]", error);
});
