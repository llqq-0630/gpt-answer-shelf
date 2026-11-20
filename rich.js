(function (root) {
  "use strict";
  const MAX_SNAPSHOT_SIZE = 8 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const HTML = "http://www.w3.org/1999/xhtml", MATH = "http://www.w3.org/1998/Math/MathML", SVG = "http://www.w3.org/2000/svg";
  const htmlTags = new Set("div span p br h1 h2 h3 h4 h5 h6 strong b em i u s del mark sub sup small a img figure figcaption ul ol li blockquote pre code hr table thead tbody tfoot tr th td dl dt dd details summary".split(" "));
  const mathTags = new Set("math mrow mi mn mo mtext ms mspace mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mlabeledtr mtd menclose mpadded mphantom mstyle merror semantics".split(" "));
  const svgTags = new Set("svg g path rect circle ellipse line polyline polygon text tspan defs use symbol clipPath mask marker title desc foreignObject linearGradient radialGradient stop image".split(" "));
  const svgAttributes = new Set("viewBox width height x y x1 y1 x2 y2 dx dy d points r rx ry cx cy fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray opacity transform preserveAspectRatio id href clip-path mask marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity font-size font-family font-weight font-style text-anchor dominant-baseline overflow title".split(" "));
  const mathAttributes = new Set("display mathvariant mathsize mathcolor mathbackground stretchy fence separator accent accentunder movablelimits symmetric largeop lspace rspace minsize maxsize linethickness bevelled columnalign rowalign columnspacing rowspacing columnlines rowlines frame framespacing equalrows equalcolumns scriptlevel displaystyle notation width height depth voffset lquote rquote encoding".split(" "));
  const styleProperties = new Set("display position font-family font-size font-weight font-style line-height vertical-align white-space letter-spacing text-align text-indent text-decoration-line list-style-type list-style-position width height min-width min-height max-width max-height top left right bottom margin margin-top margin-right margin-bottom margin-left margin-inline-start margin-inline-end padding padding-top padding-right padding-bottom padding-left padding-inline-start border-top-width border-top-style border-right-width border-right-style border-bottom-width border-bottom-style border-left-width border-left-style transform transform-origin box-sizing overflow color background-color border-color border-radius aspect-ratio object-fit object-position align-items justify-content flex-direction gap".split(" "));
  const typographyProperties = new Set("font-family font-size font-weight font-style line-height letter-spacing white-space text-align".split(" "));
  for (const property of ["z-index", "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-column", "grid-row", "background-image"]) styleProperties.add(property);
  const safePaint = value => !/[<>\\]|(?:url\((?!#[\w:.-]+\))|expression|javascript|@import)/i.test(value);
  function safeUrl(value, image = false) {
    if (typeof value !== "string" || value.length > MAX_SNAPSHOT_SIZE) return null;
    // Native DIL diagrams can be SVG data URLs with raw XML, Chinese labels,
    // spaces or a ;utf8 parameter. Canonicalize the payload instead of dropping it.
    if (image && /^data:image\//i.test(value)) {
      const match = /^data:(image\/(?:png|jpe?g|webp|gif|avif|svg\+xml))((?:;[^,]*)?),(.*)$/is.exec(value);
      if (!match) return null;
      const type = match[1].toLowerCase(), parameters = match[2].toLowerCase(), payload = match[3];
      if (/;base64(?:;|$)/.test(parameters)) {
        const encoded = payload.replace(/\s/g, "");
        return encoded && /^[a-z\d+/=]+$/i.test(encoded) ? `data:${type};base64,${encoded}` : null;
      }
      if (type !== "image/svg+xml" || !/^((?:;utf8)|(?:;charset=(?:utf-8|us-ascii)))*$/.test(parameters)) return null;
      let svg = payload;
      try { svg = decodeURIComponent(payload); } catch { /* Raw SVG may contain literal percentages. */ }
      if (!/<svg(?:\s|>)/i.test(svg)) return null;
      const canonical = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      return canonical.length <= MAX_SNAPSHOT_SIZE ? canonical : null;
    }
    if (/[\u0000-\u0020\u007f]/.test(value)) return null;
    if (image && /^blob:https?:\/\/[^/\s]+\/[a-z\d-]+$/i.test(value)) return value;
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }
  function cleanAttributes(tag, ns, raw = {}) {
    const result = {};
    if (!raw || typeof raw !== "object") return result;
    for (const [name, input] of Object.entries(raw)) {
      if (typeof input !== "string" && typeof input !== "number") continue;
      const value = String(input);
      if (value.length > 8000 && !(ns === "html" && tag === "img" && name === "src") && !(ns === "svg" && tag === "image" && name === "href")) continue;
      if (ns === "html") {
        if (tag === "img" && name === "src") { const url = safeUrl(value, true); if (url) result.src = url; }
        else if (tag === "img" && name === "referrerpolicy" && ["no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url"].includes(value)) result[name] = value;
        else if (tag === "img" && name === "crossorigin" && ["anonymous", "use-credentials", ""].includes(value)) result[name] = value;
        else if (tag === "a" && name === "href") { const url = safeUrl(value); if (url) result.href = url; }
        else if (["alt", "title"].includes(name)) result[name] = value;
        else if (["colspan", "rowspan", "start", "value"].includes(name) && /^-?\d{1,4}$/.test(value)) result[name] = value;
        else if (name === "scope" && ["row", "col", "rowgroup", "colgroup"].includes(value)) result[name] = value;
      } else if (ns === "svg" && tag === "image" && name === "href") { const url = safeUrl(value, true); if (url) result.href = url; }
      else if (ns === "math" && mathAttributes.has(name) && safePaint(value)) result[name] = value;
      else if (ns === "svg" && svgAttributes.has(name) && safePaint(value)) {
        if ((name === "href" && !/^#[\w:.-]+$/.test(value)) || (name === "id" && !/^[\w:.-]+$/.test(value))) continue;
        result[name] = value;
      }
    }
    return result;
  }
  function cleanStyles(raw = {}) {
    const result = {};
    for (const [property, value] of Object.entries(raw || {})) {
      if (!styleProperties.has(property) || typeof value !== "string" || value.length > 300 || !safePaint(value)) continue;
      if (property === "position" && !["static", "relative", "absolute"].includes(value)) continue;
      if (property === "display" && !["inline", "inline-block", "block", "flex", "grid", "table", "table-row", "table-cell", "none"].includes(value)) continue;
      result[property] = value;
    }
    return result;
  }
  const proseTags = new Set("h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code table dl dt dd math".split(" "));
  function graphicSize(size) {
    return Number.isFinite(size?.width) && Number.isFinite(size?.height) && size.width >= 120 && size.width <= 8000 && size.height >= 80 && size.height <= 4096 && size.width / size.height >= .25;
  }
  function paintedShape(node) {
    const style = node.style || {}, color = style["background-color"];
    const border = ["top", "right", "bottom", "left"].some(side => parseFloat(style[`border-${side}-width`]) > 0 && !["none", "hidden"].includes(style[`border-${side}-style`]));
    return (color && !["transparent", "rgba(0, 0, 0, 0)"].includes(color) || border) && (node.children || []).some(child => typeof child.text === "string" ? Boolean(child.text.trim()) : Boolean(child.children?.length));
  }
  function smallIcon(node) {
    if (node.ns !== "svg" || node.tag !== "svg") return false;
    const box = (node.attrs?.viewBox || "").split(/[\s,]+/).map(Number);
    const width = parseFloat(node.style?.width || node.attrs?.width) || box[2], height = parseFloat(node.style?.height || node.attrs?.height) || box[3];
    return width > 0 && width <= 96 && height > 0 && height <= 64;
  }
  function photoSurface(node) {
    let image = false, words = false;
    function inspect(part) {
      if (part.tag === "img") { image = true; return; }
      if (part.tag === "figcaption" || smallIcon(part)) return;
      if (typeof part.text === "string") { words ||= Boolean(part.text.trim()); return; }
      if (part.ns === "svg") { words = true; return; }
      for (const child of part.children || []) inspect(child);
    }
    inspect(node); return image && !words;
  }
  function photoAction(node) {
    const style = node.style || {}, width = parseFloat(style.width), height = parseFloat(style.height), radius = parseFloat(style["border-radius"]);
    if (node.ns !== "html" || style.position !== "absolute" || !(width > 0 && width <= 96 && height > 0 && height <= 96)) return false;
    if (!(parseFloat(style.top) >= 0 && parseFloat(style.top) <= 64 && parseFloat(style.right) >= 0 && parseFloat(style.right) <= 64)) return false;
    if (!(style["border-radius"]?.includes("%") ? radius >= 50 : radius >= Math.min(width, height) / 2 - 1)) return false;
    const icons = part => smallIcon(part) || part.children?.some(icons);
    const text = part => typeof part.text === "string" ? Boolean(part.text.trim()) : part.ns !== "svg" && part.children?.some(text);
    return Boolean(icons(node) && !text(node));
  }
  // A renderer class identifies a component, not a picture. Only a bounded
  // drawing whose labels belong to positioned shapes can become one media item.
  function isolatedGraphic(node) {
    if (node?.ns !== "html" || !["div", "figure"].includes(node.tag) || !graphicSize(node.size)) return false;
    let positioned = 0, textLength = 0, valid = true;
    function inspect(part, inShape = false) {
      if (typeof part.text === "string") {
        const text = part.text.trim(); textLength += text.length;
        if (text && !inShape) valid = false;
        return;
      }
      if (proseTags.has(part.tag) || ["math-html", "math-block"].includes(part.layout)) valid = false;
      const shape = part.tag !== "img" && (part.style?.position === "absolute" || paintedShape(part));
      if (shape) positioned++;
      for (const child of part.children || []) inspect(child, inShape || shape || part.tag === "figcaption" || part.ns === "svg");
    }
    for (const child of node.children || []) inspect(child);
    return valid && positioned >= 2 && textLength <= 2500;
  }
  function restoreFlow(node, first = true, inMath = false) {
    if (typeof node.text === "string") return;
    if (!first && node.layout === "graphic") return;
    inMath ||= node.ns === "math" || ["math-html", "math-block"].includes(node.layout);
    if (!inMath && node.ns === "svg" && node.tag === "svg") {
      const box = (node.attrs.viewBox || "").split(/[\s,]+/).map(Number);
      const width = box[2] || parseFloat(node.attrs.width), height = box[3] || parseFloat(node.attrs.height);
      if (width > 96 || height > 64) { node.layout = "diagram"; node.attrs.title ||= "概念示意图"; }
      node.style = Object.fromEntries(Object.entries(node.style || {}).filter(([property]) => ["color", "background-color", "vertical-align"].includes(property)));
      if (!Object.keys(node.style).length) delete node.style;
    }
    if (!first && node.ns === "html") {
      const size = { width: parseFloat(node.style?.width), height: parseFloat(node.style?.height) };
      if (isolatedGraphic({ ...node, size })) {
        node.layout = "graphic"; node.size = size;
        Object.assign(node.style, { position: "relative", top: "0px", left: "0px", right: "auto", bottom: "auto", "max-width": "none" });
        for (const property of ["margin", "margin-top", "margin-right", "margin-bottom", "margin-left"]) node.style[property] = "0px";
        return;
      }
    }
    if (node.style && node.ns === "html" && !["math-html", "math-block"].includes(node.layout)) {
      const flowProperties = new Set([...typographyProperties, "text-indent", "text-decoration-line", "margin-top", "margin-bottom", "margin-inline-start", "margin-inline-end", "padding-inline-start", "list-style-type", "list-style-position", "color"]);
      if (["code", "pre", "mark"].includes(node.tag)) flowProperties.add("background-color");
      if (node.tag === "img") for (const property of ["border-radius", "object-fit", "object-position", "vertical-align"]) flowProperties.add(property);
      node.style = Object.fromEntries(Object.entries(node.style).filter(([property]) => flowProperties.has(property)));
      if (!Object.keys(node.style).length) delete node.style;
    }
    for (const child of node.children || []) restoreFlow(child, false, inMath);
  }
  function isMedia(node) {
    return Boolean(node && (node.ns === "html" && node.tag === "img" && safeUrl(node.attrs?.src, true) || node.ns === "svg" && node.tag === "svg" && node.layout === "diagram" || node.layout === "graphic" && isolatedGraphic(node)));
  }
  function imageSize(size) {
    return Number.isFinite(size?.width) && Number.isFinite(size?.height) && size.width > 0 && size.width <= 16384 && size.height > 0 && size.height <= 32768;
  }
  function blockImage(node) {
    return node.tag === "img" && (node.size?.width > 96 || !node.size && !node.style?.width && /^data:image\/svg\+xml/i.test(node.attrs.src || ""));
  }
  function backgroundSource(value) {
    const match = /^url\((?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^'"()]*))\)$/.exec(value || "");
    return match ? safeUrl((match[1] ?? match[2] ?? match[3]).replace(/\\(["'\\])/g, "$1"), true) : null;
  }
  function sanitize(input) {
    if (!input || input.version !== 1 || !Array.isArray(input.nodes)) return null;
    let count = 0, size = 0;
    function clean(node, depth) {
      if (!node || typeof node !== "object" || depth > 60 || ++count > 15000) throw new Error("Rich answer is too large");
      if (typeof node.text === "string") { size += node.text.length; return { text: node.text.slice(0, 250000) }; }
      const ns = node.ns || "html", tags = ns === "html" ? htmlTags : ns === "math" ? mathTags : ns === "svg" ? svgTags : null;
      if (!tags?.has(node.tag)) return null;
      const attrs = cleanAttributes(node.tag, ns, node.attrs);
      const style = cleanStyles(node.style);
      size += JSON.stringify(attrs).length + JSON.stringify(style).length;
      let children = (Array.isArray(node.children) ? node.children : []).map(child => clean(child, depth + 1)).filter(Boolean);
      // Old snapshots converted image toolbar buttons to styled DIVs. Repair
      // only small icon badges over photo surfaces; retain labels and drawings.
      if (ns === "html" && photoSurface({ ...node, children })) children = children.filter(child => !photoAction(child));
      const result = { tag: node.tag, ns, attrs, children };
      if (node.tag === "img" && imageSize(node.size)) result.size = { width: node.size.width, height: node.size.height };
      if (node.tag === "img" && /^[a-z\d]{1,64}$/i.test(node.assetKey || "")) result.assetKey = node.assetKey;
      if (Object.keys(style).length) result.style = style;
      if (["media-grid", "math-html", "math-block"].includes(node.layout)) result.layout = node.layout;
      if (node.layout === "diagram" && ns === "svg" && node.tag === "svg") result.layout = "diagram";
      if (node.layout === "graphic") {
        if (isolatedGraphic({ ...result, size: node.size })) {
          result.layout = "graphic"; result.size = { width: node.size.width, height: node.size.height };
        } else {
          // Repair 0.1.9 snapshots even when the native answer is not loaded.
          // Keep semantic text/math and recover independent nested drawings.
          restoreFlow(result);
        }
      }
      return result;
    }
    try {
      const nodes = input.nodes.map(node => clean(node, 0)).filter(Boolean);
      const typography = Object.fromEntries(Object.entries(cleanStyles(input.typography)).filter(([property]) => typographyProperties.has(property)));
      return size <= MAX_SNAPSHOT_SIZE ? { version: 1, nodes, typography, ...(input.kind === "images" && /^[a-z\d]{1,64}$/i.test(input.mediaKey || "") ? { kind: "images", mediaKey: input.mediaKey } : {}) } : null;
    } catch { return null; }
  }
  function hasContent(doc) {
    return Boolean(doc?.nodes?.some(function content(node) {
      return typeof node.text === "string" ? Boolean(node.text.trim()) : node.tag === "img" && Boolean(safeUrl(node.attrs?.src, true)) || ["math", "svg", "hr"].includes(node.tag) || node.layout === "graphic" || node.children?.some(content);
    }));
  }
  function capture(body) {
    if (!body) return null;
    const doc = body.ownerDocument;
    let count = 0;
    function stylesOf(computed) {
      const styles = {};
      for (const property of styleProperties) {
        const value = computed.getPropertyValue(property);
        if (value) styles[property] = value;
      }
      for (const property of ["z-index", "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-column", "grid-row", "background-image"]) {
        const value = computed.getPropertyValue(property);
        if (value && !/url\(/i.test(value)) styles[property] = value;
      }
      return styles;
    }
    function isGraphicRoot(node) {
      if (!["div", "figure"].includes(node.localName) || node.querySelector("h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,code,table,dl,math,.katex,.katex-display")) return false;
      const bounds = node.getBoundingClientRect();
      const size = { width: bounds.width, height: bounds.height };
      if (!graphicSize(size)) return false;
      let inspected = 0;
      function probe(part) {
        if (++inspected > 600) return { text: "not-an-isolated-drawing" };
        if (part.nodeType === 3) return { text: part.nodeValue || "" };
        if (part.nodeType !== 1) return { text: "" };
        if ((part.localName === "button" || part.getAttribute("role") === "button") && !part.textContent.trim()) return { text: "" };
        const computed = part.ownerDocument.defaultView.getComputedStyle(part), style = { position: computed.position, "background-color": computed.backgroundColor };
        for (const side of ["top", "right", "bottom", "left"]) { style[`border-${side}-width`] = computed.getPropertyValue(`border-${side}-width`); style[`border-${side}-style`] = computed.getPropertyValue(`border-${side}-style`); }
        return { tag: part.localName, ns: part.namespaceURI === SVG ? "svg" : part.namespaceURI === MATH ? "math" : "html", style, children: [...(part.shadowRoot || part).childNodes].map(probe) };
      }
      const candidate = probe(node);
      return inspected <= 600 && isolatedGraphic({ ...candidate, size });
    }
    function read(node, mathHtml = false, depth = 0, graphic = false) {
      if (++count > 15000 || depth > 60) throw new Error("Rich answer is too large");
      if (node.nodeType === 3) return { text: node.nodeValue || "" };
      if (node.nodeType !== 1 || node.hasAttribute("data-gpt-answer-shelf") || node.hasAttribute("data-gpt-sticky-host")) return null;
      if (node.hasAttribute("hidden")) return null;
      const localTag = node.localName;
      const graphicRoot = !graphic && isGraphicRoot(node);
      const graphicScope = graphic || graphicRoot;
      if (localTag === "iframe") {
        try {
          const frame = node.contentDocument;
          if (frame?.documentElement) {
            const frameBody = frame.documentElement.namespaceURI === SVG ? frame.documentElement : frame.body;
            const diagram = frameBody && read(frameBody, false, depth + 1);
            if (diagram) return diagram;
          }
        } catch { /* Cross-origin frames cannot be read by the page script. */ }
        return { tag: "p", ns: "html", attrs: {}, children: [{ text: "此嵌入图示暂无法复制，请定位原回答查看。" }] };
      }
      if (localTag === "canvas") {
        try { return { tag: "img", ns: "html", attrs: { src: node.toDataURL("image/png"), alt: "原回答中的图表" }, children: [] }; }
        catch { return { text: "图表暂无法保存，请在原回答中查看。" }; }
      }
      if (["script", "style", "input", "textarea", "select", "object", "embed", "noscript"].includes(localTag)) return null;
      // KaTeX carries native MathML next to its visual HTML. Use the native tree
      // without its hidden wrapper, so no page stylesheet or remote library is needed.
      if (node.classList.contains("katex-display") || node.classList.contains("katex")) {
        const math = node.querySelector("math");
        if (math) {
          const result = read(math, false, depth + 1);
          if (result) {
            result.attrs.display = node.classList.contains("katex-display") ? "block" : math.getAttribute("display") || "inline";
            const computed = doc.defaultView.getComputedStyle(node.querySelector(".katex") || node);
            result.style = { "font-size": computed.fontSize, "text-align": doc.defaultView.getComputedStyle(node).textAlign };
          }
          return result;
        }
        mathHtml = true;
      }
      if (node.classList.contains("sr-only") || node.classList.contains("katex-mathml") || node.hasAttribute("hidden")) return null;
      const ns = node.namespaceURI === MATH ? "math" : node.namespaceURI === SVG ? "svg" : "html";
      if (ns === "math" && ["annotation", "annotation-xml"].includes(localTag)) return null;
      const originalTag = ns === "svg" ? node.tagName : localTag;
      const allowed = ns === "html" ? htmlTags : ns === "math" ? mathTags : svgTags;
      const tag = allowed.has(originalTag) ? originalTag : ns === "html" ? "div" : null;
      if (!tag) return null;
      const attrs = Object.fromEntries([...node.attributes].map(attr => [attr.localName === "href" ? "href" : attr.name, attr.value]));
      const sourceWindow = node.ownerDocument.defaultView || doc.defaultView;
      if (ns === "html" && !graphicScope && ["div", "span", "figure"].includes(tag) && !node.textContent.trim() && !node.querySelector("img,svg,canvas,iframe,math")) {
        const computed = sourceWindow.getComputedStyle(node), src = backgroundSource(computed.backgroundImage), bounds = node.getBoundingClientRect();
        // Some renderers keep an IMG only for preloading and paint the visible
        // SVG as a CSS background. Copy the independent picture, never its answer.
        if (src && bounds.width >= 120 && bounds.height >= 80) return { tag: "img", ns: "html", attrs: { src, alt: node.getAttribute("aria-label") || "原回答中的图示" }, size: { width: bounds.width, height: bounds.height }, style: { display: "block", "border-radius": computed.borderRadius }, children: [] };
      }
      if (ns === "svg" && originalTag === "image" && attrs.href) { try { attrs.href = new URL(attrs.href, node.baseURI).href; } catch { delete attrs.href; } }
      if (ns === "svg") {
        const computed = sourceWindow.getComputedStyle(node);
        for (const name of ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "stop-color", "stop-opacity", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"]) {
          let value = computed.getPropertyValue(name);
          value = value.replace(/url\(["']?([^)'"\s]+)["']?\)/g, (match, url) => {
            try {
              const target = new URL(url, node.baseURI), source = new URL(node.ownerDocument.URL);
              if (target.hash && target.href.split("#")[0] === source.href.split("#")[0]) return `url(${target.hash})`;
            } catch { /* Unsafe paint references are removed during sanitation. */ }
            return match;
          });
          if (value && safePaint(value)) attrs[name] = value;
        }
        if (originalTag === "svg" && !mathHtml && !graphicScope && !node.closest('.katex, .katex-display, mjx-container')) {
          const viewBox = node.viewBox?.baseVal, width = viewBox?.width || parseFloat(attrs.width) || parseFloat(computed.width), height = viewBox?.height || parseFloat(attrs.height) || parseFloat(computed.height);
          if (width > 96 || height > 64) {
            if (!attrs.viewBox && width > 0 && height > 0) attrs.viewBox = `0 0 ${width} ${height}`;
            attrs.title = node.getAttribute("aria-label") || node.querySelector("title")?.textContent || "概念示意图";
          }
        }
      }
      if (tag === "img") {
        attrs.src = node.currentSrc || node.src || attrs.src;
        rememberImage(node);
        if (!node.currentSrc && node.srcset) {
          const candidates = node.srcset.split(",").map(candidate => {
            const [url, descriptor] = candidate.trim().split(/\s+/);
            try { return { url: safeUrl(new URL(url, node.baseURI).href, true), weight: parseFloat(descriptor) || 1 }; } catch { return null; }
          }).filter(candidate => candidate?.url).sort((a, b) => b.weight - a.weight);
          if (candidates.length) attrs.src = candidates[0].url;
        }
      }
      if (tag === "a" && node.href) attrs.href = node.href;
      const assigned = localTag === "slot" ? node.assignedNodes({ flatten: true }) : null;
      const childNodes = assigned?.length ? assigned : [...(node.shadowRoot || node).childNodes];
      const result = { tag, ns, attrs, children: [...childNodes].map(child => read(child, mathHtml || originalTag === "foreignObject", depth + 1, graphicScope)).filter(Boolean) };
      if (ns === "html" && (localTag === "button" || node.getAttribute("role") === "button") && (!graphicScope || !node.textContent.trim()) && !result.children.some(function media(child) { return child.tag === "img" || child.tag === "math" || ["diagram", "graphic"].includes(child.layout) || child.ns === "svg" && child.tag === "svg" && !smallIcon(child) || child.children?.some(media); })) return null;
      if (ns === "svg" && originalTag === "svg" && attrs.title) result.layout = "diagram";
      if (mathHtml) {
        const computed = sourceWindow.getComputedStyle(node), style = {};
        for (const property of styleProperties) {
          if (property === "color" && !node.style.color) continue;
          const value = computed.getPropertyValue(property);
          if (value) style[property] = value;
        }
        result.style = style;
        if (node.classList.contains("katex")) result.layout = "math-html";
        if (node.classList.contains("katex-display")) result.layout = "math-block";
      } else if (ns === "svg") {
        const style = {};
        if (node.style.verticalAlign) style["vertical-align"] = node.style.verticalAlign;
        if (originalTag === "svg") {
          const computed = sourceWindow.getComputedStyle(node);
          style["background-color"] = computed.backgroundColor;
          style.color = computed.color;
        }
        if (Object.keys(style).length) result.style = style;
      }
      else if (ns === "html") {
        const computed = sourceWindow.getComputedStyle(node), style = {};
        if (/^(p|h[1-6]|strong|b|em|i|u|s|del|mark|sub|sup|small|pre|code|blockquote|ul|ol|li|dl|dt|dd|figcaption|th|td)$/.test(tag)) {
          for (const property of typographyProperties) style[property] = computed.getPropertyValue(property);
          for (const property of ["text-indent", "text-decoration-line"]) style[property] = computed.getPropertyValue(property);
        }
        if (["div", "span", "a"].includes(tag) && node.parentElement) {
          const parentStyle = sourceWindow.getComputedStyle(node.parentElement);
          for (const property of typographyProperties) if (computed.getPropertyValue(property) !== parentStyle.getPropertyValue(property)) style[property] = computed.getPropertyValue(property);
        }
        if (/^(p|h[1-6]|ul|ol|li|blockquote|dl|dt|dd|pre|figure|figcaption)$/.test(tag)) {
          for (const property of ["margin-top", "margin-bottom", "margin-inline-start", "margin-inline-end", "padding-inline-start", "list-style-type", "list-style-position"]) style[property] = computed.getPropertyValue(property);
        }
        if (tag === "code" || tag === "pre" || tag === "mark") style["background-color"] = computed.backgroundColor;
        if (node.parentElement && computed.color !== sourceWindow.getComputedStyle(node.parentElement).color) style.color = computed.color;
        if (tag === "img") {
          if (computed.display === "none") result.preload = true;
          style["border-radius"] = computed.borderRadius;
          style["object-fit"] = computed.objectFit;
          style["object-position"] = computed.objectPosition;
          style.display = "block";
          style["vertical-align"] = computed.verticalAlign;
          const width = Number.parseFloat(computed.width), height = Number.parseFloat(computed.height);
          if (width > 0 && width <= 96) {
            style.width = computed.width;
            if (height > 0 && height <= 96) style.height = computed.height;
          }
          const bounds = node.getBoundingClientRect();
          if (imageSize({ width: bounds.width, height: bounds.height })) result.size = { width: bounds.width, height: bounds.height };
        }
        if (Object.keys(style).length) result.style = style;
        if (node.children.length >= 2 && node.children.length <= 6 && [...node.children].filter(child => child.matches("img") || child.querySelector("img")).length >= 2 && /grid|flex/.test(computed.display)) result.layout = "media-grid";
      }
      if (graphicScope && ns === "svg") result.style = stylesOf(sourceWindow.getComputedStyle(node));
      if (graphicScope && ns === "html") {
        const computed = sourceWindow.getComputedStyle(node);
        result.style = stylesOf(computed);
        for (const pseudo of ["::before", "::after"]) {
          const generated = sourceWindow.getComputedStyle(node, pseudo);
          if (!generated.content || ["none", "normal"].includes(generated.content)) continue;
          let text = "";
          try { text = JSON.parse(generated.content); } catch { /* CSS images are handled separately. */ }
          const part = { tag: "span", ns: "html", attrs: {}, style: stylesOf(generated), children: text ? [{ text }] : [] };
          if (pseudo === "::before") result.children.unshift(part); else result.children.push(part);
        }
        const background = /^url\(["']?(.*?)["']?\)$/.exec(computed.backgroundImage || "");
        if (background) {
          try {
            const src = safeUrl(new URL(background[1], node.baseURI).href, true);
            if (src) {
              if (computed.position === "static") result.style.position = "relative";
              result.children.unshift({ tag: "img", ns: "html", attrs: { src, alt: "图示背景" }, style: { position: "absolute", top: "0px", left: "0px", width: "100%", height: "100%", "object-fit": computed.backgroundSize === "contain" ? "contain" : "cover" }, children: [] });
            }
          } catch { /* Preserve other diagram primitives if a background is unavailable. */ }
        }
        if (graphicRoot) {
          const bounds = node.getBoundingClientRect(), width = bounds.width || parseFloat(computed.width), height = bounds.height || parseFloat(computed.height);
          if (width > 0 && height > 0) {
            result.layout = "graphic"; result.size = { width: Math.ceil(width), height: Math.ceil(height) };
            Object.assign(result.style, { width: `${Math.ceil(width)}px`, height: `${Math.ceil(height)}px`, "max-width": "none", "min-width": "0px", "box-sizing": "border-box" });
            Object.assign(result.style, { position: "relative", top: "0px", left: "0px", right: "auto", bottom: "auto" });
            for (const property of ["margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "margin-inline-start", "margin-inline-end"]) result.style[property] = "0px";
          }
        }
      }
      return result;
    }
    try {
      const computed = doc.defaultView.getComputedStyle(body);
      const typography = Object.fromEntries([...typographyProperties].map(property => [property, computed.getPropertyValue(property)]));
      const nodes = [...(body.shadowRoot || body).childNodes].map(node => read(node)).filter(Boolean);
      const visibleImages = new Set();
      function inspect(node) {
        if (node.tag === "img" && !node.preload) { const src = safeUrl(node.attrs.src, true); if (src) visibleImages.add(src); }
        for (const child of node.children || []) inspect(child);
      }
      nodes.forEach(inspect);
      function prune(parts) {
        return parts.filter(node => !(node.preload && visibleImages.has(safeUrl(node.attrs.src, true)))).map(node => {
          if (node.children) node.children = prune(node.children);
          return node;
        });
      }
      return sanitize({ version: 1, nodes: prune(nodes), typography });
    } catch { return null; }
  }
  let renderSequence = 0;
  function render(input, doc = root.document, { onOpenMedia } = {}) {
    const data = sanitize(input);
    const fragment = doc.createDocumentFragment();
    if (!data) return fragment;
    const idPrefix = `gpt-rich-${++renderSequence}-`;
    function create(node, inGraphic = false) {
      if (typeof node.text === "string") return doc.createTextNode(node.text);
      let el = doc.createElementNS(node.ns === "math" ? MATH : node.ns === "svg" ? SVG : HTML, node.tag);
      for (const [name, rawValue] of Object.entries(node.attrs)) {
        let value = rawValue;
        if (node.ns === "svg") {
          if (name === "id") value = idPrefix + value;
          if (name === "href" && value.startsWith("#")) value = "#" + idPrefix + value.slice(1);
          value = value.replace(/url\(#([\w:.-]+)\)/g, (_, id) => `url(#${idPrefix}${id})`);
        }
        el.setAttribute(name, value);
      }
      for (const [property, value] of Object.entries(node.style || {})) el.style.setProperty(property, value);
      if (node.layout && node.layout !== "graphic") el.classList.add(`rich-${node.layout}`);
      if (node.tag === "a") { el.target = "_blank"; el.rel = "noopener noreferrer"; }
      if (node.tag === "img") {
        el.loading = "eager";
        if (!inGraphic) {
          // Native preload/display state is not the sidebar's display state.
          el.style.display = "block"; el.style.height = "auto";
          if (blockImage(node)) el.style.width = "100%";
          else if (parseFloat(node.style?.width) <= 0) el.style.removeProperty("width");
        }
        if (!node.attrs.src) { const pending = doc.createElement("span"); pending.className = "image-unavailable"; pending.textContent = "正在自动同步原回答中的图片…"; return pending; }
        el.addEventListener("error", () => {
          const message = doc.createElement("span"); message.className = "image-unavailable";
          message.textContent = `${el.alt ? el.alt + "：" : ""}图片暂不可用，加载网页中的这条回答后可恢复。`;
          el.replaceWith(message);
        }, { once: true });
      }
      for (const child of node.children) el.append(create(child, inGraphic || node.layout === "graphic"));
      if (node.layout === "graphic") {
        const svg = doc.createElementNS(SVG, "svg"), content = doc.createElementNS(SVG, "foreignObject");
        svg.setAttribute("viewBox", `0 0 ${node.size.width} ${node.size.height}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "概念示意图"); svg.classList.add("rich-graphic");
        svg.style.cssText = "display:block;width:100%;height:auto;overflow:hidden";
        content.setAttribute("width", String(node.size.width)); content.setAttribute("height", String(node.size.height)); content.append(el); svg.append(content); el = svg;
      }
      if (node.tag === "table") {
        const scroll = doc.createElement("div"); scroll.className = "rich-table-scroll"; scroll.append(el); return scroll;
      }
      if (node.tag === "math" && node.attrs.display === "block") {
        const formula = doc.createElement("div"); formula.className = "rich-formula-block";
        formula.style.textAlign = node.style?.["text-align"] || "center";
        el.style.display = "inline-block"; formula.append(el); return formula;
      }
      if (node.tag === "svg" && node.layout === "diagram") {
        el.style.width = "100%";
        el.style.height = "auto";
        el.style.display = "block";
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", node.attrs.title || "概念示意图");
      }
      if (onOpenMedia && !inGraphic && isMedia(node)) {
        const trigger = doc.createElement("button"); trigger.type = "button";
        trigger.className = `media-trigger${["diagram", "graphic"].includes(node.layout) ? " diagram-trigger" : blockImage(node) ? " image-trigger" : ""}`;
        trigger.title = "点击查看大图";
        trigger.setAttribute("aria-label", `查看大图：${node.attrs.alt || node.attrs.title || (node.layout === "graphic" ? "概念示意图" : "图片")}`);
        trigger.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); onOpenMedia(node); });
        trigger.append(el); return trigger;
      }
      return el;
    }
    const body = doc.createElement("div"); body.className = "rich-content";
    if (data.kind === "images") body.classList.add("rich-image-gallery");
    for (const [property, value] of Object.entries(data.typography)) body.style.setProperty(property, value);
    for (const node of data.nodes) body.append(create(node));
    fragment.append(body);
    return fragment;
  }
  function stats(doc) {
    const counts = { images: 0, formulas: 0, tables: 0, diagrams: 0 };
    function visit(node) {
      if (node.tag === "img" && safeUrl(node.attrs?.src, true) || node.ns === "svg" && node.tag === "image" && safeUrl(node.attrs?.href, true)) counts.images++;
      if (["diagram", "graphic"].includes(node.layout)) counts.diagrams++;
      else if (node.tag === "math" || node.layout === "math-html" || node.tag === "svg") counts.formulas++;
      if (node.tag === "table") counts.tables++;
      for (const child of node.children || []) visit(child);
    }
    for (const node of doc?.nodes || []) visit(node);
    return counts;
  }
  function preferSnapshot(previous, current) {
    const before = sanitize(previous), after = sanitize(current);
    if (!hasContent(after)) return before;
    if (!hasContent(before)) return after;
    if (before.kind === "images" && after.kind === "images") {
      if (before.mediaKey !== after.mediaKey) return after;
      const pictures = new Map(before.nodes.filter(node => node.assetKey).map(node => [node.assetKey, node]));
      for (const node of after.nodes) {
        const previous = pictures.get(node.assetKey);
        const portable = picture => picture?.attrs?.src?.startsWith("data:image/");
        if (!previous || portable(node) && !portable(previous) || portable(node) === portable(previous) && (node.size?.width || 0) * (node.size?.height || 0) >= (previous.size?.width || 0) * (previous.size?.height || 0)) pictures.set(node.assetKey, node);
      }
      return sanitize({ ...after, nodes: [...pictures.values()] }) || before;
    }
    const a = stats(before), b = stats(after);
    // Offscreen / hidden / partially rebuilt answers must not erase saved media.
    return b.images < a.images || b.diagrams < a.diagrams || b.formulas < a.formulas || b.tables < a.tables ? before : after;
  }
  const sourceImages = new Map(), portableImages = new Map();
  let portableSize = 0;
  function rememberImage(image) {
    const url = safeUrl(image.currentSrc || image.src, true);
    if (!url || !image.complete || !image.naturalWidth || url.startsWith("data:")) return;
    sourceImages.set(url, new WeakRef(image));
    if (sourceImages.size > 128) sourceImages.delete(sourceImages.keys().next().value);
  }
  function imageForPreview(image) {
    const url = safeUrl(image.currentSrc || image.src, true);
    if (!url) return null;
    rememberImage(image);
    const box = image.getBoundingClientRect();
    const attrs = { src: portableImages.get(url)?.source || url, alt: image.alt || "图片预览" };
    if (!attrs.src.startsWith("data:")) for (const name of ["crossorigin", "referrerpolicy"]) if (image.hasAttribute(name)) attrs[name] = image.getAttribute(name);
    return sanitize({ version: 1, nodes: [{ tag: "img", ns: "html", attrs, size: { width: image.naturalWidth || box.width || 768, height: image.naturalHeight || box.height || 768 }, children: [] }] })?.nodes[0] || null;
  }
  function cacheImage(url, source, bytes) {
    portableSize -= portableImages.get(url)?.source.length || 0;
    portableImages.delete(url);
    portableImages.set(url, { source, bytes }); portableSize += source.length;
    while (portableSize > 16 * 1024 * 1024) {
      const oldest = portableImages.keys().next().value;
      portableSize -= portableImages.get(oldest).source.length; portableImages.delete(oldest);
    }
  }
  async function fetchImage(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const target = new URL(url);
      const authenticated = target.origin === root.location?.origin || ["chatgpt.com", "chat.openai.com"].includes(target.hostname);
      const response = await root.fetch(url, { credentials: authenticated ? "include" : "omit", signal: controller.signal });
      if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
      return await response.blob();
    } finally { clearTimeout(timer); }
  }
  async function encodeImage(image, limit) {
    const canvas = (image.ownerDocument || root.document)?.createElement("canvas");
    if (!canvas) throw new Error("当前环境不能压缩图片");
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("原图片尚未加载完成");
    // Read already decoded pixels first: a signed URL may expire while its image is still visible.
    let scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(16000000 / (width * height)));
    const exportBlob = (type, quality) => new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片编码失败")), type, quality);
    });
    try {
      for (let step = 0; step < 4; step++, scale *= 0.75) {
        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        if (!step) { const png = await exportBlob("image/png"); if (png.size <= limit) return png; }
        for (const quality of [0.95, 0.85, 0.72]) {
          const webp = await exportBlob("image/webp", quality);
          if (webp.size <= limit) return webp;
        }
      }
      throw new Error("图片压缩后仍超过保存空间");
    } finally { canvas.width = canvas.height = 1; }
  }
  async function materialize(input, readImage = fetchImage) {
    const doc = sanitize(input);
    if (!doc) return null;
    const targets = [], urls = new Set(), cache = new Map();
    function visit(node) {
      const attribute = node.tag === "img" ? "src" : node.ns === "svg" && node.tag === "image" ? "href" : null;
      const url = attribute && node.attrs?.[attribute];
      const generated = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/backend-api\/(?:estuary\/content|files\/)/.test(url || "");
      if (url?.startsWith("blob:") || /^https?:/.test(url || "") && (doc.kind === "images" || generated)) { targets.push({ node, attribute, url }); urls.add(url); }
      for (const child of node.children || []) visit(child);
    }
    doc.nodes.forEach(visit);
    const limit = Math.min(MAX_IMAGE_BYTES, Math.floor((MAX_SNAPSHOT_SIZE - JSON.stringify(doc).length - 4096) * 3 / 4 / (urls.size || 1)));
    function localImage(url) {
      if (!cache.has(url)) cache.set(url, (async () => {
        const cached = readImage === fetchImage && portableImages.get(url);
        if (cached && cached.bytes <= limit) return cached.source;
        const native = sourceImages.get(url)?.deref();
        const loaded = native?.complete && native.naturalWidth && (native.currentSrc || native.src) === url ? native : null;
        let blob;
        if (readImage === fetchImage && loaded && !/\.svg(?:[?#]|$)/i.test(url)) {
          try { blob = await encodeImage(loaded, limit); } catch { /* Cross-origin pixels may require an authenticated fetch. */ }
        }
        blob ||= await readImage(url);
        if (!blob.type.startsWith("image/")) throw new Error("图片资源不是支持的图像格式。");
        if (blob.size > limit) {
          let bitmap;
          try {
            if (typeof root.createImageBitmap === "function") {
              try { bitmap = await root.createImageBitmap(blob); } catch { /* A loaded native image can still be readable. */ }
            }
            blob = await encodeImage(bitmap || loaded || {}, limit);
          } catch {
            throw new Error(limit < MAX_IMAGE_BYTES ? "这条回答的图片超过 8 MB，暂时无法压缩保存" : "单张临时图片超过 4 MB，暂时无法压缩保存");
          } finally { bitmap?.close(); }
        }
        if (blob.type === "image/svg+xml") {
          const source = safeUrl(`data:image/svg+xml,${await blob.text()}`, true);
          if (!source) throw new Error("这张 SVG 图片过大或格式不受支持。");
          if (readImage === fetchImage) cacheImage(url, source, blob.size);
          return source;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
        for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
        const source = safeUrl(`data:${blob.type};base64,${root.btoa(binary)}`, true);
        if (!source) throw new Error("图片格式不受支持，暂未保存。");
        if (readImage === fetchImage) cacheImage(url, source, blob.size);
        return source;
      })());
      return cache.get(url);
    }
    try {
      await Promise.all(targets.map(async ({ node, attribute, url }) => {
        node.attrs[attribute] = await localImage(url);
        delete node.attrs.crossorigin; delete node.attrs.referrerpolicy;
      }));
    }
    catch (error) {
      const failure = new Error(`图片尚未持久保存：${error.message || "暂时无法读取图片"}。请保持原回答可见，稍后重试。`);
      failure.code = "media-save"; throw failure;
    }
    const saved = sanitize(doc);
    if (!saved) {
      const error = new Error("这条回答的图片和排版超过 8 MB，尚未收录，请保留在主对话中查看。");
      error.code = "media-save"; throw error;
    }
    return saved;
  }
  const api = { MAX_SNAPSHOT_SIZE, MAX_IMAGE_BYTES, capture, render, sanitize, hasContent, stats, safeUrl, isMedia, preferSnapshot, materialize, rememberImage, imageForPreview, backgroundSource };
  root.GPTStickyRich = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
