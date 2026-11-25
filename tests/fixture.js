"use strict";
(function () {
  const params = new URLSearchParams(location.search);
  const scenario = params.get("fixture") || "answer-archive";
  const fixtureKey = name => `gpt-sticky-fixture:${scenario}:${name}`;
  let previewRebuilt = false;
  if (new URLSearchParams(location.search).get("rebuild-on-preview") === "1") window.addEventListener("click", event => {
    const image = event.target.closest?.("img");
    if (previewRebuilt || !image?.closest("[data-gpt-answer-shelf-native]") || image.getBoundingClientRect().width <= 96) return;
    previewRebuilt = true;
    setTimeout(() => { render(); document.getElementById("preview-rebuild-state").textContent = "预览期间网页消息已重建"; }, 350);
  }, { capture: true });
  let store = JSON.parse(localStorage.getItem(fixtureKey("store")) || "{}");
  const installedVersion = "0.3.0";
  const listeners = [];
  const messageListeners = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) { if (keys == null) return structuredClone(store); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(store[key])])); },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: store[key], newValue: structuredClone(value) }; store[key] = structuredClone(value); }
          localStorage.setItem(fixtureKey("store"), JSON.stringify(store));
          for (const listener of listeners) listener(changes, "local");
          debug();
        }
      },
      onChanged: { addListener(callback) { listeners.push(callback); } }
    },
    runtime: {
      getManifest() { return { version: installedVersion }; },
      onMessage: { addListener(callback) { messageListeners.push(callback); } },
      async sendMessage(message) {
        if (message?.type === "gpt-answer-shelf:store") return noteStore.handle(message);
        let response;
        for (const listener of messageListeners) listener(message, {}, value => { response = value; });
        return response;
      }
    }
  };
  const noteStore = GPTStickyStorage.create({ area: chrome.storage.local });
  function debug() {
    const output = document.getElementById("test-state");
    if (!output) return;
    const notes = Object.values(store).filter(item => item?.mode === "archive" && !item.deletedAt);
    output.textContent = JSON.stringify(notes.map(note => ({ conversation: note.conversation, question: note.exchanges[0].question, placement: note.exchanges[0].placement, snapshot: Boolean(note.exchanges[0].answerDocument) })), null, 2);
  }
  let sequence = Number(localStorage.getItem(fixtureKey("sequence")) || 10), timer, active = "demo", structure = params.get("structure") || "author";
  const domNodes = new Map();
  const withRich = new URLSearchParams(location.search).get("rich") === "1";
  const composer = () => document.querySelector('[role="textbox"]');
  const conversations = JSON.parse(localStorage.getItem(fixtureKey("conversations")) || "null") || {
    demo: [
      { id: "u1", role: "user", text: "为什么长对话里很难找回前面的解释？" },
      { id: "a1", role: "assistant", paragraphs: ["对话通常按消息出现的顺序排列。", "针对原句的小追问会继续追加到对话底部。", "把原句和追问建立关联，就可以用便签随时打开它。"], done: true },
      { id: "u2", role: "user", text: "你说的关联是什么？" },
      { id: "a2", role: "assistant", paragraphs: ["可以保存一条对应关系：这段原回答，以及针对它提出的疑问和解释。"], done: true },
      { id: "u3", role: "user", text: "另外，帮我列个简单的阅读计划。" },
      { id: "a3", role: "assistant", paragraphs: ["第一天阅读第一章。第二天整理疑问。第三天复习之前的笔记。"], done: true }
    ],
    other: [
      { id: "other-u1", role: "user", text: "这是一段不同的对话。" },
      { id: "other-a1", role: "assistant", paragraphs: ["这段对话有独立的收纳目录。"], done: true }
    ]
  };
  const longAnswer = params.get("long");
  if (["1", "last"].includes(longAnswer) && !localStorage.getItem(fixtureKey("conversations"))) {
    const id = longAnswer === "last" ? "a3" : "a1";
    conversations.demo.find(message => message.id === id).paragraphs.push(...Array.from({ length: longAnswer === "last" ? 45 : 35 }, (_, index) => `第 ${index + 1} 段模拟说明，用于验证长回答的收纳和滚动。`));
  }
  if (withRich) conversations.demo.find(message => message.id === "a1").rich = true;
  function richExample(body) {
    const make = (tag, text) => { const node = document.createElement(tag); if (text != null) node.textContent = text; return node; };
    const heading = make("h2"); heading.className = "Heading-Ro3lZr"; heading.append(make("span", "1. 举一个具体例子")); body.append(heading);
    body.append(make("p", "两个地点的道路、建筑和树木相似，也可能是不同地点。下面是示意图："));
    const grid = make("div"); grid.className = "example-grid";
    for (const [file, caption] of [["a", "地点 A：道路、建筑、树木"], ["b", "地点 B：类似的道路和建筑"]]) {
      const figure = make("figure"), image = make("img"); image.src = `/tests/media-${file}.svg`; image.alt = caption;
      if (new URLSearchParams(location.search).get("photo-controls") === "1") {
        const frame = make("div"), bookmark = make("button"); frame.className = "photo-with-controls";
        frame.style.cssText = "position:relative;width:100%;height:180px;border-radius:12px;overflow:hidden";
        image.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";
        bookmark.setAttribute("aria-label", "收藏图片"); bookmark.type = "button";
        bookmark.style.cssText = "position:absolute;top:8px;right:8px;width:36px;height:36px;border:0;border-radius:50%;padding:0;margin:0;background:rgb(96,96,96);color:white";
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"), use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        icon.setAttribute("viewBox", "0 0 24 24"); icon.style.cssText = "width:20px;height:20px"; use.setAttribute("href", "#fixture-bookmark-icon"); icon.append(use); bookmark.append(icon);
        frame.append(image, bookmark); figure.append(frame);
      } else figure.append(image);
      figure.append(make("figcaption", caption)); grid.append(figure);
    }
    if (new URLSearchParams(location.search).get("shadow") === "1") {
      const gallery = make("gpt-demo-gallery"), shadow = gallery.attachShadow({ mode: "open" }), style = make("style", ":host{display:block}.example-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{display:block;width:100%;border-radius:12px}figcaption{font-size:13px;margin-top:6px}");
      shadow.append(style, grid); body.append(gallery);
    } else body.append(grid);
    const diagramKind = new URLSearchParams(location.search).get("diagram");
    if (diagramKind === "provided-svg") {
      const image = make("img"); image.alt = "X-Fork 网页原图"; image.style.cssText = "display:block;width:100%;height:auto";
      body.append(image, make("figcaption", "用户提供的网页 SVG 原图：保持矢量显示。"));
      fetch("/tests/native-concept.svg").then(response => response.text()).then(xml => { image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml.trim())}`; });
    } else if (diagramKind === "background-svg") {
      const drawing = make("div");
      const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 366"><rect x="1" y="1" width="766" height="364" rx="10" fill="white" stroke="rgb(220,220,220)"/><rect x="20" y="140" width="162" height="70" rx="12" fill="rgb(220,234,253)" stroke="rgb(119,159,201)" stroke-width="2"/><rect x="235" y="140" width="220" height="70" rx="12" fill="rgb(219,239,226)" stroke="rgb(119,169,148)" stroke-width="2"/><rect x="540" y="40" width="207" height="90" rx="14" fill="rgb(247,233,208)" stroke="rgb(207,154,83)" stroke-width="2"/><rect x="540" y="260" width="207" height="90" rx="14" fill="rgb(235,228,249)" stroke="rgb(163,144,208)" stroke-width="2"/><path d="M182 175h53m220 0h38V85h47m-47 90v130h47" stroke="black" stroke-width="4" fill="none"/><g font-family="sans-serif" font-size="26" text-anchor="middle"><text x="101" y="181">卫星图</text><text x="345" y="166">生成器 G</text><text x="345" y="196">共享特征</text><text x="643" y="94">地面图</text><text x="643" y="314">语义分割图</text></g></svg>';
      const src = `data:image/svg+xml,${encodeURIComponent(xml)}`;
      drawing.setAttribute("aria-label", "X-Fork 概念图");
      drawing.style.cssText = `width:100%;aspect-ratio:768/366;background-image:url("${src}");background-size:100% 100%;margin:16px 0`;
      const preload = make("img"); preload.src = src; preload.style.display = "none";
      body.append(drawing, preload, make("figcaption", "结构简化示意：分叉发生在生成器解码阶段。"));
    } else if (diagramKind === "raw-svg") {
      const image = make("img"); image.alt = "自动保存的概念图";
      image.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="768" height="320" viewBox="0 0 768 320"><rect x="1" y="1" width="766" height="318" rx="14" fill="white" stroke="rgb(220,220,220)"/><rect x="28" y="110" width="180" height="100" rx="12" fill="rgb(224,235,247)" stroke="rgb(128,166,200)"/><rect x="290" y="90" width="220" height="140" rx="12" fill="rgb(226,239,231)" stroke="rgb(137,176,154)"/><rect x="590" y="110" width="150" height="100" rx="12" fill="rgb(232,228,244)" stroke="rgb(161,149,199)"/><path d="M208 160 L290 160 M510 160 L590 160" stroke="black" stroke-width="3"/><text x="118" y="164" font-size="24" text-anchor="middle">卫星图</text><text x="400" y="150" font-size="24" text-anchor="middle">Generator</text><text x="400" y="188" font-size="20" text-anchor="middle">共享特征提取</text><text x="665" y="164" font-size="24" text-anchor="middle">地面图</text></svg>';
      image.style.cssText = "display:block;width:100%;height:auto"; body.append(image, make("figcaption", "概念图自动跟随正文保存，不需要手动添加。"));
      const blobImage = make("img"); blobImage.alt = "临时地址的概念图"; blobImage.style.cssText = "display:block;width:100%;height:auto"; body.append(blobImage);
      fetch("/tests/concept.svg").then(response => response.blob()).then(blob => { blobImage.src = URL.createObjectURL(blob); });
    } else if (diagramKind === "flow") {
      const diagram = make("div"); diagram.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;width:600px;max-width:100%;height:180px;align-items:center;margin:16px 0";
      for (const label of ["卫星图", "Generator", "地面图"]) { const box = make("div", label); box.style.cssText = "border:2px solid rgb(128,166,200);border-radius:12px;background:rgb(224,235,247);padding:30px 10px;text-align:center;font-size:20px"; diagram.append(box); }
      body.append(diagram, make("figcaption", "此概念图使用网格布局，没有绝对定位。"));
    } else if (diagramKind === "html") {
      const renderer = make("div"); renderer.className = "relative PortalBoundary-TFj9W2 Renderer-ojZscX"; renderer.style.cssText = "position:relative;width:600px;max-width:100%;height:340px;background:white;border:1px solid #ddd;border-radius:8px;margin:16px 0;color:#143049;font:22px/1.3 sans-serif";
      const box = (label, style) => { const node = make("div", label); node.style.cssText = `position:absolute;display:flex;align-items:center;justify-content:center;white-space:pre-line;text-align:center;border:2px solid;border-radius:12px;${style}`; renderer.append(node); };
      box("卫星图\nIa", "left:15px;top:118px;width:130px;height:88px;background:#e0ebf7;border-color:#80a6c8");
      box("Generator\n共享特征提取", "left:195px;top:108px;width:190px;height:110px;background:#e2efe7;border-color:#89b09a");
      box("地面图\nIg'", "left:445px;top:30px;width:130px;height:85px;background:#e8e4f4;border-color:#a195c7;color:#594591");
      box("语义分割图\nSg'", "left:445px;top:215px;width:130px;height:85px;background:#f5e8d3;border-color:#cd9e58;color:#8d571a");
      for (const style of ["left:145px;top:158px;width:50px", "left:385px;top:158px;width:35px", "left:420px;top:71px;width:25px", "left:420px;top:257px;width:25px"]) { const arrow = make("div"); arrow.className = "dil-arrow"; arrow.style.cssText = `position:absolute;height:3px;background:#18252e;${style}`; renderer.append(arrow); }
      const fork = make("div"); fork.style.cssText = "position:absolute;left:420px;top:72px;width:3px;height:187px;background:#18252e"; renderer.append(fork);
      const captionRoot = make("div"); captionRoot.className = "DilRenderer-tB76Jj DilResponseRoot-HfQrEh Reveal-k2IWvM"; captionRoot.style.cssText = "position:absolute;left:12px;right:12px;bottom:8px;font:12px/1.4 sans-serif";
      const caption = make("p", "结构简化示意：实际分叉发生在生成器解码阶段的后部，而不是生成器外部。"); caption.className = "TextBase-hXhSqg Text-lIMP0_"; caption.style.margin = "0"; captionRoot.append(caption); renderer.append(captionRoot); body.append(renderer);
    } else if (diagramKind) {
      const frame = make("iframe"); frame.src = "/tests/concept.svg"; frame.title = "概念示意图";
      frame.style.cssText = "width:100%;height:270px;border:1px solid #ddd;border-radius:10px";
      if (diagramKind !== "frame") {
        frame.hidden = true;
        frame.addEventListener("load", () => {
          const svg = frame.contentDocument.documentElement.cloneNode(true);
          svg.style.cssText = "display:block;width:100%;height:auto";
          if (diagramKind === "button") {
            const action = make("button"); action.setAttribute("aria-label", "打开概念示意图"); action.style.cssText = "border:1px solid #ddd;border-radius:10px;padding:12px;width:100%";
            action.append(svg); frame.replaceWith(action);
          } else frame.replaceWith(svg);
        });
      }
      body.append(frame, make("figcaption", "概念示意图：根据输入卫星图生成地面图，与真实地面图比较并计算损失。"));
    }
    const emphasis = make("p"); emphasis.append("判断位置时需要 ", make("strong", "地理身份一致"), "，以及 ", make("em", "跨视角对应关系"), make("br"), "这一行应保留换行。"); body.append(emphasis);
    const list = make("ol"), item = make("li", "比较道路结构"), nested = make("ul"); nested.append(make("li", "检查相对位置"), make("li", "检查方向")); item.append(nested); list.append(item, make("li", "保留建筑特征")); body.append(list);
    body.append(make("blockquote", "看起来相似，不代表属于同一地点。"));
    const formula = make("div"); formula.className = "katex-display";
    const katex = make("span"); katex.className = "katex";
    const hidden = make("span"); hidden.className = "katex-mathml"; hidden.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)";
    const namespace = "http://www.w3.org/1998/Math/MathML";
    const mathNode = (tag, text, ...children) => { const node = document.createElementNS(namespace, tag); if (text != null) node.textContent = text; node.append(...children); return node; };
    const math = mathNode("math", null, mathNode("mrow", null, mathNode("mi", "E"), mathNode("mo", "="), mathNode("mfrac", null, mathNode("mrow", null, mathNode("msup", null, mathNode("mi", "x"), mathNode("mn", "2")), mathNode("mo", "+"), mathNode("mn", "1")), mathNode("msqrt", null, mathNode("mn", "2"))))); math.setAttribute("display", "block"); hidden.append(math);
    const visual = make("span", "E = (x² + 1) / √2"); visual.className = "katex-html"; katex.append(hidden, visual); formula.append(katex); body.append(formula);
    const pre = make("pre"); pre.append(make("code", "if matched:\n    keep_location()\n    save_note()")); body.append(pre);
    const table = make("table"), header = make("thead"), headerRow = make("tr"); headerRow.append(make("th", "比较对象"), make("th", "目的")); header.append(headerRow);
    const tableBody = make("tbody"), row = make("tr"); row.append(make("td", "跨视角特征"), make("td", "定位同一地点")); tableBody.append(row); table.append(header, tableBody); body.append(table);
  }
  function persistConversations() {
    localStorage.setItem(fixtureKey("conversations"), JSON.stringify(conversations));
    localStorage.setItem(fixtureKey("sequence"), String(sequence));
  }
  const bitmapGallery = ["网络概念图", "卫星视角", "地面视角"].map((label, index) => {
    const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 650;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = ["#edf5fc", "#b7cea0", "#dbeafa"][index]; ctx.fillRect(0, 0, 1200, 650);
    ctx.fillStyle = "#203a47"; ctx.font = '42px "Microsoft YaHei",sans-serif'; ctx.fillText(`本地生成图片模拟 · ${label}`, 50, 65);
    if (index === 0) {
      for (const [left, text] of [[60, "卫星图"], [445, "生成器 G"], [845, "地面图"]]) { ctx.fillStyle = "#c7ddd9"; ctx.fillRect(left, 250, 285, 155); ctx.strokeStyle = "#7ea199"; ctx.lineWidth = 3; ctx.strokeRect(left, 250, 285, 155); ctx.fillStyle = "#214941"; ctx.font = '36px "Microsoft YaHei",sans-serif'; ctx.fillText(text, left + 35, 340); }
      ctx.strokeStyle = "#233b47"; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(345, 325); ctx.lineTo(445, 325); ctx.moveTo(730, 325); ctx.lineTo(845, 325); ctx.stroke();
    } else if (index === 1) {
      ctx.fillStyle = "#6c7984"; ctx.fillRect(0, 280, 1200, 130); ctx.fillRect(520, 90, 160, 560);
      ctx.fillStyle = "#839c72"; for (let x = 70; x < 1100; x += 200) { ctx.fillRect(x, 150, 120, 95); ctx.fillRect(x, 445, 120, 95); }
    } else {
      ctx.fillStyle = "#67845a"; ctx.fillRect(0, 330, 1200, 320); ctx.fillStyle = "#66717d"; ctx.beginPath(); ctx.moveTo(560, 320); ctx.lineTo(660, 320); ctx.lineTo(1160, 650); ctx.lineTo(20, 650); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#c4ae97"; for (const x of [70, 280, 760, 980]) { ctx.fillRect(x, 240, 155, 170); }
    }
    if (index === 0 && new URLSearchParams(location.search).get("large-image") === "1") {
      canvas.width = 1800; canvas.height = 1000;
      const pixels = ctx.createImageData(canvas.width, canvas.height); let seed = 7;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        for (let channel = 0; channel < 3; channel++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[offset + channel] = seed >>> 24; }
        pixels.data[offset + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0); ctx.fillStyle = "white"; ctx.fillRect(30, 25, 900, 80); ctx.fillStyle = "#203a47"; ctx.font = '42px "Microsoft YaHei",sans-serif'; ctx.fillText("超过 4 MB 的生成图片 · 压缩保存测试", 50, 80);
    }
    return { src: canvas.toDataURL("image/png"), alt: label };
  }).slice(0, Number(new URLSearchParams(location.search).get("image-count")) || 3);
  const gallerySources = new URLSearchParams(location.search).get("image-url") === "network" ? Promise.all(bitmapGallery.map(async (item, index) => {
    document.cookie = "gpt-fixture-gallery=1;path=/;SameSite=Lax";
    const blob = await (await fetch(item.src)).blob();
    const response = await fetch(`/tests/gallery?fixture=${encodeURIComponent(scenario)}&id=file-${index}`, { method: "POST", body: blob });
    const saved = await response.json();
    if (saved.bytes > 4 * 1024 * 1024) document.getElementById("gallery-state").textContent = `原图 ${(saved.bytes / 1024 / 1024).toFixed(2)} MB，用于验证超过 4 MB 的图片`;
    return { src: new URL(saved.src, location.href).href, alt: item.alt };
  })) : Promise.resolve(bitmapGallery);
  function showSiteImage(image) {
    let viewer = document.getElementById("fixture-image-viewer");
    if (!viewer) {
      viewer = document.createElement("div"); viewer.id = "fixture-image-viewer";
      viewer.setAttribute("role", "dialog"); viewer.setAttribute("aria-label", "网站图片预览");
      viewer.style.cssText = "position:fixed;inset:0;z-index:2000000000;background:#fffefb;display:grid;place-items:center";
      const picture = document.createElement("img"), close = document.createElement("button"); picture.style.cssText = "width:80vw;height:80vh;object-fit:contain";
      close.textContent = "关闭网站图片预览"; close.onclick = () => { viewer.hidden = true; };
      viewer.append(close, picture); document.body.append(viewer);
    }
    viewer.querySelector("img").src = image.currentSrc || image.src; viewer.hidden = false;
    viewer.dataset.opens = String(Number(viewer.dataset.opens || 0) + 1);
    document.getElementById("native-image-state").textContent = `网站大图打开次数：${viewer.dataset.opens}`;
  }
  function renderMessage(message) {
    const work = structure === "work";
    const article = document.createElement(work ? "div" : "article");
    if (work) { article.className = "block-BQZwFn"; article.style.margin = "24px 0"; }
    else { if (structure !== "markdown") article.dataset.turn = message.role; article.dataset.testid = `conversation-turn-${message.id}`; }
    const text = document.createElement("div");
    article.dataset.fixtureId = message.id;
    article.dataset.fixtureInstance = crypto.randomUUID();
    if (!work) { if (structure === "author") text.dataset.messageAuthorRole = message.role; text.dataset.messageId = message.id; }
    text.className = message.role === "assistant" ? (work ? "MarkdownRoot-rZKhxa [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>ol:first-child]:mt-0 [&>ul:first-child]:mt-0" : "markdown") : (work ? "" : "user-message-bubble-color");
    if (structure === "markdown") {
      const caption = document.createElement("h6");
      caption.className = "sr-only"; caption.hidden = true; caption.textContent = message.role === "assistant" ? "ChatGPT said:" : "You said:";
      if (params.get("nested-label") === "1") {
        const heading = document.createElement("div");
        heading.append(caption); article.append(heading);
        if (message.role === "user") text.className = "whitespace-pre-wrap";
      } else article.append(caption);
    }
    if (message.role === "user") { text.textContent = message.text; text.style.whiteSpace = "pre-wrap"; }
    else for (const paragraph of message.paragraphs || []) {
      const p = document.createElement("p");
      if (work) { p.className = "Paragraph-kKnbIo"; const strong = document.createElement("strong"), span = document.createElement("span"); strong.className = "font-semibold"; span.textContent = paragraph; strong.append(span); p.append(strong); }
      else p.textContent = paragraph;
      text.append(p);
    }
    if (message.rich && message.done) richExample(text);
    if (message.role === "assistant" && new URLSearchParams(location.search).get("fullrenderer") === "1") {
      const renderer = document.createElement("div"), dil = document.createElement("div");
      renderer.className = "relative PortalBoundary-TFj9W2 Renderer-ojZscX";
      dil.className = "DilRenderer-tB76Jj DilResponseRoot-HfQrEh Reveal-k2IWvM";
      dil.append(...text.childNodes); renderer.append(dil); text.append(renderer);
      const diagram = dil.querySelector('[class*="Renderer-"]');
      if (diagram) { const heading = document.createElement("h2"); heading.textContent = "2. 第二个独立图示"; dil.append(heading, diagram.cloneNode(true)); }
    }
    if (work) {
      const first = document.createElement("div"), second = document.createElement("div"), group = document.createElement("div");
      group.className = "group flex min-w-0 flex-col"; group.append(text); second.append(group); first.append(second); article.append(first);
      if (new URLSearchParams(location.search).get("narrow") === "1" && message.role === "assistant") {
        article.style.width = "384px";
        second.style.maxWidth = "384px"; group.style.maxWidth = "384px"; text.style.maxWidth = "384px";
        text.style.fontSize = "18px"; text.style.lineHeight = "1.75";
      }
      if (message.role === "user") { article.style.marginLeft = "70px"; article.style.padding = "12px 18px"; article.style.borderRadius = "16px"; article.style.background = "var(--fixture-bubble)"; }
      if (message.role === "user" && new URLSearchParams(location.search).get("contents") === "1") article.style.display = "contents";
    } else article.append(text);
    if (message.role === "user" && params.get("user-copy") === "1") {
      const copy = document.createElement("button");
      copy.type = "button"; copy.setAttribute("aria-label", "Copy message"); copy.textContent = "复制问题";
      article.append(copy);
    }
    if (message.role === "assistant" && message.imageResult && message.done) {
      text.className = ""; text.replaceChildren(document.createTextNode("Worked for 3m 55s"));
      const gallery = document.createElement("div"), image = document.createElement("img"), thumbs = document.createElement("div");
      gallery.style.cssText = "display:flex;align-items:flex-start;gap:12px;margin:12px 0";
      image.style.cssText = "display:block;width:calc(100% - 68px);height:auto;border-radius:12px";
      let items;
      const setImage = index => { image.src = items[index].src; image.alt = items[index].alt; };
      gallery.append(image, thumbs); article.append(gallery);
      const loadGallery = async () => {
        items = await gallerySources;
        setImage(items.length - 1);
        items.forEach((item, index) => { const b = document.createElement("button"), thumb = document.createElement("img"); b.type = "button"; b.setAttribute("aria-label", `查看生成图 ${index + 1}`); b.style.cssText = "display:block;padding:0;margin:0 0 8px;border:1px solid #bbb;border-radius:8px"; thumb.src = item.src; thumb.alt = item.alt; thumb.style.cssText = "display:block;width:54px;height:54px;object-fit:cover;border-radius:8px"; b.append(thumb); b.onclick = () => setImage(index); thumbs.append(b); });
      };
      if (new URLSearchParams(location.search).get("image-delay") === "1") setTimeout(loadGallery, 3000); else loadGallery();
      const feedback = document.createElement("button"); feedback.setAttribute("aria-label", "Good response"); feedback.textContent = "赞同"; article.append(feedback);
    }
    if (message.done && message.role === "assistant" && new URLSearchParams(location.search).get("nocopy") !== "1") {
      const copy = document.createElement("button"); if (work) copy.setAttribute("aria-label", "Copy message"); else copy.dataset.testid = "copy-turn-action-button"; copy.className = "copy"; copy.textContent = "复制回答"; article.append(copy);
      copy.onclick = () => { copy.dataset.activated = String(Number(copy.dataset.activated || 0) + 1); copy.setAttribute("title", "原生按钮已响应"); };
    }
    if (message.done && message.role === "assistant" && params.get("analysis-footer") === "1") {
      const analysis = document.createElement("div"), blank = document.createElement("div"), control = document.createElement("button");
      blank.className = "MarkdownRoot-Analysis";
      control.type = "button";
      control.setAttribute("aria-label", "View analysis");
      control.textContent = "</>";
      analysis.append(blank, control);
      article.append(analysis);
    }
    if (new URLSearchParams(location.search).get("native-test") === "1") for (const image of article.querySelectorAll("img")) image.addEventListener("click", () => showSiteImage(image));
    domNodes.set(message.id, { turn: article, body: text });
    return article;
  }
  function render() {
    domNodes.clear();
    document.getElementById("messages").replaceChildren(...conversations[active].map(renderMessage));
    if (params.get("footer-edge") === "1" && active === "demo") {
      const status = document.createElement("div");
      status.className = "block-BQZwFn";
      status.textContent = "Worked for 3s";
      domNodes.get("a1").turn.before(status);
      const announcement = status.cloneNode(true);
      announcement.setAttribute("role", "status");
      domNodes.get("a2").turn.before(announcement);
      const alternate = renderMessage({ id: "hidden-answer", role: "assistant", paragraphs: ["未选中的分支回答。"], done: true });
      alternate.style.display = "none";
      domNodes.get("a2").turn.after(alternate);
    }
    debug();
  }
  function switchTo(name) {
    if (timer) return;
    active = name;
    history.pushState(null, "", `/c/${name}${location.search}`);
    render(); window.dispatchEvent(new PopStateEvent("popstate"));
  }
  window.addEventListener("DOMContentLoaded", () => {
    if (location.pathname.includes("/other")) active = "other";
    if (!location.pathname.startsWith("/c/")) history.replaceState(null, "", "/c/demo" + location.search);
    if (new URLSearchParams(location.search).get("layout") === "scroll") document.body.classList.add("nested-scroll");
    document.getElementById("structure").value = structure;
    if (structure === "work") { composer().id = "work-composer"; const stop = document.getElementById("stop"); stop.removeAttribute("data-testid"); stop.setAttribute("aria-label", "Stop"); }
    render();
    if (new URLSearchParams(location.search).get("churn") === "1") {
      let tick = 0;
      setInterval(() => {
        tick++;
        for (const body of document.querySelectorAll('[class*="MarkdownRoot-"],.markdown')) {
          const heading = body.querySelector("h2");
          if (heading) heading.style.marginTop = `${23 + tick % 3}px`;
          for (const image of body.querySelectorAll("img")) image.style.borderRadius = `${10 + tick % 3}px`;
        }
        document.getElementById("churn-state").textContent = `模拟图示样式持续更新：${tick}`;
      }, 300);
    }
    if (new URLSearchParams(location.search).get("reflow") === "1") {
      let replacements = 0;
      const replace = () => { if (replacements++ < 3) requestAnimationFrame(render); };
      new MutationObserver(records => {
        if (records.some(record => record.oldValue?.includes("gpt-answer-shelf-hidden-turn") && !record.target.classList.contains("gpt-answer-shelf-hidden-turn"))) replace();
      }).observe(document.getElementById("messages"), { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
      document.getElementById("messages").addEventListener("scroll", () => { if (replacements > 0 && replacements < 3) replace(); });
    }
    document.getElementById("unload-media").onclick = () => { for (const image of document.getElementById("messages").querySelectorAll("img")) image.remove(); };
    document.getElementById("unload-saved").onclick = () => {
      const entry = Object.values(store).find(item => item?.mode === "archive" && item.conversation === "c:" + active
        && !item.deletedAt && item.exchanges[0]?.placement === "sidebar")?.exchanges[0];
      if (!entry) return;
      const index = conversations[active].findIndex(message => message.role === "user" && message.text === entry.userText);
      if (index >= 0) for (const message of conversations[active].slice(index, index + 2)) domNodes.get(message.id)?.turn.remove();
    };
    document.getElementById("lazy-history").onclick = () => {
      const list = document.getElementById("messages"), scroller = document.body.classList.contains("nested-scroll") ? list : document.scrollingElement;
      const tail = Array.from({ length: 30 }, (_, index) => [
        { id: `history-u${index}`, role: "user", text: `后续的第 ${index + 1} 个独立问题` },
        { id: `history-a${index}`, role: "assistant", paragraphs: [`这是后续第 ${index + 1} 条普通回答。较早的消息只会在滚动到顶部后异步加载。`], done: true }
      ]).flat();
      domNodes.clear(); list.replaceChildren(...tail.map(renderMessage));
      document.getElementById("history-state").textContent = "较早问答尚未加载";
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
      let pending = false;
      const load = event => {
        if (pending || event.target !== scroller && !(scroller === document.scrollingElement && event.target === document) || scroller.scrollTop > 100) return;
        pending = true;
        setTimeout(() => {
          list.prepend(...conversations[active].map(renderMessage));
          document.getElementById("history-state").textContent = "较早问答已通过滚动自动加载";
          window.removeEventListener("scroll", load, true);
        }, 650);
      };
      window.addEventListener("scroll", load, { capture: true });
    };
    document.getElementById("expire-gallery").onclick = async () => {
      await fetch(`/tests/gallery?fixture=${encodeURIComponent(scenario)}&expire=1`, { method: "POST" });
      document.getElementById("gallery-state").textContent = "原图片链接已失效；已加载的主图仍可见";
    };
    document.getElementById("compact-controls").onclick = () => document.querySelector("header").classList.toggle("compact");
    document.getElementById("fail-answer").onclick = () => {
      if (timer) { clearInterval(timer); timer = null; }
      const latest = conversations[active].findLast(message => message.role === "assistant");
      latest.paragraphs = ["This response couldn’t load"]; latest.done = true; latest.rich = false;
      persistConversations(); render(); document.getElementById("stop").hidden = true; document.getElementById("send").hidden = false;
    };
    document.getElementById("restore-answer").onclick = () => {
      if (timer) { clearInterval(timer); timer = null; }
      const latest = conversations[active].findLast(message => message.role === "assistant");
      latest.paragraphs = ["已恢复完整的演示回答，可以从问句旁收进侧栏。"]; latest.done = true; latest.rich = withRich;
      persistConversations(); render(); document.getElementById("stop").hidden = true; document.getElementById("send").hidden = false;
    };
    document.getElementById("rerender").onclick = render;
    document.getElementById("scroll-tail").onclick = () => document.getElementById("messages").lastElementChild?.scrollIntoView({ block: "end", behavior: "instant" });
    document.getElementById("structure").onchange = event => { structure = event.target.value; render(); };
    document.getElementById("diagnose").onclick = async () => {
      const target = document.getElementById("diagnostic-state");
      target.hidden = false;
      const response = await chrome.runtime.sendMessage({ type: "gpt-answer-shelf:diagnose" });
      target.textContent = JSON.stringify(response?.report || response, null, 2);
    };
    document.getElementById("check-startup").onclick = async () => {
      document.getElementById("startup-state").textContent = JSON.stringify(await chrome.runtime.sendMessage({ type: "gpt-answer-shelf:ping" }));
    };
    document.getElementById("other").onclick = () => switchTo("other");
    document.getElementById("back").onclick = () => switchTo("demo");
    document.getElementById("theme").onclick = () => document.documentElement.classList.toggle("dark");
    document.getElementById("send").onclick = () => {
      if (timer) return;
      const editor = composer();
      const prompt = editor.innerText.trim();
      if (!prompt) return;
      const user = { id: `u${sequence++}`, role: "user", text: prompt };
      const answer = { id: `a${sequence++}`, role: "assistant", paragraphs: [""], done: false, rich: withRich, imageResult: new URLSearchParams(location.search).get("image-result") === "1" };
      conversations[active].push(user, answer);
      persistConversations();
      editor.textContent = "";
      const list = document.getElementById("messages"); list.append(renderMessage(user), renderMessage(answer));
      if (new URLSearchParams(location.search).get("auto-scroll") === "1") list.lastElementChild.scrollIntoView({ block: "end" });
      const stop = document.getElementById("stop"); stop.hidden = false;
      document.getElementById("send").hidden = true;
      const text = "这是预先编写的演示回答。生成完成后，问句旁和回答末尾都可以收纳这条回答。";
      const chunks = text.match(/.{1,12}/g);
      let index = 0;
      const finish = () => {
        clearInterval(timer); timer = null; answer.done = true;
        persistConversations();
        stop.hidden = true; document.getElementById("send").hidden = false;
        const old = domNodes.get(answer.id).turn;
        const replacement = renderMessage(answer);
        if (new URLSearchParams(location.search).get("retain-turn") === "1") {
          old.replaceChildren(...replacement.childNodes);
          domNodes.get(answer.id).turn = old;
        } else old.replaceWith(replacement);
      };
      stop.onclick = finish;
      timer = setInterval(() => {
        if (new URLSearchParams(location.search).get("hold") === "1" && index >= 1) return;
        answer.paragraphs[0] += chunks[index++];
        persistConversations();
        domNodes.get(answer.id).body.querySelector(structure === "work" ? "p strong span" : "p").textContent = answer.paragraphs[0];
        if (index === chunks.length) finish();
      }, document.getElementById("slow").checked ? 1600 : 180);
    };
  });
})();
