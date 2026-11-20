(function (root) {
  "use strict";
  function create({ core, reader, getConversation, onUpdate, nextFrame, document = root.document, waitForHistory, historyLimit = 45000, now = Date.now }) {
    let last = null, highlightTimer, active, queue = Promise.resolve(), landingSpace = null;
    const frame = nextFrame || (() => new Promise(resolve => root.requestAnimationFrame(resolve)));
    function record(note, code, message, details = {}) {
      last = { noteId: note.id, conversation: note.conversation, at: Date.now(), code, message, ...details };
      onUpdate?.(last); return last;
    }
    function cancel({ restorePosition = true } = {}) {
      if (!active) return;
      active.cancelled = true; active.restorePosition = restorePosition; active.wake?.();
    }
    function userIntent(event) {
      if (!active || event.target.closest?.('[data-gpt-answer-shelf="portal"], [data-gpt-answer-shelf-native]')) return;
      if (event.type === "wheel" && event.ctrlKey) return;
      if (event.type === "keydown" && (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) || event.target.closest?.('input,textarea,[contenteditable="true"]'))) return;
      cancel({ restorePosition: false });
    }
    for (const type of ["wheel", "pointerdown", "touchstart", "keydown"]) root.addEventListener?.(type, userIntent, { capture: true, passive: true });
    root.addEventListener?.("scroll", event => {
      if (landingSpace && (event.target === landingSpace.scroller || event.target === document && landingSpace.scroller === document.scrollingElement)) trimLandingSpace();
    }, { capture: true, passive: true });
    function historyScrollers(messages) {
      if (!document?.scrollingElement) return [];
      const win = document.defaultView || root, result = [], docRoot = document.scrollingElement;
      // Start with the conversation's nearest scroll container. Scanning every
      // scrollable element would also scroll the navigation menu and composers.
      for (let node = (messages.at(-1)?.turn || messages.at(-1)?.el)?.parentElement || document.querySelector?.('main,[role="main"]'); node; node = node.parentElement) {
        if (node !== docRoot && /(auto|scroll|overlay)/.test(win.getComputedStyle(node).overflowY) && node.clientHeight && node.scrollHeight > node.clientHeight + 1) result.push(node);
      }
      if (docRoot.scrollHeight > docRoot.clientHeight + 1) result.push(docRoot);
      return result;
    }
    function waitHistory(scroller, timeout, control) {
      if (waitForHistory) return waitForHistory(scroller, timeout);
      return new Promise(resolve => {
        let observer, timer, quiet;
        const finish = () => { observer?.disconnect(); clearTimeout(timer); clearTimeout(quiet); if (control.wake === finish) delete control.wake; resolve(); };
        control.wake = finish;
        // The virtualizer may replace turns or prepend a batch asynchronously.
        // Wait for its layout to settle, with a deadline even during streaming.
        if (root.MutationObserver) {
          observer = new root.MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(finish, 80); });
          observer.observe(scroller, { childList: true, subtree: true, characterData: true });
        }
        timer = setTimeout(finish, timeout);
        if (control.cancelled) finish();
      });
    }
    async function loadMissing(note, resolve, control, metadata) {
      const messages = reader.read(), scrollers = historyScrollers(messages);
      if (!scrollers.length) return;
      const positions = scrollers.map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
      const visible = messages.find(message => { const rect = message.el?.getBoundingClientRect(); return rect?.bottom > 0 && rect.top >= 0; });
      const anchor = visible && { message: visible, top: visible.el.getBoundingClientRect().top };
      control.restore = () => {
        if (!control.restorePosition || note.conversation !== getConversation()) return;
        for (const { node, top, left } of positions) if (node.isConnected !== false) node.scrollTo({ top, left, behavior: "instant" });
        if (anchor?.message.el.isConnected) {
          const delta = anchor.message.el.getBoundingClientRect().top - anchor.top;
          if (Math.abs(delta) > 1) scrollers[0].scrollTo({ top: scrollers[0].scrollTop + delta, behavior: "instant" });
        }
      };
      const start = now();
      metadata.historySteps = 0;
      try {
        for (const direction of [-1, 1]) for (const scroller of scrollers) {
          let boundarySince = 0;
          while (!control.cancelled && note.conversation === getConversation() && now() - start < historyLimit && metadata.historySteps < 150 && scroller.isConnected !== false) {
            if (resolve()) { metadata.historyLoaded = true; return; }
            metadata.historyDirection = direction < 0 ? "older" : "newer";
            record(note, "loading-history", direction < 0 ? "正在加载较早的对话并查找目标…" : "正在加载后续对话并查找目标…", metadata);
            const before = scroller.scrollTop, height = scroller.scrollHeight, viewport = scroller.clientHeight || (document.defaultView || root).innerHeight;
            const next = Math.max(0, Math.min(height - viewport, before + direction * Math.max(100, viewport * .8)));
            // At an existing edge, a tiny excursion makes scroll-driven lazy
            // loaders run even if the page was already parked at that edge.
            if (Math.abs(next - before) < 1 && !boundarySince) {
              scroller.scrollTo({ top: Math.max(0, Math.min(height - viewport, before - direction * 2)), behavior: "instant" });
              await frame();
            }
            if (control.cancelled || note.conversation !== getConversation()) return;
            scroller.scrollTo({ top: next, behavior: "instant" });
            metadata.historySteps++;
            await waitHistory(scroller, boundarySince ? 700 : 240, control);
            if (resolve()) { metadata.historyLoaded = true; return; }
            const edge = direction < 0 ? scroller.scrollTop <= 1 : scroller.scrollTop + viewport >= scroller.scrollHeight - 1;
            if (!edge || scroller.scrollHeight !== height) boundarySince = 0;
            else if (!boundarySince) boundarySince = now();
            else if (now() - boundarySince >= 7000) break;
          }
        }
      } finally { delete control.wake; }
    }
    function viewportOf(target) {
      const doc = target.ownerDocument || root.document, win = doc.defaultView || root;
      const docRoot = doc.scrollingElement, scrollerNodes = [];
      for (let node = target.parentElement; node; node = node.parentElement) {
        if (node !== docRoot && /(auto|scroll|overlay)/.test(win.getComputedStyle(node).overflowY) && node.clientHeight) scrollerNodes.push(node);
      }
      if (docRoot) scrollerNodes.push(docRoot);
      return { scrollerNodes, docRoot, win };
    }
    function visibleIn(rect, viewport) {
      if (!rect || !rect.width || !rect.height || rect.bottom <= 0 || rect.top >= viewport.win.innerHeight) return false;
      return viewport.scrollerNodes.every(scroller => {
        const bounds = scroller === viewport.docRoot ? { top: 0, bottom: viewport.win.innerHeight } : scroller.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
    }
    function isVisible(target) {
      return Boolean(target?.isConnected && visibleIn(target.getBoundingClientRect(), viewportOf(target)));
    }
    function trimLandingSpace() {
      if (!landingSpace) return;
      const { spacer, scroller, conversation } = landingSpace;
      const naturalEnd = Math.max(0, scroller.scrollHeight - scroller.clientHeight - spacer.getBoundingClientRect().height);
      if (!spacer.isConnected || conversation !== getConversation() || (!active?.alignQuestion && scroller.scrollTop <= naturalEnd + 1)) {
        spacer.remove();
        landingSpace = null;
      }
    }
    function allowQuestionScroll(scroller, tail, wantedTop, viewportTop) {
      if (!tail?.after || scroller === tail || !scroller.contains?.(tail) || !document?.createElement) return;
      if (landingSpace && (landingSpace.scroller !== scroller || landingSpace.spacer.previousElementSibling !== tail)) {
        landingSpace.spacer.remove();
        landingSpace = null;
      }
      const before = scroller.scrollHeight, height = scroller.clientHeight;
      const deficit = wantedTop - Math.max(0, before - height);
      if (deficit <= 1 || !height) return;
      if (!landingSpace?.spacer.isConnected) {
        const spacer = document.createElement("div");
        spacer.setAttribute("data-gpt-answer-shelf", "landing-space");
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.cssText = "display:block;flex:0 0 auto;width:1px;height:0;margin:0;padding:0;visibility:hidden;pointer-events:none;overflow-anchor:none";
        tail.after(spacer);
        landingSpace = { spacer, scroller, conversation: getConversation() };
      }
      const spacer = landingSpace.spacer;
      const current = spacer.getBoundingClientRect();
      let needed = current.height + deficit;
      if (before <= height) {
        const spaceOffset = scroller.scrollTop + current.top - viewportTop;
        needed = Math.max(needed, wantedTop + height - spaceOffset);
      }
      spacer.style.height = String(Math.min(height, Math.ceil(needed))) + "px";
      if (scroller.scrollHeight <= before + 1 && current.height === 0) {
        spacer.remove();
        landingSpace = null;
      }
    }
    function position(target, rectOf, landing) {
      const initial = rectOf();
      if (!target.isConnected || !initial) return null;
      const viewport = viewportOf(target);
      const { scrollerNodes, docRoot, win } = viewport;
      const movement = { ...viewport, beforeTop: Math.round(initial.top), scrollers: scrollerNodes.length };
      if (!landing && visibleIn(initial, viewport)) return movement;
      const landingScroller = landing && (scrollerNodes.find(node => node !== landing.tail && node.contains?.(landing.tail)) || scrollerNodes[0]);
      for (const scroller of scrollerNodes) {
        const rect = rectOf();
        if (!target.isConnected || !rect) return null;
        const bounds = scroller === docRoot ? { top: 0, bottom: win.innerHeight } : scroller.getBoundingClientRect();
        const align = scroller === landingScroller;
        if (!align && rect.bottom > bounds.top && rect.top < bounds.bottom) continue;
        const height = scroller === docRoot ? win.innerHeight : scroller.clientHeight;
        const offset = align ? Math.min(72, Math.max(16, height * .1)) : Math.min(height * .35, Math.max(12, (height - rect.height) / 2));
        const viewportTop = bounds.top + (scroller === docRoot ? 0 : scroller.clientTop);
        const top = Math.max(0, scroller.scrollTop + rect.top - viewportTop - offset);
        if (align) allowQuestionScroll(scroller, landing.tail, top, viewportTop);
        if (Math.abs(top - scroller.scrollTop) >= 1) scroller.scrollTo({ top, behavior: "instant" });
      }
      return movement;
    }
    function visiblePosition(target, rectOf, movement) {
      const rect = rectOf();
      if (!target.isConnected || !rect) return null;
      const inView = visibleIn(rect, movement);
      return { beforeTop: movement.beforeTop, afterTop: Math.round(rect.top), scrollers: movement.scrollers, inView };
    }
    async function navigate(note, entry, { searchHistory = false, questionOnly = false, alignQuestion = false } = {}) {
      const control = active = { cancelled: false, restorePosition: true, alignQuestion };
      const metadata = { kind: "question", attempts: 0, rebound: 0 };
      let previouslyFound = false, previousElement, finalRange, lastPosition;
      function resolve() {
        const messages = reader.read();
        const question = core.questionForEntry(entry, messages);
        const message = question || (!questionOnly && core.storedAnswer(entry, messages));
        if (!message) return null;
        const answerOnly = !question;
        const range = reader.range?.(message, answerOnly ? message.text.slice(0, 160) : entry.userText);
        const target = range ? range.startContainer.parentElement : message.el;
        const rectOf = () => {
          if (!target?.isConnected) return null;
          if (range) return [...range.getClientRects()].find(rect => rect.height > 0 && rect.width > 0) || null;
          const rect = target.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 ? rect : null;
        };
        const tail = alignQuestion && messages.findLast(item => item.role === "user" || item.role === "assistant")?.turn;
        return { message, range, target, rectOf, answerOnly, tail };
      }
      try {
        if (note.conversation !== getConversation()) return record(note, "different-conversation", "当前对话已变化。", metadata);
        record(note, "locating", "正在定位原问答…", metadata);
        if (!resolve()) {
          if (!searchHistory) return record(note, "question-not-found", "网页暂未加载出能准确定位的问答。", metadata);
          await loadMissing(note, resolve, control, metadata);
        }
        for (let attempt = 0; attempt < 16; attempt++) {
          metadata.attempts = attempt + 1;
          if (control.cancelled) return record(note, "cancelled", "已停止查找。", metadata);
          if (note.conversation !== getConversation()) return record(note, "different-conversation", "当前对话已变化。", metadata);
          // Rebind the question after layout changes or virtualizer updates.
          let current = resolve();
          if (!current) { await frame(); continue; }
          previouslyFound = true;
          if (previousElement && previousElement !== current.target) metadata.rebound++;
          previousElement = current.target;
          if (!alignQuestion || attempt > 0) { await frame(); await frame(); }
          if (control.cancelled || note.conversation !== getConversation()) continue;
          current = resolve();
          if (!current) continue;
          if (previousElement !== current.target) { metadata.rebound++; previousElement = current.target; }
          if (!current.rectOf()) {
            current.target.scrollIntoView({ block: "start", behavior: "instant" });
            await frame(); continue;
          }
          const movement = position(current.target, current.rectOf, alignQuestion && !current.answerOnly ? { tail: current.tail } : null);
          if (!movement) { await frame(); continue; }
          await frame(); await frame();
          if (control.cancelled || note.conversation !== getConversation()) continue;
          const latest = resolve();
          if (!latest) continue;
          if (latest.target !== current.target) { metadata.rebound++; previousElement = latest.target; continue; }
          lastPosition = visiblePosition(latest.target, latest.rectOf, movement);
          if (!lastPosition?.inView) continue;
          finalRange = latest.range;
          Object.assign(metadata, lastPosition, { [latest.answerOnly ? "answerIndex" : "questionIndex"]: latest.message.index, kind: latest.answerOnly ? "answer" : "question" });
          if (note.conversation !== getConversation()) continue;
          if (finalRange && root.CSS?.highlights && root.Highlight) {
            clearTimeout(highlightTimer);
            root.CSS.highlights.set("gpt-answer-shelf-jump", new root.Highlight(finalRange));
            highlightTimer = setTimeout(() => root.CSS.highlights.delete("gpt-answer-shelf-jump"), 3000);
          }
          control.restore = null;
          return record(note, "located", "已定位原问答。", metadata);
        }
        if (lastPosition) return record(note, "outside-viewport", "已找到目标，但网页滚动未能将它显示出来。请复制页面诊断。", { ...metadata, ...lastPosition });
        return record(note, previouslyFound ? "target-not-ready" : "question-not-found", "网页暂未加载出能准确定位的问答。", metadata);
      } catch {
        return record(note, "exception", "定位暂时失败，请复制页面诊断。", metadata);
      } finally {
        control.restore?.();
        if (active === control) active = null;
        trimLandingSpace();
        if (last) onUpdate?.(last);
      }
    }
    function enqueue(note, entry, options) {
      const operation = queue.then(() => navigate(note, entry, options), () => navigate(note, entry, options));
      queue = operation.catch(() => {});
      return operation;
    }
    function diagnostic() {
      if (!last) return null;
      const { noteId, conversation, message, ...details } = last;
      return { ...details, sameConversation: conversation === getConversation() };
    }
    return { jump: enqueue, cancel, diagnostic, isVisible, trimLandingSpace };
  }
  const api = { create };
  root.GPTStickyNavigation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
