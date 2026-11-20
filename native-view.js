(function (root) {
  "use strict";
  // Keep native messages in their original DOM/React ancestry. The browser's
  // top layer changes where they are painted, not who owns their rendering.
  function create({ viewport, onChange = () => {}, onOpenMedia = () => false, onPromote = () => {}, document = root.document }) {
    const records = new Map();
    let frame = 0, updating = false;
    const owned = new WeakSet();
    const baseline = ["padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style", "border-color", "background-color", "color", "font-family", "font-size", "font-weight", "line-height", "text-align", "white-space"];
    function set(record, property, value) {
      if (!record.styles.has(property)) record.styles.set(property, [record.node.style.getPropertyValue(property), record.node.style.getPropertyPriority(property)]);
      if (record.requested.get(property) === value && record.node.style.getPropertyValue(property) === record.applied.get(property) && record.node.style.getPropertyPriority(property) === "important") return;
      if (record.node.style.getPropertyValue(property) !== value || record.node.style.getPropertyPriority(property) !== "important") record.node.style.setProperty(property, value, "important");
      record.requested.set(property, value); record.applied.set(property, record.node.style.getPropertyValue(property));
    }
    function release(node) {
      const record = records.get(node);
      if (!record) return;
      record.resize?.disconnect();
      try { if (node.matches(":popover-open")) node.hidePopover(); } catch { /* The page may have removed the turn. */ }
      for (const part of [...record.parts, record]) for (const [property, [value, priority]] of part.styles) if (part.node.style.getPropertyValue(property) === part.applied.get(property)) {
        if (value) part.node.style.setProperty(property, value, priority); else part.node.style.removeProperty(property);
      }
      node.removeAttribute("data-gpt-answer-shelf-native");
      if (record.popover == null) node.removeAttribute("popover"); else node.setAttribute("popover", record.popover);
      for (const part of [...record.parts, record]) owned.delete(part.node);
      records.delete(node);
    }
    function clear() {
      for (const node of [...records.keys()]) release(node);
      if (frame) root.cancelAnimationFrame(frame);
      frame = 0;
    }
    function schedule() {
      if (!frame) frame = root.requestAnimationFrame(() => { frame = 0; layout(); });
    }
    function layout() {
      if (updating) return;
      updating = true;
      try {
        const bounds = viewport.getBoundingClientRect();
        for (const [node, record] of records) {
          if (!node.isConnected || !record.slot.isConnected) { release(node); onChange(); continue; }
          const slot = record.slot;
          // The slot follows the current card width. A width measured while the
          // page had a narrow conversation pane must not cap an expanded card.
          slot.style.maxWidth = "100%";
          const box = slot.getBoundingClientRect();
          set(record, "width", `${box.width}px`);
          set(record, "left", `${box.left}px`); set(record, "top", `${box.top}px`);
          const height = node.getBoundingClientRect().height;
          if (Math.abs(slot.offsetHeight - height) > 1) slot.style.height = `${Math.ceil(height)}px`;
          const top = Math.max(0, bounds.top - box.top), bottom = Math.max(0, box.top + height - bounds.bottom);
          set(record, "clip-path", `inset(${Math.min(height, top)}px 0px ${Math.min(height, bottom)}px 0px)`);
          set(record, "visibility", box.top >= bounds.bottom || box.top + height <= bounds.top ? "hidden" : record.visibility);
        }
      } finally { updating = false; }
    }
    function nativeNode(message) {
      const turn = message?.turn;
      if (!turn?.isConnected || typeof turn.showPopover !== "function" || turn.hasAttribute("popover") && !records.has(turn)) return null;
      return root.getComputedStyle(turn).display === "contents" ? message.el : turn;
    }
    function mount(slot, message) {
      const node = nativeNode(message);
      if (!node || !node.isConnected || typeof node.showPopover !== "function") return false;
      let record = records.get(node);
      if (record) { record.slot = slot; prepareSlot(record); schedule(); return true; }
      const hidden = node.classList.contains("gpt-answer-shelf-hidden-turn");
      if (hidden) node.classList.remove("gpt-answer-shelf-hidden-turn");
      const computed = root.getComputedStyle(node), box = node.getBoundingClientRect();
      const values = baseline.map(property => [property, computed.getPropertyValue(property)]);
      record = { node, slot, role: message.role, width: box.width || viewport.clientWidth, margin: [computed.marginTop, computed.marginRight, computed.marginBottom, computed.marginLeft], styles: new Map(), applied: new Map(), requested: new Map(), parts: [], popover: node.getAttribute("popover"), visibility: computed.visibility, display: computed.display === "none" ? "block" : computed.display };
      records.set(node, record); owned.add(node);
      try {
        for (const [property, value] of values) set(record, property, value);
        for (const [property, value] of Object.entries({ position: "fixed", inset: "auto", margin: "0px", "box-sizing": "border-box", height: "auto", "min-height": "0px", "max-height": "none", "min-width": "0px", "max-width": "none", overflow: "visible", transform: "none", display: record.display, "pointer-events": "auto" })) set(record, property, value);
        // Release only the ancestor layout wrappers of an assistant body. Keep
        // its native descendants, type scale, diagrams and interactive controls.
        if (message.role === "assistant") {
          let part = message.el;
          while (part && part !== node && node.contains(part)) {
            if (/^(DIV|SECTION|ARTICLE)$/.test(part.tagName)) {
              const layoutPart = { node: part, styles: new Map(), applied: new Map(), requested: new Map() };
              record.parts.push(layoutPart); owned.add(part);
              for (const [property, value] of Object.entries({ width: "100%", "max-width": "none", "min-width": "0px", "box-sizing": "border-box", "align-self": "stretch" })) set(layoutPart, property, value);
            }
            part = part.parentElement;
          }
        }
        node.setAttribute("data-gpt-answer-shelf-native", ""); node.setAttribute("popover", "manual");
        node.showPopover();
        prepareSlot(record);
        slot.style.height = `${Math.ceil(box.height)}px`;
        if (root.ResizeObserver) { record.resize = new root.ResizeObserver(schedule); record.resize.observe(node); }
        if (hidden) node.classList.add("gpt-answer-shelf-hidden-turn");
        layout(); onPromote(); return true;
      } catch { release(node); if (hidden) node.classList.add("gpt-answer-shelf-hidden-turn"); return false; }
    }
    function prepareSlot(record) {
      const { slot } = record;
      slot.style.marginTop = record.margin[0]; slot.style.marginBottom = record.margin[2];
      if (record.role === "user") { slot.style.marginRight = "0px"; slot.style.width = `calc(100% - ${parseFloat(record.margin[3]) || 0}px)`; }
    }
    function reconcile(wanted) {
      const keep = new Set(), slots = new Set();
      for (const { slot, message } of wanted) if (mount(slot, message)) { keep.add(nativeNode(message)); slots.add(slot); }
      for (const node of [...records.keys()]) if (!keep.has(node)) release(node);
      layout();
      return slots;
    }
    function wheel(event) {
      const node = event.target.closest?.("[data-gpt-answer-shelf-native]");
      if (!node || !records.has(node) || !event.deltaY || event.ctrlKey) return;
      // Preserve native scrolling inside code blocks, tables and interactive views.
      for (let part = event.target; part && part !== node; part = part.parentElement) {
        const style = root.getComputedStyle(part);
        if (/(auto|scroll)/.test(style.overflowY) && part.scrollHeight > part.clientHeight && (event.deltaY > 0 ? part.scrollTop + part.clientHeight < part.scrollHeight - 1 : part.scrollTop > 0)) return;
      }
      event.preventDefault();
      viewport.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      schedule();
    }
    document.addEventListener("wheel", wheel, { capture: true, passive: false });
    root.addEventListener("click", event => {
      const node = event.target.closest?.("[data-gpt-answer-shelf-native]");
      if (!records.has(node) || !onOpenMedia(event, node)) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    document.addEventListener("keydown", event => {
      if (!event.target.closest?.("[data-gpt-answer-shelf-native]") || event.target.closest('input,textarea,[contenteditable="true"]')) return;
      const amount = { PageDown: viewport.clientHeight * .85, PageUp: -viewport.clientHeight * .85, Home: -viewport.scrollHeight, End: viewport.scrollHeight }[event.key];
      if (amount != null) { event.preventDefault(); viewport.scrollTop += amount; schedule(); }
    });
    viewport.addEventListener("scroll", schedule, { passive: true });
    root.addEventListener("resize", schedule);
    if (root.ResizeObserver) new root.ResizeObserver(schedule).observe(viewport);
    return { mount, reconcile, clear, layout, schedule,
      contains: node => Boolean(node?.closest?.("[data-gpt-answer-shelf-native]")),
      isOwnMutation: record => record.type === "attributes" && owned.has(record.target) && ["style", "popover", "data-gpt-answer-shelf-native"].includes(record.attributeName),
      get count() { return records.size; }, get width() { return Math.max(0, ...[...records.values()].map(record => record.width)); } };
  }
  const api = { create }; root.GPTStickyNative = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
