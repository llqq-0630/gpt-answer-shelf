(function (root) {
  "use strict";
  function create({ getConversation, resolve, document = root.document }) {
    let mark = null, restoring = false, frame = 0;
    function scrollers(node) {
      const result = [];
      for (let current = node?.parentElement; current; current = current.parentElement) {
        if (current === document.scrollingElement || /(auto|scroll|overlay)/.test(root.getComputedStyle(current).overflowY) && current.scrollHeight > current.clientHeight) result.push(current);
      }
      if (document.scrollingElement && !result.includes(document.scrollingElement)) result.push(document.scrollingElement);
      return result;
    }
    function capture(note) {
      if (mark?.conversation === getConversation()) return;
      const source = resolve(note), rect = source?.rect?.();
      mark = { note, conversation: getConversation(), top: rect?.top, positions: scrollers(source?.node).map(node => ({ node, top: node.scrollTop, left: node.scrollLeft })) };
    }
    function restore() {
      if (!mark || restoring || mark.conversation !== getConversation()) return;
      restoring = true;
      try {
        for (const position of mark.positions) if (position.node.isConnected) { position.node.scrollTop = position.top; position.node.scrollLeft = position.left; }
        const source = resolve(mark.note), rect = source?.rect?.();
        if (rect && Number.isFinite(mark.top)) {
          const target = scrollers(source.node)[0];
          if (target && Math.abs(rect.top - mark.top) > 1) target.scrollTop += rect.top - mark.top;
        }
        // A reflow can change the scroll offset needed for the same visual
        // position. Keep that offset so future frames do not bounce twice.
        for (const position of mark.positions) if (position.node.isConnected) { position.top = position.node.scrollTop; position.left = position.node.scrollLeft; }
      } finally { restoring = false; }
    }
    function pin() { if (mark && !frame) frame = root.requestAnimationFrame(() => { frame = 0; restore(); }); }
    function release({ restorePosition = true } = {}) { if (restorePosition) restore(); mark = null; if (frame) root.cancelAnimationFrame(frame); frame = 0; }
    function userIntent(event) {
      if (!mark || event.target.closest?.('[data-gpt-answer-shelf="portal"], [data-gpt-answer-shelf-native]')) return;
      if (event.type === "wheel" && event.ctrlKey) return;
      if (event.type === "keydown" && (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) || event.target.closest?.('input,textarea,[contenteditable="true"]'))) return;
      // Keep generated replies from moving the reader, but never fight an
      // intentional scroll, scrollbar drag or keyboard action in the main page.
      release({ restorePosition: false });
    }
    for (const type of ["wheel", "pointerdown", "touchstart", "keydown"]) root.addEventListener(type, userIntent, { capture: true, passive: true });
    root.addEventListener("scroll", event => {
      if (mark?.positions.some(position => event.target === position.node || event.target === document && position.node === document.scrollingElement)) pin();
    }, { capture: true, passive: true });
    return { capture, restore, pin, release, get active() { return Boolean(mark); } };
  }
  const api = { create }; root.GPTStickyReading = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
