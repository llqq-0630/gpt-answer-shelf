(function (global) {
  "use strict";
  function nativeImage(event, turn) {
    if (event.button && event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
    const path = event.composedPath?.() || [], target = path.find(node => node.nodeType === 1) || event.target;
    if (!target?.closest) return null;
    const inside = node => turn.contains(node) || path.indexOf(turn) >= 0 && path.indexOf(node) >= 0 && path.indexOf(node) < path.indexOf(turn);
    const control = target.closest('button, a, [role="button"], [role="tab"]');
    let image = target.closest("img");
    if (!image) {
      const wrapper = control || target.closest("picture, figure");
      if (!wrapper || !inside(wrapper)) return null;
      const images = wrapper.querySelectorAll("img");
      if (images.length !== 1) return null;
      image = images[0];
    }
    if (!inside(image)) return null;
    const box = image.getBoundingClientRect();
    // Small gallery buttons select another image; they are not zoom triggers.
    if (box.width <= 96 && box.height <= 96 || control?.getAttribute("role") === "tab" || control?.hasAttribute("aria-selected")) return null;
    return image;
  }
  function create({ root, rich }) {
    const doc = root.ownerDocument;
    const make = (tag, className, text) => { const el = doc.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };
    const overlay = make("div", "media-overlay"); overlay.hidden = true;
    const dialog = make("section", "media-dialog"); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-label", "图片预览");
    const head = make("div", "media-head"), title = make("span", "media-title"), controls = make("div", "row"), stage = make("div", "media-stage"), art = make("div", "media-art rich");
    let scale = 1, fitWidth = 1, previousFocus, media;
    const control = (label, action) => { const b = make("button", "btn", label); b.type = "button"; b.addEventListener("click", action); controls.append(b); return b; };
    const amount = make("span", "muted"); amount.setAttribute("aria-live", "polite");
    function apply() { art.style.width = `${Math.round(fitWidth * scale)}px`; amount.textContent = `${Math.round(scale * 100)}%`; }
    function fit() {
      if (overlay.hidden) return;
      const image = art.querySelector(":scope > .rich-content > img"), svg = art.querySelector(":scope > .rich-content > svg"), box = svg?.viewBox?.baseVal;
      const vectorImage = image?.src.startsWith("data:image/svg+xml");
      const size = vectorImage ? media?.nodes[0]?.size : null;
      const width = size?.width || image?.naturalWidth || box?.width || stage.clientWidth;
      const height = size?.height || image?.naturalHeight || box?.height || stage.clientHeight;
      // Vectors can fill the preview without pixelation. Their default 300px
      // intrinsic IMG width must not limit the size of a large native diagram.
      fitWidth = Math.max(1, Math.min(stage.clientWidth - 32, vectorImage || svg ? Infinity : width, (stage.clientHeight - 32) * width / Math.max(height, 1)));
      apply();
    }
    function close() {
      if (overlay.hidden) return;
      try { if (overlay.matches(":popover-open")) overlay.hidePopover(); } catch { /* The document may be unloading. */ }
      overlay.hidden = true; art.replaceChildren(); media = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
    function raise() {
      if (overlay.hidden) return;
      const focused = root.activeElement;
      overlay.setAttribute("popover", "manual");
      try {
        // A newly rendered native message also enters the browser top layer.
        // Re-promote the preview so it stays above every message and the card.
        if (overlay.matches(":popover-open")) overlay.hidePopover();
        overlay.showPopover();
        if (focused && overlay.contains(focused)) focused.focus({ preventScroll: true });
      } catch { /* Fixed overlay fallback. */ }
    }
    controls.append(make("span", "muted", "滚轮缩放"), amount);
    control("适应窗口", () => { scale = 1; fit(); stage.scrollTop = stage.scrollLeft = 0; });
    const closeButton = control("关闭预览", close);
    head.append(title, controls); stage.append(art); dialog.append(head, stage); overlay.append(dialog); root.append(overlay);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    stage.addEventListener("wheel", event => {
      if (overlay.hidden || !event.deltaY) return;
      event.preventDefault(); event.stopPropagation();
      const before = art.getBoundingClientRect();
      const x = (event.clientX - before.left) / Math.max(before.width, 1), y = (event.clientY - before.top) / Math.max(before.height, 1);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
      scale = Math.min(6, Math.max(.25, scale * Math.exp(-Math.max(-250, Math.min(250, delta)) * .002))); apply();
      const after = art.getBoundingClientRect();
      stage.scrollLeft += after.left + x * after.width - event.clientX;
      stage.scrollTop += after.top + y * after.height - event.clientY;
    }, { passive: false });
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const buttons = [...controls.querySelectorAll("button")], focused = root.activeElement;
      if (event.shiftKey && focused === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && focused === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    });
    if (global.ResizeObserver) new ResizeObserver(fit).observe(stage);
    function open(node) {
      media = rich.sanitize({ version: 1, nodes: [node] });
      const picture = media?.nodes[0];
      if (!rich.isMedia(picture)) { media = null; return false; }
      if (overlay.hidden) previousFocus = root.activeElement || doc.activeElement;
      title.textContent = picture.attrs.alt || picture.attrs.title || (picture.layout === "graphic" ? "概念示意图" : "图片预览");
      art.replaceChildren(rich.render(media, doc)); overlay.hidden = false;
      raise();
      scale = 1; stage.scrollTop = stage.scrollLeft = 0; fit();
      art.querySelector("img")?.addEventListener("load", fit, { once: true });
      closeButton.focus({ preventScroll: true });
      return true;
    }
    return { open, close, raise, get isOpen() { return !overlay.hidden; }, openNative(event, turn) {
      const image = nativeImage(event, turn), node = image && rich.imageForPreview(image);
      return Boolean(node && open(node));
    } };
  }
  const api = { create, nativeImage }; global.GPTStickyMedia = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
