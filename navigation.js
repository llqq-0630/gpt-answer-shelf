(function (root) {
  "use strict";
  const HIGHLIGHT_MS = 3000;
  const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay|hidden)$/;
  const CLIPPING_OVERFLOW = /^(auto|scroll|overlay|hidden|clip)$/;
  const NATIVE_SCROLL_STYLES = ["overflow-anchor", "scroll-snap-type"];
  function create({ core, reader, getConversation, onUpdate, nextFrame, document = root.document, waitForHistory, waitForLayout, historyLimit = 45000, now = Date.now }) {
    let last = null, highlightTimer, active, queue = Promise.resolve(), landingWatch = null;
    const controlledScrollers = new Map();
    const eventWindow = document?.defaultView || root;
    const frame = nextFrame || (() => new Promise(resolve => root.requestAnimationFrame(resolve)));
    const settleLayout = waitForLayout || (() => new Promise(resolve => setTimeout(resolve, 260)));
    function record(note, code, message, details = {}) {
      last = { noteId: note.id, conversation: note.conversation, at: Date.now(), code, message, ...details };
      onUpdate?.(last); return last;
    }
    function controlScrolling(nodes) {
      for (const node of nodes) {
        if (!node.style || controlledScrollers.has(node)) continue;
        const styles = (node.ownerDocument?.defaultView || eventWindow).getComputedStyle(node);
        const saved = [];
        for (const property of NATIVE_SCROLL_STYLES) {
          const current = styles.getPropertyValue(property);
          if (!current || current === "none") continue;
          saved.push({ property, value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property) });
          node.style.setProperty(property, "none", "important");
        }
        controlledScrollers.set(node, saved);
      }
    }
    function releaseScrolling() {
      for (const [node, saved] of controlledScrollers) {
        for (const { property, value, priority } of saved) {
          if (node.style.getPropertyValue(property) !== "none" || node.style.getPropertyPriority(property) !== "important") continue;
          if (value) node.style.setProperty(property, value, priority);
          else node.style.removeProperty(property);
        }
      }
      controlledScrollers.clear();
    }
    function cancel({ restorePosition = true } = {}) {
      stopWatchingLanding();
      releaseScrolling();
      if (!active) return;
      active.cancelled = true; active.restorePosition = restorePosition; active.wake?.();
    }
    function userIntent(event) {
      if ((!active && !landingWatch) || event.target.closest?.('[data-gpt-answer-shelf="portal"], [data-gpt-answer-shelf-native]')) return;
      if (event.type === "wheel" && event.ctrlKey) { stopWatchingLanding(); return; }
      if (event.type === "keydown" && (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) || event.target.closest?.('input,textarea,[contenteditable="true"]'))) {
        stopWatchingLanding();
        return;
      }
      cancel({ restorePosition: false });
    }
    for (const type of ["wheel", "pointerdown", "touchstart", "keydown"]) eventWindow.addEventListener?.(type, userIntent, { capture: true, passive: true });
    eventWindow.addEventListener?.("blur", stopWatchingLanding);
    document?.addEventListener?.("visibilitychange", () => { if (document.hidden) stopWatchingLanding(); });
    eventWindow.addEventListener?.("scroll", event => {
      const scroller = event.target === document || event.target === eventWindow ? document?.scrollingElement : event.target;
      if (landingWatch?.positions.some(position => position.node === scroller)) checkLanding();
    }, { capture: true, passive: true });
    function historyScrollers(messages) {
      if (!document?.scrollingElement) return [];
      const win = document.defaultView || root, result = [], docRoot = document.scrollingElement;
      // Start with the conversation's nearest scroll container. Scanning every
      // scrollable element would also scroll the navigation menu and composers.
      for (let node = (messages.at(-1)?.turn || messages.at(-1)?.el)?.parentElement || document.querySelector?.('main,[role="main"]'); node; node = node.parentElement) {
        if (node !== docRoot && SCROLLABLE_OVERFLOW.test(win.getComputedStyle(node).overflowY) && node.clientHeight && node.scrollHeight > node.clientHeight + 1) result.push(node);
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
    function scrollRange(scroller, win = scroller.ownerDocument?.defaultView || document?.defaultView || root) {
      const extent = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const reversed = scroller.scrollTop < 0 || win.getComputedStyle(scroller).flexDirection === "column-reverse";
      return reversed ? { min: -extent, max: 0, reversed } : { min: 0, max: extent, reversed };
    }
    async function loadMissing(note, entry, resolve, control, metadata, { hasCapturedTurn = false, returning = false } = {}) {
      const messages = reader.read(), scrollers = historyScrollers(messages);
      if (!scrollers.length || control.cancelled) return;
      controlScrolling(scrollers);
      if (!returning) {
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
      }
      const start = now();
      const seenQuestions = new Map();
      let reachedStart = false;
      const steps = returning ? "returnSteps" : "historySteps";
      const directionKey = returning ? "returnDirection" : "historyDirection";
      const edgeIdle = returning ? 1400 : 7000;
      function find(collect) {
        const loaded = reader.read();
        if (resolve(loaded)) return true;
        if (collect) {
          for (const question of core.questionsForEntry(entry, loaded, { allowPreview: true })) {
            const answer = core.responseAfter(question, loaded);
            const exact = Boolean(answer && core.findLinkedPair(entry, [question, answer]));
            if (!exact && !core.sameText(question.text, entry.userText)) continue;
            const key = core.isNativeId(question.id) ? question.id : question.el;
            const previous = seenQuestions.get(key);
            const observed = capturePair(question, answer, loaded);
            const anchor = previous?.anchor.visible && !observed.visible ? previous.anchor : observed;
            seenQuestions.set(key, { anchor, exact: exact || previous?.exact });
          }
        }
        return false;
      }
      metadata[steps] = 0;
      try {
        for (const direction of [-1, 1]) for (const scroller of scrollers) {
          let boundarySince = 0;
          const primary = scroller === scrollers[0];
          const collect = !returning && primary && direction > 0 && reachedStart;
          while (!control.cancelled && note.conversation === getConversation() && now() - start < historyLimit && metadata[steps] < 150 && scroller.isConnected !== false) {
            if (find(collect)) { metadata.historyLoaded = true; return; }
            metadata[directionKey] = direction < 0 ? "older" : "newer";
            const progress = returning ? "已确认原问答，正在返回其位置…" :
              direction < 0 ? "正在加载较早的对话并查找目标…" : "正在加载后续对话并查找目标…";
            record(note, "loading-history", progress, metadata);
            const before = scroller.scrollTop, height = scroller.scrollHeight, viewport = scroller.clientHeight || (document.defaultView || root).innerHeight;
            const { min, max } = scrollRange(scroller);
            const clamp = top => Math.max(min, Math.min(max, top));
            const next = clamp(before + direction * Math.max(100, viewport * .8));
            // At an existing edge, a tiny excursion makes scroll-driven lazy
            // loaders run even if the page was already parked at that edge.
            if (Math.abs(next - before) < 1 && !boundarySince) {
              scroller.scrollTo({ top: clamp(before - direction * 2), behavior: "instant" });
              await frame();
            }
            if (control.cancelled || note.conversation !== getConversation()) return;
            scroller.scrollTo({ top: next, behavior: "instant" });
            metadata[steps]++;
            await waitHistory(scroller, boundarySince ? 700 : 240, control);
            if (find(collect)) { metadata.historyLoaded = true; return; }
            const range = scrollRange(scroller);
            const edge = direction < 0 ? scroller.scrollTop <= range.min + 1 : scroller.scrollTop >= range.max - 1;
            if (!edge || scroller.scrollHeight !== height) boundarySince = 0;
            else if (!boundarySince) boundarySince = now();
            else if (now() - boundarySince >= edgeIdle) {
              if (primary && direction < 0) reachedStart = true;
              if (collect) {
                // Only use uniqueness after a traversal from the verified
                // start to the end, never from a single loaded slice.
                const candidates = [...seenQuestions.values()];
                const exact = candidates.filter(item => item.exact);
                const verified = !hasCapturedTurn && exact.length ? exact : candidates;
                metadata.historyCandidates = candidates.length;
                if (verified.length === 1) {
                  metadata.historyLoaded = true;
                  metadata.historyMatch = verified[0].exact ? "complete-pair" : "unique-question";
                  return verified[0].anchor;
                }
              }
              break;
            }
          }
        }
      } finally { delete control.wake; }
    }
    function viewportOf(target) {
      const doc = target.ownerDocument || document, win = doc.defaultView || root;
      const docRoot = doc.scrollingElement, scrollerNodes = [], clipNodes = [];
      for (let node = target.parentElement; node; node = node.parentElement) {
        if (node === docRoot) continue;
        const style = win.getComputedStyle(node);
        if (CLIPPING_OVERFLOW.test(style.overflowY) && style.display !== "contents" && (node.clientHeight || node.clientWidth)) clipNodes.push(node);
        if (SCROLLABLE_OVERFLOW.test(style.overflowY) && node.clientHeight && node.scrollHeight > node.clientHeight + 1) scrollerNodes.push(node);
      }
      if (docRoot) scrollerNodes.push(docRoot);
      return { scrollerNodes, clipNodes, docRoot, win };
    }
    function scrollport(scroller, { docRoot, win }) {
      const top = scroller === docRoot
        ? win.visualViewport?.offsetTop || 0
        : scroller.getBoundingClientRect().top + scroller.clientTop;
      const height = scroller === docRoot ? win.visualViewport?.height || win.innerHeight : scroller.clientHeight;
      return { top, height, bottom: top + height };
    }
    function messageLocation(message, phrase) {
      const range = reader.range?.(message, phrase);
      const target = range?.startContainer.parentElement || message.el;
      const rectOf = () => {
        if (!target?.isConnected) return null;
        const textRect = range && [...range.getClientRects()].find(rect => rect.height > 0 && rect.width > 0);
        return textRect || [target.getBoundingClientRect?.(), message.turn?.getBoundingClientRect?.()]
          .find(rect => rect?.width > 0 && rect.height > 0) || null;
      };
      return { target, rectOf, range };
    }
    function alignmentScroller(viewport, turn) {
      return viewport.scrollerNodes.find(node => node !== turn && node.contains?.(turn)) || viewport.scrollerNodes[0];
    }
    const alignmentOffset = height => Math.min(72, Math.max(16, height * .1));
    function capturePair(question, answer, messages = []) {
      const { target, rectOf } = messageLocation(question, question.text);
      let checkpoint = null, visible = false;
      if (target?.isConnected) {
        const viewport = viewportOf(target);
        const node = alignmentScroller(viewport, answer?.turn || question.turn);
        if (node) {
          const rect = rectOf(), { min, max } = scrollRange(node, viewport.win);
          visible = visibleIn(rect, viewport);
          const { top, height } = scrollport(node, viewport);
          const desired = rect && !visible ? node.scrollTop + rect.top - top - alignmentOffset(height) : node.scrollTop;
          const offset = Math.max(min, Math.min(max, desired));
          checkpoint = { node, fromStart: offset - min, fromEnd: max - offset, questionTop: rect && node.scrollTop + rect.top - top - min };
        }
      }
      const turn = question.turn;
      const parent = turn?.parentElement, before = turn?.previousElementSibling, after = turn?.nextElementSibling;
      const matchQuestion = candidate => candidate.el === question.el || Boolean(parent && candidate.turn?.parentElement === parent
        && (before && candidate.turn.previousElementSibling === before || after && candidate.turn.nextElementSibling === after));
      const matchAnswer = candidate => Boolean(answer?.el && candidate.el === answer.el);
      const slot = node => {
        const parent = node?.parentElement;
        return parent?.children ? { parent, count: parent.childElementCount, index: [...parent.children].indexOf(node) } : null;
      };
      const questionSlot = slot(turn), answerSlot = slot(answer?.turn);
      function sameSlot(node, saved) {
        const column = node?.parentElement;
        return Boolean(saved && column && (column === saved.parent
          || !saved.parent.isConnected && checkpoint?.node.contains?.(column))
          && column.childElementCount === saved.count && column.children[saved.index] === node);
      }
      const relevant = message => message.role === "user" || message.role === "assistant";
      const preceding = messages.findLast(item => item.index < question.index && relevant(item));
      const following = answer && messages.find(item => item.index > answer.index && relevant(item));
      function sameNeighbor(original, current) {
        return current && original.role === current.role && core.compatibleId(original.id, current.id)
          && core.sameText(original.text, current.text) && original.mediaKey === current.mediaKey;
      }
      function rebuiltPair(pair, loaded) {
        if (!sameSlot(pair.user.turn, questionSlot) || !sameSlot(pair.answer.turn, answerSlot)) return false;
        // A full redraw replaces all node identities. Confirm its surrounding
        // turns rather than mistaking a different loaded slice for this one.
        if (preceding || following) {
          return (!preceding || sameNeighbor(preceding, loaded.findLast(item => item.index < pair.user.index && relevant(item))))
            && (!following || sameNeighbor(following, loaded.find(item => item.index > pair.answer.index && relevant(item))));
        }
        const node = checkpoint?.node;
        if (!node?.contains?.(pair.user.el) || !Number.isFinite(checkpoint.questionTop)) return false;
        const { target, rectOf } = messageLocation(pair.user, pair.user.text);
        const rect = rectOf();
        if (!rect) return false;
        const viewport = viewportOf(target);
        const currentTop = node.scrollTop + rect.top - scrollport(node, viewport).top - scrollRange(node, viewport.win).min;
        return Math.abs(currentTop - checkpoint.questionTop) <= 3;
      }
      return { question, checkpoint, visible, options: {
        matchQuestion, matchAnswer, matchFallback: (pair, loaded) =>
          matchQuestion(pair.user) || matchAnswer(pair.answer) || rebuiltPair(pair, loaded)
      } };
    }
    function moveToCheckpoint(checkpoint, countFromEnd = false) {
      if (!checkpoint?.node || checkpoint.node.isConnected === false) return false;
      const { node, fromStart, fromEnd } = checkpoint;
      controlScrolling([node]);
      const { min, max } = scrollRange(node);
      // Measure from the start so a reverse list's new height still refers
      // to the same location after the selected answer has collapsed.
      const top = Math.max(min, Math.min(max, countFromEnd ? max - fromEnd : min + fromStart));
      if (Math.abs(node.scrollTop - top) < 1) return false;
      node.scrollTo({ top, behavior: "instant" });
      return true;
    }
    function visibleIn(rect, viewport) {
      if (!rect || !rect.width || !rect.height) return false;
      let { top, bottom } = scrollport(viewport.docRoot, viewport);
      for (const ancestor of viewport.clipNodes) {
        const bounds = scrollport(ancestor, viewport);
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
      return bottom > top && rect.bottom > top && rect.top < bottom;
    }
    function isVisible(target) {
      return Boolean(target?.isConnected && visibleIn(target.getBoundingClientRect(), viewportOf(target)));
    }
    function position(target, rectOf, { alignQuestion, tail, preferredTop }) {
      const initial = rectOf();
      if (!target.isConnected || !initial) return null;
      const viewport = viewportOf(target);
      const { scrollerNodes } = viewport;
      const movement = { beforeTop: Math.round(initial.top) };
      if (!alignQuestion && visibleIn(initial, viewport)
          && (preferredTop == null || Math.abs(initial.top - preferredTop) <= 1)) return movement;
      controlScrolling(scrollerNodes);
      const landingScroller = alignmentScroller(viewport, tail);
      for (const scroller of scrollerNodes) {
        const rect = rectOf();
        if (!target.isConnected || !rect) return null;
        const bounds = scrollport(scroller, viewport);
        const align = alignQuestion && scroller === landingScroller;
        const preserve = preferredTop != null && scroller === landingScroller;
        if (!align && !preserve && rect.bottom > bounds.top && rect.top < bounds.bottom) continue;
        const { height, top: viewportTop } = bounds;
        let offset = Math.min(height * .35, Math.max(12, (height - rect.height) / 2));
        if (align) offset = alignmentOffset(height);
        else if (preserve) offset = Math.max(0, Math.min(Math.max(0, height - rect.height), preferredTop - viewportTop));
        // Let the browser clamp the requested offset, including the negative
        // scrollTop range used by bottom-anchored conversation containers.
        const top = scroller.scrollTop + rect.top - viewportTop - offset;
        if (Math.abs(top - scroller.scrollTop) >= 1) scroller.scrollTo({ top, behavior: "instant" });
      }
      return movement;
    }
    function reveal(current) {
      const candidates = [current.target, current.message.el, current.message.turn];
      const target = candidates.find(node => node?.isConnected && node.getClientRects?.().length) || current.target;
      if (!target?.isConnected || !target.scrollIntoView) return;
      controlScrolling(viewportOf(target).scrollerNodes);
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
    function visiblePosition(target, rectOf, movement) {
      const rect = rectOf();
      if (!target.isConnected || !rect) return null;
      const viewport = viewportOf(target);
      return { beforeTop: movement.beforeTop, afterTop: Math.round(rect.top), scrollers: viewport.scrollerNodes.length,
        inView: visibleIn(rect, viewport) };
    }
    const scrollPositions = viewport => viewport.scrollerNodes.map(node => ({ node, top: node.scrollTop }));
    function stopWatchingLanding() {
      if (!landingWatch) return;
      landingWatch = null;
      if (!active) releaseScrolling();
    }
    function watchLanding(note, resolve, current, top) {
      landingWatch = {
        noteId: note.id, conversation: note.conversation, resolve, current, top,
        positions: scrollPositions(viewportOf(current.target)), pending: false, correctionsWithoutSettling: 0
      };
    }
    function checkLanding() {
      const watch = landingWatch;
      if (!watch || watch.pending) return;
      watch.pending = true;
      frame().then(() => {
        watch.pending = false;
        if (watch !== landingWatch) return;
        if (watch.conversation !== getConversation() || document?.hidden) { stopWatchingLanding(); return; }
        const rect = watch.current.rectOf();
        if (rect && Math.abs(rect.top - watch.top) <= 2 && reader.matchesQuestion?.(watch.current.message, watch.current.message.text)
            && visibleIn(rect, viewportOf(watch.current.target))) {
          watch.correctionsWithoutSettling = 0;
          return;
        }
        // Stop if the page repeatedly overrides the correction without
        // giving the same question a stable position between attempts.
        if (watch.correctionsWithoutSettling >= 4) { stopWatchingLanding(); return; }
        const current = watch.resolve();
        if (!current?.rectOf()) {
          // A late scroll can unmount the question. Return to its last
          // verified offsets so the virtualizer can render that turn again.
          for (const { node, top } of watch.positions) {
            if (node.isConnected !== false && Math.abs(node.scrollTop - top) >= 1) {
              node.scrollTo({ top, behavior: "instant" });
              watch.correctionsWithoutSettling++;
            }
          }
          return;
        }
        watch.current = current;
        const movement = position(current.target, current.rectOf, { tail: current.tail, preferredTop: watch.top });
        const result = movement && visiblePosition(current.target, current.rectOf, movement);
        const moved = result && Math.abs(result.afterTop - result.beforeTop) > 2;
        if (result?.inView) {
          watch.positions = scrollPositions(viewportOf(current.target));
          if (!moved) watch.top = result.afterTop;
        }
        if (moved || !result?.inView) watch.correctionsWithoutSettling++;
        if (result && last?.noteId === watch.noteId) {
          Object.assign(last, { afterTop: result.afterTop, inView: result.inView });
          if (moved) last.landingCorrections = (last.landingCorrections || 0) + 1;
        }
      }).catch(() => { if (watch === landingWatch) stopWatchingLanding(); });
    }
    async function navigate(note, entry, { searchHistory = false, questionOnly = false, alignQuestion = false, anchor } = {}) {
      stopWatchingLanding();
      const control = active = { cancelled: false, restorePosition: true };
      const metadata = { kind: "question", attempts: 0, rebound: 0 };
      let previouslyFound = false, settled = false, liveAnchor = anchor?.question, previousElement, initialTop, lastPosition, preferredTop;
      let triedCheckpoint = false, triedReturnScan = false;
      const historyOptions = searchHistory ? { matchFallback: () => false } : undefined;
      function recoverCheckpoint() {
        if (triedCheckpoint || !anchor?.checkpoint) return false;
        triedCheckpoint = true;
        const moved = moveToCheckpoint(anchor.checkpoint);
        if (moved) metadata.checkpointUsed = true;
        return moved;
      }
      async function scanBackToMatch(questionFirst = false) {
        if (triedReturnScan || control.cancelled || note.conversation !== getConversation()) return;
        triedReturnScan = true;
        const findVerified = messages => {
          const target = resolve(messages);
          return questionFirst && target?.answerOnly ? null : target;
        };
        await loadMissing(note, entry, findVerified, control, metadata, { returning: true });
      }
      function resolve(messages = reader.read()) {
        const options = anchor?.options || historyOptions;
        const currentNode = liveAnchor && messages.find(item => item.el === liveAnchor.el && item.role === "user");
        const live = liveAnchor && (!currentNode || core.compatibleId(entry.userMessageId, currentNode.id))
          && reader.matchesQuestion?.(liveAnchor, entry.userText);
        let question = live
          ? currentNode || liveAnchor
          : core.questionForEntry(entry, messages, options);
        if (!question && metadata.historyMatch === "unique-question") {
          const found = core.questionsForEntry(entry, messages);
          if (found.length === 1) question = found[0];
        } else if (!question && metadata.historyMatch === "complete-pair") {
          question = core.findLinkedPair(entry, messages)?.user;
        }
        if (question) liveAnchor = question;
        const message = question || (!questionOnly && core.storedAnswer(entry, messages, options));
        if (!message) return null;
        const answerOnly = !question;
        const location = messageLocation(message, answerOnly ? message.text.slice(0, 160) : message.text);
        const lastTurn = messages.findLast(item => item.role === "user" || item.role === "assistant")?.turn;
        const tail = lastTurn && !(message.turn?.compareDocumentPosition?.(lastTurn) & root.Node?.DOCUMENT_POSITION_PRECEDING)
          ? lastTurn : message.turn;
        return { message, ...location, answerOnly, tail };
      }
      try {
        if (note.conversation !== getConversation()) return record(note, "different-conversation", "当前对话已变化。", metadata);
        record(note, "locating", "正在定位原问答…", metadata);
        let current = resolve();
        if ((!current?.rectOf() || current.answerOnly) && recoverCheckpoint()) { await frame(); current = resolve(); }
        if (!current) {
          if (searchHistory) {
            const found = await loadMissing(note, entry, resolve, control, metadata, { hasCapturedTurn: Boolean(anchor) });
            if (found && !control.cancelled && note.conversation === getConversation()) {
              anchor = found;
              liveAnchor = found.question;
              triedCheckpoint = false;
              for (const countFromEnd of [false, true]) {
                const target = resolve();
                if (control.cancelled || note.conversation !== getConversation() || target && !target.answerOnly && target.rectOf()) break;
                const moved = countFromEnd ? moveToCheckpoint(found.checkpoint, true) : recoverCheckpoint();
                if (moved) {
                  metadata.checkpointUsed = true;
                  await waitHistory(found.checkpoint.node, 360, control);
                }
              }
              const reacquired = resolve();
              if (!reacquired || reacquired.answerOnly) await scanBackToMatch(true);
            }
          }
          else if (!anchor) return record(note, "question-not-found", "网页暂未加载出能准确定位的问答。", metadata);
        }
        for (let attempt = 0; attempt < 16; attempt++) {
          metadata.attempts = attempt + 1;
          if (control.cancelled) return record(note, "cancelled", "已停止查找。", metadata);
          if (note.conversation !== getConversation()) return record(note, "different-conversation", "当前对话已变化。", metadata);
          // Rebind the question after layout changes or virtualizer updates.
          current = resolve();
          if (!current) {
            if (!recoverCheckpoint() && searchHistory && metadata.historyLoaded && !triedReturnScan) await scanBackToMatch();
            await frame();
            continue;
          }
          previouslyFound = true;
          if (previousElement && previousElement !== current.target) metadata.rebound++;
          previousElement = current.target;
          if (!alignQuestion || attempt > 0) { await frame(); await frame(); }
          if (control.cancelled || note.conversation !== getConversation()) continue;
          current = resolve();
          if (!current) { recoverCheckpoint(); continue; }
          if (previousElement !== current.target) { metadata.rebound++; previousElement = current.target; }
          if (!current.rectOf()) {
            if (!recoverCheckpoint()) reveal(current);
            await frame(); continue;
          }
          const movement = position(current.target, current.rectOf, {
            alignQuestion: alignQuestion && !current.answerOnly, tail: current.tail, preferredTop
          });
          if (!movement) { await frame(); continue; }
          initialTop ??= movement.beforeTop;
          await frame(); await frame();
          if (control.cancelled || note.conversation !== getConversation()) continue;
          const latest = resolve();
          if (!latest) continue;
          if (latest.target !== current.target) { metadata.rebound++; previousElement = latest.target; continue; }
          lastPosition = visiblePosition(latest.target, latest.rectOf, { beforeTop: initialTop });
          if (!lastPosition?.inView) {
            reveal(latest);
            continue;
          }
          control.restore = null;
          if (!settled && attempt < 15) {
            // The page can adjust its own scroll after remeasuring a turn.
            // Confirm the same target again once that layout update has run.
            settled = true;
            if (!alignQuestion || latest.answerOnly) preferredTop = lastPosition.afterTop;
            await settleLayout();
            continue;
          }
          Object.assign(metadata, lastPosition, { [latest.answerOnly ? "answerIndex" : "questionIndex"]: latest.message.index, kind: latest.answerOnly ? "answer" : "question" });
          if (note.conversation !== getConversation()) continue;
          if (latest.range && root.CSS?.highlights && root.Highlight) {
            clearTimeout(highlightTimer);
            root.CSS.highlights.set("gpt-answer-shelf-jump", new root.Highlight(latest.range));
            highlightTimer = setTimeout(() => root.CSS.highlights.delete("gpt-answer-shelf-jump"), HIGHLIGHT_MS);
          }
          if (searchHistory || anchor && alignQuestion && questionOnly) watchLanding(note, resolve, latest, lastPosition.afterTop);
          return record(note, "located", "已定位原问答。", metadata);
        }
        if (lastPosition && !lastPosition.inView) {
          return record(note, "outside-viewport", "已找到目标，但网页滚动未能将它显示出来。请复制页面诊断。", { ...metadata, ...lastPosition });
        }
        if (metadata.historyCandidates > 1 && !metadata.historyLoaded) {
          return record(note, "question-not-found", "历史中有多条匹配的问句，暂时无法确认原问答。", metadata);
        }
        if (metadata.historyLoaded || lastPosition?.inView) {
          return record(note, "target-not-ready", "已确认历史中的原问答，网页暂时没有重新显示这条内容。", metadata);
        }
        return record(note, previouslyFound ? "target-not-ready" : "question-not-found", "网页暂未加载出能准确定位的问答。", metadata);
      } catch {
        return record(note, "exception", "定位暂时失败，请复制页面诊断。", metadata);
      } finally {
        if (control.cancelled || !metadata.historyLoaded) control.restore?.();
        if (active === control) active = null;
        if (!landingWatch) releaseScrolling();
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
    return { jump: enqueue, cancel, diagnostic, isVisible, checkLanding, capturePair };
  }
  const api = { create };
  root.GPTStickyNavigation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
