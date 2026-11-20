(function (root) {
  "use strict";
  function create({ panel, handle, onMove = () => {}, window = root }) {
    const document = panel.ownerDocument;
    let anchor = { right: 20, top: 64 }, size = { width: 400, height: 500 }, drag = null;
    const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value));
    function place(requested = size) {
      const width = Math.max(0, Math.min(requested.width, window.innerWidth - 24));
      const top = clamp(anchor.top, 16, window.innerHeight - Math.min(240, requested.height) - 16);
      const height = Math.max(0, Math.min(requested.height, window.innerHeight - top - 16));
      const left = clamp(window.innerWidth - anchor.right - width, 12, window.innerWidth - width - 12);
      size = { width, height };
      Object.assign(panel.style, { width: `${width}px`, height: `${height}px`, left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
      return { left, top, width, height };
    }
    function finish(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const id = drag.id; drag = null; panel.removeAttribute("data-dragging");
      try { handle.releasePointerCapture(id); } catch { /* Capture can end outside the window. */ }
    }
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || drag || event.target.closest("button, input, textarea, a, select, [contenteditable='true']")) return;
      const box = panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, width: box.width, height: box.height };
      panel.setAttribute("data-dragging", ""); event.preventDefault();
      try { handle.setPointerCapture(event.pointerId); } catch { /* Document listeners also handle synthetic/local tests. */ }
    });
    document.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      const left = clamp(drag.left + event.clientX - drag.x, 12, window.innerWidth - drag.width - 12);
      const top = clamp(drag.top + event.clientY - drag.y, 16, window.innerHeight - drag.height - 16);
      anchor = { right: window.innerWidth - left - drag.width, top };
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
      event.preventDefault(); onMove();
    }, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    window.addEventListener("blur", () => { if (drag) finish({ pointerId: drag.id }); });
    return { place, get dragging() { return Boolean(drag); } };
  }
  const api = { create }; root.GPTStickyPanel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
