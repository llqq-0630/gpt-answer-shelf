(function (root) {
  "use strict";
  const EXTENSION_UI = '[data-gpt-answer-shelf], [data-gpt-sticky-host]';
  const TURN = '[data-testid^="conversation-turn-"], [data-turn="assistant"], [data-turn="user"], article[data-turn-id]';
  const BODY = '.markdown, .prose, [data-testid="markdown"], [data-testid="assistant-message"], [class*="MarkdownRoot-"]';
  const STATUS = '[role="status"], [aria-live]';
  const PROGRESS = /^(?:thinking|(?:generating|loading)(?: (?:a |an |the )?(?:answer|response|images?))?|(?:正在|还在)(?:思考|生成|加载)(?:回答|图片|内容)?)[.。…]*$/i;
  const TIMING = /^(?:(?:worked|thought) for\s+\d[\d\s.msh]*|(?:已思考|思考了|耗时)\s*\d[\d\s分秒钟小时]*)$/i;
  function captionRole(turn) {
    const captions = [turn.getAttribute("aria-label")];
    for (const label of turn.querySelectorAll(':scope > .sr-only, h5.sr-only, h6.sr-only')) {
      const owner = label.closest(TURN);
      if ((!owner || owner === turn) && !label.closest(BODY)) captions.push(label.textContent);
    }
    for (const caption of captions) {
      const label = caption?.trim() || "";
      if (/^(?:ChatGPT|Assistant|助手)\s*(?:said|说|：|:)/i.test(label)) return "assistant";
      if (/^(?:You|你|您|用户)\s*(?:said|说|：|:)/i.test(label)) return "user";
    }
    return null;
  }
  function canArchiveReply(message, facts, core = root.GPTStickyCore) {
    if (message?.role !== "assistant" || facts.inProgress || core.isLoadError(message.text)) return false;
    if (message.kind === "image") return facts.loaded > 0 && !facts.pending;
    const text = core.normalize(message.text);
    return Boolean(text && !PROGRESS.test(text) && !TIMING.test(text));
  }
  function classifyImageReply({ user, images, feedback, copy, onlyStatus, textBody, statusText, assistant }) {
    return Boolean(!user && images > 0 && (!textBody || onlyStatus) && (assistant && onlyStatus || feedback || copy && onlyStatus && statusText));
  }
  function imageResource(src) {
    try {
      const url = new URL(src);
      if (!["http:", "https:"].includes(url.protocol)) return src;
      const id = url.searchParams.get("id") || url.searchParams.get("file_id");
      // Signed download URLs may be renewed; the resource ID remains the same.
      return id ? `${url.origin}${url.pathname}?id=${encodeURIComponent(id)}` : src;
    } catch { return src; }
  }
  function create({ core: C = root.GPTStickyCore, getNotes, document = root.document }) {
    let textCache = new WeakMap();
    let resultCache = new WeakMap();
    function inspectResult(turn) {
      if (resultCache.has(turn)) return resultCache.get(turn);
      const images = [], buttons = [];
      let visited = 0; const seen = new Set();
      function visit(node) {
        if (seen.has(node) || ++visited > 5000 || node.nodeType !== 1 || node.matches(EXTENSION_UI)) return;
        seen.add(node);
        if (node.localName === "button") buttons.push(node);
        if (node.localName === "img") {
          const src = node.currentSrc || node.src || "", safe = root.GPTStickyRich?.safeUrl(src, true), rect = node.getBoundingClientRect();
          const large = node.naturalWidth || node.naturalHeight ? node.naturalWidth > 96 || node.naturalHeight > 96 : rect.width > 96 || rect.height > 96;
          if (safe) {
            const style = node.ownerDocument.defaultView.getComputedStyle(node);
            const thumbnail = node.naturalWidth >= 40 && node.naturalHeight >= 40 && (rect.width || parseFloat(style.width) || node.width) >= 40 && (rect.height || parseFloat(style.height) || node.height) >= 40;
            images.push({ node, src: safe, key: imageResource(safe), large, thumbnail, loaded: node.complete && node.naturalWidth > 0, pending: !node.complete });
          }
        }
        const assigned = node.localName === "slot" ? node.assignedElements({ flatten: true }) : [];
        for (const child of new Set([...node.children, ...(node.shadowRoot?.children || []), ...assigned])) visit(child);
      }
      visit(turn);
      const label = button => C.normalize(button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent).toLowerCase();
      const copy = buttons.some(button => button.dataset.testid === "copy-turn-action-button" || /^(?:copy(?: (?:message|response|answer))?|复制(?:消息|回答)?)$/.test(label(button)));
      const feedback = buttons.some(button => /(?:good|bad|like|dislike)[ -]?(?:response|answer|image)|thumbs[ -]?(?:up|down)|(?:good|bad)-response/.test(`${label(button)} ${button.dataset.testid || ""}`) || /^(?:like|dislike|赞|不赞|赞同|不赞同|满意|不满意)$/.test(label(button)));
      const caption = captionRole(turn);
      const user = caption === "user" || turn.matches('[data-turn="user"], [data-message-author-role="user"], [data-message-role="user"]') || Boolean(turn.querySelector('[data-message-author-role="user"], [data-message-role="user"], [data-testid="user-message"], [class*="user-message-bubble"], [contenteditable="true"]'));
      const text = C.normalize(messageText(turn));
      const inProgress = PROGRESS.test(text) || turn.matches('[aria-busy="true"], [data-is-streaming="true"]')
        || Boolean(turn.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"][aria-busy="true"]'));
      const onlyStatus = !text || PROGRESS.test(text) || TIMING.test(text);
      const large = images.filter(image => image.large);
      const originOf = src => { try { return new URL(src).origin; } catch { return ""; } };
      const origins = new Set(large.map(image => originOf(image.src)).filter(origin => origin && origin !== "null"));
      const assets = new Map();
      for (const image of images.filter(image => image.large || image.thumbnail && origins.has(originOf(image.src)))) {
        const previous = assets.get(image.key);
        if (!previous || image.node.naturalWidth * image.node.naturalHeight >= previous.node.naturalWidth * previous.node.naturalHeight) assets.set(image.key, image);
      }
      const media = [...assets.values()];
      const textBody = Boolean(turn.querySelector('.markdown,.prose,[data-testid="markdown"],[class*="MarkdownRoot-"],p,h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,math'));
      const assistant = caption === "assistant" || turn.matches('[data-turn="assistant"], [data-message-author-role="assistant"], [data-message-role="assistant"]') || Boolean(turn.querySelector('[data-message-author-role="assistant"], [data-message-role="assistant"]'));
      const identity = { user, images: large.length, feedback, copy, onlyStatus, statusText: Boolean(text), assistant };
      const result = { images: media, completion: copy || feedback, feedback, copy, user, assistant, onlyStatus, inProgress,
        eligible: classifyImageReply({ ...identity, textBody: false }), kind: classifyImageReply({ ...identity, textBody }) ? "image" : "text",
        mediaKey: media.length ? C.hash(media.map(image => image.key).sort().join("\n")) : "", loaded: media.filter(image => image.loaded).length, pending: media.filter(image => image.pending).length };
      resultCache.set(turn, result); return result;
    }
    function captureResult(message, rich) {
      if (message.kind !== "image" || C.normalize(message.text)) return rich.capture(message.contentEl || message.el);
      const nodes = inspectResult(message.turn).images.map(({ node, src, key }) => {
        rich.rememberImage(node);
        return { tag: "img", ns: "html", assetKey: C.hash(key), attrs: { src, alt: node.alt || "生成的图片", ...(node.hasAttribute("referrerpolicy") ? { referrerpolicy: node.getAttribute("referrerpolicy") } : {}), ...(node.hasAttribute("crossorigin") ? { crossorigin: node.getAttribute("crossorigin") } : {}) }, size: { width: node.naturalWidth || node.width || 768, height: node.naturalHeight || node.height || 768 }, style: { display: "block", "border-radius": "10px" }, children: [] };
      });
      return rich.sanitize({ version: 1, kind: "images", mediaKey: message.mediaKey, nodes });
    }
  function messageText(el, cached = true) {
    if (cached && textCache.has(el)) return textCache.get(el);
    // innerText changes when an ancestor is hidden. Serialize visible content consistently,
    // preserving paragraph/code/table breaks before and after archiving a turn.
    const clone = el.cloneNode(true);
    for (const node of clone.querySelectorAll('button, svg, script, style, .sr-only, .katex-mathml, ' + EXTENSION_UI)) node.remove();
    for (const node of clone.querySelectorAll("br")) node.replaceWith(document.createTextNode("\n"));
    for (const node of clone.querySelectorAll("p, li, pre, h1, h2, h3, h4, h5, h6, blockquote, tr")) node.append(document.createTextNode("\n\n"));
    for (const node of clone.querySelectorAll("td, th")) node.append(document.createTextNode("\t"));
    const text = (clone.textContent || "").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (cached) textCache.set(el, text);
    return text;
  }
  function questionBubble(shell, text) {
    const status = '[role="status"], [role="alert"], [aria-live]';
    if (!text || shell.matches(status) || shell.querySelector(status)) return null;
    const facts = inspectResult(shell);
    if (facts.assistant || facts.feedback) return null;
    const column = shell.parentElement.getBoundingClientRect();
    let bubble = shell;
    while (bubble) {
      const rect = bubble.getBoundingClientRect();
      const style = root.getComputedStyle(bubble);
      const rightAligned = rect.left - column.left > column.right - rect.right + 24;
      const colored = style.backgroundColor && !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor);
      if (rect.width && rightAligned && colored && parseFloat(style.borderTopLeftRadius) >= 6) return bubble;
      bubble = [...bubble.children].find(child => C.normalize(messageText(child)) === text);
    }
    return null;
  }
  function readMessages() {
    resultCache = new WeakMap();
    const items = [];
    const roles = new Set(["user", "assistant"]);
    const hidden = new WeakMap();
    function inactive(el) {
      if (!el) return false;
      if (!hidden.has(el)) {
        // Collapsed answers are still needed to match their saved question.
        const concealed = el.matches('[hidden], [inert], [aria-hidden="true"]') || inactive(el.parentElement)
          || (!el.classList.contains("gpt-answer-shelf-hidden-turn") && root.getComputedStyle(el).display === "none");
        hidden.set(el, concealed);
      }
      return hidden.get(el);
    }
    function statusOnly(el) {
      if (!el.matches(STATUS) || el.querySelector("img,canvas,iframe,video")) return false;
      const text = C.normalize(messageText(el));
      return !text || TIMING.test(text) || PROGRESS.test(text);
    }
    const blockOf = el => {
      for (let node = el; node && !node.matches('main, [role="main"]'); node = node.parentElement) {
        if ([...node.classList].some(name => name.startsWith("block-"))) return node;
      }
      return null;
    };
    function add(el, role, explicit = false, mediaResult = false) {
      if (!el || !roles.has(role) || el.closest(EXTENSION_UI + ', [contenteditable="true"], input, textarea') || inactive(el)) return;
      const status = el.closest(STATUS);
      if (status && statusOnly(status)) return;
      if (items.some(item => item.el === el || item.el.contains(el) || el.contains(item.el))) return;
      items.push({ el, role, explicit, mediaResult });
    }
    for (const el of document.querySelectorAll('[data-message-author-role], [data-message-role]')) add(el, el.dataset.messageAuthorRole || el.dataset.messageRole, true);
    // Support messages whose author is marked on the article rather than its body.
    for (const turn of document.querySelectorAll(TURN)) {
      if (items.some(item => turn.contains(item.el))) continue;
      const marked = turn.dataset.turn;
      const role = roles.has(marked) ? marked : captionRole(turn);
      const userBody = turn.querySelector('[data-testid="user-message"], [class*="user-message-bubble"]');
      if (role === "user") add(userBody || turn.querySelector(".whitespace-pre-wrap") || turn, "user", true);
      else if (!roles.has(role) && userBody) add(userBody, "user", true);
      else if (role === "assistant") add(turn.querySelector(BODY) || turn, "assistant", true);
      else add(turn.querySelector(BODY), "assistant");
    }
    // A redesign may keep Markdown bodies and user bubbles without author attributes.
    for (const el of document.querySelectorAll('main [data-testid="user-message"], main [class*="user-message-bubble"], [role="main"] [data-testid="user-message"], [role="main"] [class*="user-message-bubble"]')) add(el, "user", true);
    for (const el of document.querySelectorAll(BODY.split(", ").flatMap(selector => [`main ${selector}`, `[role="main"] ${selector}`]).join(", "))) {
      if (!el.closest('[data-turn="user"], [data-message-author-role="user"], [data-testid="user-message"], [class*="user-message-bubble"]')) add(el, "assistant");
    }
    for (const el of document.querySelectorAll('[class*="MarkdownRoot-"]')) {
      if (blockOf(el)) add(el, "assistant");
    }
    // Some pages mark Markdown answers but omit user roles. Look for a question
    // bubble immediately before a recognized answer in the same message column.
    const assistantBlocks = new Set(items.filter(item => item.role === "assistant").map(item => blockOf(item.el)).filter(Boolean));
    const blockParents = new Set([...assistantBlocks].map(block => block.parentElement).filter(Boolean));
    for (const parent of blockParents) for (const shell of parent.children) {
      if (![...shell.classList].some(name => name.startsWith("block-")) || items.some(item => shell.contains(item.el) || item.el.contains(shell))
          || shell.closest(EXTENSION_UI + ', [contenteditable="true"]') || inactive(shell) || statusOnly(shell)) continue;
      const text = C.normalize(messageText(shell));
      let next = shell.nextElementSibling;
      while (next && (next.matches(EXTENSION_UI) || inactive(next) || statusOnly(next))) next = next.nextElementSibling;
      const gallery = next?.matches('[class*="block-"]') && inspectResult(next);
      if (assistantBlocks.has(next) || gallery?.kind === "image") {
        const question = questionBubble(shell, text);
        if (question) { add(question, "user", true); continue; }
      }
      if (text || shell.querySelector("img")) items.push({ el: shell, role: "boundary", explicit: false });
    }
    // A saved question can still be matched exactly after the page changes its layout.
    const savedQuestions = new Set(getNotes().map(note => C.normalize(note.exchanges[0].userText)).filter(Boolean));
    const savedTexts = [...savedQuestions];
    if (savedTexts.length) {
      const scopes = new Set([...document.querySelectorAll('main, [role="main"]'), ...blockParents]);
      for (const main of scopes) {
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const start = textNode.parentElement;
          if (!start || start.closest(EXTENSION_UI + ', [contenteditable="true"], input, textarea, button, script, style, .sr-only')) continue;
          const prefix = C.normalize(textNode.textContent).slice(0, 64);
          if (!prefix || !savedTexts.some(question => question.startsWith(prefix)) || inactive(start)) continue;
          let match = null;
          for (let node = start; node && node !== main; node = node.parentElement) {
            const text = C.normalize(messageText(node, false));
            if (savedQuestions.has(text)) match = node;
            else if (match || !savedTexts.some(question => question.startsWith(text))) break;
          }
          if (!match) continue;
          const overlapping = items.filter(item => item.el === match || item.el.contains(match) || match.contains(item.el));
          if (overlapping.some(item => item.explicit && item.role !== "user") || overlapping.some(item => item.role === "user")) continue;
          for (const item of overlapping) items.splice(items.indexOf(item), 1);
          add(match, "user", true);
        }
      }
    }
    // A finished generated-image gallery can replace the Markdown status body.
    // Inspect bounded message shells after recognizing our exact questions.
    const resultParents = new Set([...blockParents, ...items.filter(item => item.role === "user").map(item => blockOf(item.el)?.parentElement).filter(Boolean)]);
    for (const parent of resultParents) for (const shell of parent.children) {
      if (![...shell.classList].some(name => name.startsWith("block-")) || shell.matches(EXTENSION_UI) || inactive(shell)) continue;
      const facts = inspectResult(shell);
      if (!facts.eligible) continue;
      const overlapping = items.filter(item => shell.contains(item.el) || item.el.contains(shell));
      if (overlapping.some(item => item.role === "user")) continue;
      if (facts.kind !== "image" && overlapping.some(item => item.role === "assistant")) continue;
      for (const item of overlapping) items.splice(items.indexOf(item), 1);
      add(shell, "assistant", true, true);
    }
    items.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    let priorUserText = "";
    const occurrences = new Map();
    return items.map(({ el, role, mediaResult }, index) => {
      let turn = el.closest(TURN + ', article') || blockOf(el) || el;
      const siblings = items.filter(item => turn.contains(item.el));
      const assistantParts = role === "assistant" && siblings.every(item => item.role === "assistant");
      if (siblings.length > 1 && !assistantParts) turn = el;
      let contentEl = el;
      if (role === "assistant") {
        const group = el.closest('.group.flex.min-w-0.flex-col');
        if (group && turn.contains(group) && !items.some(item => item.role !== "assistant" && group.contains(item.el))) contentEl = group;
        if (siblings.length > 1 && assistantParts) {
          let common = el;
          while (common && !siblings.every(item => common.contains(item.el))) common = common.parentElement;
          if (common && turn.contains(common)) contentEl = common;
        }
      }
      const facts = role === "assistant" ? inspectResult(turn) : null;
      if (facts?.images.length && facts.completion && siblings.every(item => item.role === "assistant")) contentEl = turn;
      // A gallery's timing/summary labels are UI metadata, not an answer body.
      const text = facts?.kind === "image" ? "" : messageText(el);
      const fallbackBase = `fallback:${role}:${C.hash(text)}:${C.hash(priorUserText)}`;
      const occurrence = occurrences.get(fallbackBase) || 0;
      occurrences.set(fallbackBase, occurrence + 1);
      const id = el.dataset.messageId || el.querySelector('[data-message-id]')?.dataset.messageId || turn.dataset.messageId || (turn.dataset.turnId ? `${turn.dataset.turnId}:${role}` : turn.dataset.testid ? `${turn.dataset.testid}:${role}` : `${fallbackBase}:${occurrence}`);
      const message = { el, contentEl, turn, role, id, text, priorUserText, index, ...(facts && (facts.kind === "image" || mediaResult) ? { kind: "image", mediaKey: facts.mediaKey } : {}) };
      if (role === "user") priorUserText = text;
      else if (role === "boundary") priorUserText = "";
      return message;
    });
  }

  function textRange(message, phrase) {
    if (!phrase) return null;
    const walker = document.createTreeWalker(message.el, NodeFilter.SHOW_TEXT);
    const parts = [];
    let text = "", node, previousBlock;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('button, svg, script, style, .sr-only, .katex-mathml, ' + EXTENSION_UI)) continue;
      const block = parent.closest('p, li, pre, h1, h2, h3, h4, h5, h6, blockquote, tr');
      if (previousBlock && block && previousBlock !== block) text += "\n";
      parts.push({ node, start: text.length }); text += node.textContent;
      previousBlock = block;
    }
    let start = text.indexOf(phrase), end = start + phrase.length;
    if (start < 0) {
      const offsets = [];
      let normalized = "";
      for (let index = 0; index < text.length; index++) {
        const whitespace = /\s|\u00a0/.test(text[index]);
        if (whitespace && (!normalized || normalized.endsWith(" "))) continue;
        normalized += whitespace ? " " : text[index]; offsets.push(index);
      }
      const needle = C.normalize(phrase), match = normalized.indexOf(needle);
      if (match >= 0 && needle) { start = offsets[match]; end = offsets[match + needle.length - 1] + 1; }
    }
    if (start < 0) return null;
    const first = parts.find(part => part.start + part.node.length > start);
    const ending = parts.find(part => part.start < end && part.start + part.node.length >= end);
    if (!first || !ending) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(ending.node, end - ending.start);
    return range;
  }

    function invalidate(records, messages) {
      for (const record of records) {
        const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        for (const message of messages) if (target && (message.el === target || message.el.contains(target))) textCache.delete(message.el);
        for (const message of messages) if (target && message.turn && (message.turn === target || message.turn.contains(target) || target.contains(message.turn))) textCache.delete(message.turn);
      }
    }
    function roots(messages) {
      const found = new Set([document.documentElement]);
      function visit(node) {
        if (node.nodeType !== Node.ELEMENT_NODE || node.matches(EXTENSION_UI)) return;
        if (node.shadowRoot) {
          found.add(node.shadowRoot);
          for (const child of node.shadowRoot.children) visit(child);
        }
        if (node.localName === "iframe") {
          try {
            const frameRoot = node.contentDocument?.documentElement;
            if (frameRoot) { found.add(frameRoot); visit(frameRoot); }
          } catch { /* Cross-origin frame contents are not available. */ }
        }
        for (const child of node.children) visit(child);
      }
      for (const message of messages) visit(message.contentEl || message.el);
      return found;
    }
    return { read: readMessages, range: textRange, invalidate, roots, captureResult, canArchive: message => canArchiveReply(message, inspectResult(message.turn), C) };
  }
  const api = { create, classifyImageReply, canArchiveReply, imageResource };
  root.GPTStickyMessages = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
