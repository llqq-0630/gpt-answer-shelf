"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../rich.js");
const C = require("../core.js");
const node = (tag, children = [], attrs = {}, ns = "html") => ({ tag, children, attrs, ns });
const document = nodes => ({ version: 1, nodes });
test("old photo snapshots lose the copied bookmark badge without changing the image", () => {
  const picture = node("img", [], { src: "https://chatgpt.com/photo.png", alt: "原图" });
  picture.style = { position: "absolute", width: "600px", height: "360px", top: "0px", left: "0px" };
  const badge = node("div", [node("svg", [node("use", [], { href: "#bookmark" }, "svg")], { viewBox: "0 0 24 24" }, "svg")]);
  badge.style = { position: "absolute", width: "36px", height: "36px", top: "8px", right: "8px", "border-radius": "50%", "background-color": "rgb(96, 96, 96)" };
  const frame = node("div", [picture, badge]); frame.layout = "graphic"; frame.size = { width: 600, height: 360 };
  const original = document([frame]), before = JSON.stringify(original), saved = R.sanitize(original);
  assert.equal(saved.nodes[0].children.length, 1);
  assert.equal(saved.nodes[0].children[0].attrs.src, picture.attrs.src);
  assert.equal(saved.nodes[0].layout, undefined);
  assert.deepEqual(R.stats(saved), { images: 1, formulas: 0, tables: 0, diagrams: 0 });
  assert.deepEqual(R.sanitize(saved), saved); assert.equal(JSON.stringify(original), before);
});
test("photo labels and vector annotations are retained instead of treated as controls", () => {
  const label = node("div", [{ text: "标注 1" }]);
  label.style = { position: "absolute", width: "36px", height: "36px", top: "8px", right: "8px", "border-radius": "50%" };
  const drawing = node("svg", [node("path", [], { d: "M0 0L500 300" }, "svg")], { viewBox: "0 0 600 360" }, "svg");
  const frame = node("div", [node("img", [], { src: "https://chatgpt.com/photo.png" }), label, drawing]);
  frame.layout = "graphic"; frame.size = { width: 600, height: 360 };
  const saved = R.sanitize(document([frame]));
  assert.equal(saved.nodes[0].children.length, 3);
  assert.equal(saved.nodes[0].children[1].children[0].text, "标注 1");
  assert.equal(saved.nodes[0].children[2].ns, "svg");
});
test("combined blob pictures remain portable after the original page is unloaded", async () => {
  const original = document([node("img", [], { src: "blob:https://chatgpt.com/first" }), node("img", [], { src: "blob:https://chatgpt.com/second" })]);
  const result = await R.materialize(original, async () => new Blob([new Uint8Array(900000)], { type: "image/png" }));
  assert.equal(R.hasContent(result), true);
  assert.equal(R.stats(result).images, 2);
  assert.ok(result.nodes.every(picture => picture.attrs.src.startsWith("data:image/png;base64,")));
  assert.ok(JSON.stringify(result).length > 2000000);
  assert.deepEqual(R.sanitize(JSON.parse(JSON.stringify(result))), result);
});

test("unreadable or oversized local pictures fail without saving temporary URLs", async () => {
  const original = document([node("img", [], { src: "blob:https://chatgpt.com/one" })]);
  await assert.rejects(R.materialize(original, async () => { throw new Error("revoked"); }), error => error.code === "media-save");
  await assert.rejects(R.materialize(original, async () => new Blob([new Uint8Array(R.MAX_IMAGE_BYTES + 1)], { type: "image/png" })), /超过 4 MB/);
  const four = document(Array.from({ length: 4 }, (_, index) => node("img", [], { src: `blob:https://chatgpt.com/${index}` })));
  await assert.rejects(R.materialize(four, async () => new Blob([new Uint8Array(2000000)], { type: "image/png" })), /超过 8 MB/);
  assert.ok(original.nodes[0].attrs.src.startsWith("blob:"));
});
test("gallery snapshots keep the best available picture for each generated asset", () => {
  const picture = (key, src, width) => ({ ...node("img", [], { src }), assetKey: key, size: { width, height: width / 2 } });
  const before = { version: 1, kind: "images", mediaKey: "gallery1", nodes: [picture("one", "https://example.com/one-full.png", 1200), picture("two", "https://example.com/two-thumb.png", 64)] };
  const after = { version: 1, kind: "images", mediaKey: "gallery1", nodes: [picture("one", "https://example.com/one-thumb.png", 64), picture("two", "https://example.com/two-full.png", 1200)] };
  const merged = R.preferSnapshot(before, after);
  assert.deepEqual(merged.nodes.map(node => node.size.width), [1200, 1200]);
  assert.equal(merged.nodes[0].attrs.src, before.nodes[0].attrs.src);
  assert.equal(merged.nodes[1].attrs.src, after.nodes[1].attrs.src);
  const regenerated = { ...after, mediaKey: "gallery2", nodes: [picture("new", "https://example.com/new.png", 1200)] };
  assert.deepEqual(R.preferSnapshot(before, regenerated), R.sanitize(regenerated));
});

test("signed gallery URLs become portable pictures before the original URLs expire", async () => {
  const urls = ["diagram", "satellite", "ground"].map(id => `https://chatgpt.com/backend-api/estuary/content?id=${id}&sig=temporary`);
  const original = { version: 1, kind: "images", mediaKey: "gallery1", nodes: urls.map((src, index) => ({ ...node("img", [], { src, alt: `图片 ${index + 1}`, crossorigin: "use-credentials" }), assetKey: `asset${index}` })) };
  const reads = [];
  const saved = await R.materialize(original, async url => { reads.push(url); return new Blob([new Uint8Array(3000)], { type: "image/png" }); });
  assert.deepEqual(reads, urls);
  assert.equal(saved.nodes.length, 3);
  assert.ok(saved.nodes.every(picture => picture.attrs.src.startsWith("data:image/png;base64,") && !picture.attrs.crossorigin));
  const reloaded = R.sanitize(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(await R.materialize(reloaded, async () => { throw new Error("403: expired"); }), reloaded);
  assert.deepEqual(original.nodes.map(picture => picture.attrs.src), urls);
  await assert.rejects(R.materialize(original, async () => { throw new Error("403: expired"); }), error => error.code === "media-save");
});

test("portable pictures replace legacy signed URLs and cannot be downgraded by later network thumbnails", () => {
  const picture = (src, width) => ({ ...node("img", [], { src }), assetKey: "one", size: { width, height: width / 2 } });
  const legacy = { version: 1, kind: "images", mediaKey: "gallery1", nodes: [picture("https://chatgpt.com/image?id=one&sig=expired", 2048)] };
  const saved = { ...legacy, nodes: [picture("data:image/webp;base64,aW1hZ2U=", 1200)] };
  assert.deepEqual(R.preferSnapshot(legacy, saved), R.sanitize(saved));
  assert.deepEqual(R.preferSnapshot(saved, legacy), R.sanitize(saved));
});

test("generated image links in illustrated answers are also persisted", async () => {
  const source = document([node("p", [{ text: "生成的图示" }]), node("img", [], { src: "https://chatgpt.com/backend-api/estuary/content?id=file1&sig=short-lived" })]);
  const saved = await R.materialize(source, async () => new Blob([new Uint8Array(100)], { type: "image/webp" }));
  assert.equal(saved.nodes[0].children[0].text, "生成的图示");
  assert.ok(saved.nodes[1].attrs.src.startsWith("data:image/webp;base64,"));
});

test("gallery downloads retain ChatGPT authentication without sending it to unrelated image hosts", async () => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path"), requests = [];
  const context = vm.createContext({ URL, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, location: { origin: "https://chatgpt.com" },
    fetch: async (url, options) => { requests.push({ url, credentials: options.credentials }); return { ok: true, blob: async () => new Blob([new Uint8Array(30)], { type: "image/png" }) }; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "rich.js"), "utf8"), context);
  const urls = ["https://chatgpt.com/backend-api/estuary/content?id=one&sig=temporary", "https://images.example/two.png"];
  const input = { version: 1, kind: "images", mediaKey: "gallery1", nodes: urls.map(src => node("img", [], { src })) };
  const saved = await context.GPTStickyRich.materialize(input);
  assert.deepEqual(requests, [{ url: urls[0], credentials: "include" }, { url: urls[1], credentials: "omit" }]);
  assert.ok(saved.nodes.every(picture => picture.attrs.src.startsWith("data:image/png;base64,")));
  await context.GPTStickyRich.materialize(input);
  assert.equal(requests.length, 2, "Repeated synchronization reuses the saved pixels");
  const preview = context.GPTStickyRich.imageForPreview({ currentSrc: urls[0], src: urls[0], complete: false, alt: "已保存的原图", naturalWidth: 1200, naturalHeight: 650, hasAttribute: () => false, getBoundingClientRect: () => ({ width: 400, height: 220 }) });
  assert.equal(preview.attrs.src, saved.nodes[0].attrs.src, "A sticky preview reuses cached pixels after signed URLs expire");
  assert.equal(requests.length, 2);
});
test("the user's actual ChatGPT SVG keeps its viewBox, Chinese labels, colors and arrows", () => {
  const xml = require("node:fs").readFileSync(require("node:path").join(__dirname, "native-concept.svg"), "utf8").trim();
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  assert.equal(src.length, 2301);
  const picture = R.sanitize(document([{ ...node("img", [], { src }), size: { width: 768, height: 365 }, style: { display: "none" } }])).nodes[0];
  assert.equal(decodeURIComponent(picture.attrs.src.split(",")[1]), xml);
  assert.match(xml, /viewBox="0 0 320 152"/);
  assert.match(xml, /语义分割图/); assert.match(xml, /stroke="currentColor"/);
  assert.equal(R.isMedia(picture), true);
});
test("independent CSS background images keep their SVG source and displayed geometry", () => {
  const url = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 350"><text>生成器</text></svg>')}`;
  assert.equal(R.backgroundSource(`url("${url}")`), R.safeUrl(url, true));
  assert.equal(R.backgroundSource('url("javascript:bad()")'), null);
  assert.equal(R.backgroundSource('linear-gradient(red,blue)'), null);
  assert.equal(R.backgroundSource('url("https://example.com/one.png"),url("https://example.com/two.png")'), null);
  const picture = { ...node("img", [], { src: url }), size: { width: 768, height: 350 } };
  assert.deepEqual(R.sanitize(document([picture])).nodes[0].size, picture.size);
  assert.equal(R.sanitize(document([{ ...picture, size: { width: Infinity, height: -1 } }])).nodes[0].size, undefined);
});

test("rich snapshots retain paragraph breaks, emphasis, indentation, images and native formulas", () => {
  const saved = R.sanitize(document([
    node("h2", [{ text: "例子" }]), node("p", [node("strong", [{ text: "重要" }]), node("br"), { text: "下一行" }]),
    node("ol", [node("li", [{ text: "一级" }, node("ul", [node("li", [{ text: "二级" }])])])]),
    node("img", [], { src: "https://chatgpt.com/image.png", alt: "图示" }),
    node("math", [node("mfrac", [node("mn", [{ text: "1" }], {}, "math"), node("msqrt", [node("mn", [{ text: "2" }], {}, "math")], {}, "math")], {}, "math")], { display: "block" }, "math"),
    node("table", [node("tbody", [node("tr", [node("td", [{ text: "单元格" }])])])])
  ]));
  assert.equal(R.hasContent(saved), true);
  assert.deepEqual(R.stats(saved), { images: 1, formulas: 1, tables: 1, diagrams: 0 });
  assert.equal(saved.nodes[1].children[1].tag, "br");
  assert.equal(saved.nodes[2].children[0].children[1].tag, "ul");
});

test("imported markup cannot inject scripts, event handlers or executable URLs", () => {
  const saved = R.sanitize(document([
    node("script", [{ text: "alert(1)" }]), node("iframe", [], { srcdoc: "bad" }),
    node("img", [], { src: "javascript:alert(1)", onerror: "alert(2)", alt: "图" }),
    node("a", [{ text: "链接" }], { href: "data:text/html,bad", onclick: "alert(3)" })
  ]));
  assert.equal(saved.nodes.length, 2);
  assert.deepEqual(saved.nodes[0].attrs, { alt: "图" });
  assert.deepEqual(saved.nodes[1].attrs, {});
  assert.equal(R.safeUrl("file:///C:/secret.png", true), null);
  assert.equal(R.safeUrl("data:text/html;base64,AAAA", true), null);
});

test("MathML annotations and SVG external references do not become HTML or scripts", () => {
  const saved = R.sanitize(document([
    node("math", [node("annotation-xml", [node("script")], {}, "math"), node("mi", [{ text: "x" }], { onclick: "bad" }, "math")], {}, "math"),
    node("svg", [node("use", [], { href: "#glyph", onclick: "bad" }, "svg"), node("use", [], { href: "https://bad.example/file.svg#id" }, "svg")], { viewBox: "0 0 20 20", onload: "bad" }, "svg")
  ]));
  assert.equal(saved.nodes[0].children.length, 1);
  assert.deepEqual(saved.nodes[1].children[0].attrs, { href: "#glyph" });
  assert.deepEqual(saved.nodes[1].children[1].attrs, {});
  assert.equal(saved.nodes[1].attrs.onload, undefined);
});

test("typography remains portable while remote CSS and fixed overlays are rejected", () => {
  const raw = document([node("span", [{ text: "文字" }])]);
  raw.typography = { "font-family": "OpenAI Sans, sans-serif", "font-size": "16px", "line-height": "28px", position: "fixed", "background-image": "url(https://bad.example/track)" };
  raw.nodes[0].style = { position: "fixed", color: "url(https://bad.example/x)", "font-weight": "700" };
  const saved = R.sanitize(raw);
  assert.deepEqual(saved.typography, { "font-family": "OpenAI Sans, sans-serif", "font-size": "16px", "line-height": "28px" });
  assert.deepEqual(saved.nodes[0].style, { "font-weight": "700" });
});
test("SVG image primitives preserve image URLs without permitting script references", () => {
  const saved = R.sanitize(document([node("svg", [
    node("image", [], { href: "https://chatgpt.com/image.png", width: "700", height: "350" }, "svg"),
    node("image", [], { href: "javascript:bad()", onload: "bad()" }, "svg")
  ], { viewBox: "0 0 700 350" }, "svg")]));
  assert.equal(saved.nodes[0].children[0].attrs.href, "https://chatgpt.com/image.png");
  assert.deepEqual(saved.nodes[0].children[1].attrs, {});
});
test("raw SVG data URLs with Unicode, whitespace and utf8 parameters stay visible", () => {
  const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 350"><text>地面图 Generator</text><rect width="100%" /></svg>';
  for (const url of [`data:image/svg+xml,${xml}`, `data:image/svg+xml;utf8,${xml}`, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`]) {
    const saved = R.sanitize(document([node("img", [], { src: url })]));
    assert.ok(saved.nodes[0].attrs.src.startsWith("data:image/svg+xml;charset=utf-8,"));
    assert.equal(decodeURIComponent(saved.nodes[0].attrs.src.split(",")[1]), xml);
    assert.equal(R.isMedia(saved.nodes[0]), true); assert.equal(R.stats(saved).images, 1);
    assert.deepEqual(R.sanitize(saved), saved);
  }
  assert.equal(R.safeUrl("data:image/png;base64,aW1h\nZ2U=", true), "data:image/png;base64,aW1hZ2U=");
  assert.equal(R.safeUrl("data:text/html,<script>bad()</script>", true), null);
});
test("partially unloaded answers cannot erase saved images, formulas or diagrams", () => {
  const complete = document([node("p", [{ text: "完整解释" }]), node("img", [], { src: "https://chatgpt.com/image.png" }), node("math", [], {}, "math")]);
  const partial = document([node("p", [{ text: "完整解释" }]), node("img", [], { alt: "暂未加载" })]);
  assert.equal(R.stats(partial).images, 0);
  assert.deepEqual(R.preferSnapshot(complete, partial), R.sanitize(complete));
  assert.deepEqual(R.preferSnapshot(complete, null), R.sanitize(complete));
  assert.deepEqual(R.preferSnapshot(partial, complete), R.sanitize(complete));
});
test("local blob images are automatically made portable without fetching remote images", async () => {
  const url = "blob:https://chatgpt.com/1234", xml = '<svg xmlns="http://www.w3.org/2000/svg"><text>自动图示</text></svg>';
  const reads = [];
  const saved = await R.materialize(document([node("img", [], { src: url }), node("img", [], { src: url }), node("img", [], { src: "https://chatgpt.com/photo.png" })]), async src => { reads.push(src); return new Blob([xml], { type: "image/svg+xml" }); });
  assert.deepEqual(reads, [url]);
  assert.ok(saved.nodes[0].attrs.src.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.equal(saved.nodes[1].attrs.src, saved.nodes[0].attrs.src); assert.equal(saved.nodes[2].attrs.src, "https://chatgpt.com/photo.png");
});
test("flow-based concept drawings can be mirrored without turning surrounding prose into media", () => {
  const drawing = node("div", [node("div", [{ text: "Satellite" }]), node("div", [{ text: "Generator" }]), node("div", [{ text: "Ground" }])]);
  drawing.layout = "graphic"; drawing.size = { width: 700, height: 200 }; drawing.style = { display: "grid", "grid-template-columns": "1fr 1fr 1fr", width: "700px", height: "200px" };
  drawing.children.forEach(child => { child.style = { "background-color": "rgb(224, 235, 247)", "border-top-width": "2px", "border-top-style": "solid", "border-radius": "10px" }; });
  assert.equal(R.isMedia(R.sanitize(document([drawing])).nodes[0]), true);
  const answer = node("div", [node("p", [{ text: "这是普通解释" }]), drawing]); answer.layout = "graphic"; answer.size = { width: 700, height: 500 };
  assert.equal(R.isMedia(R.sanitize(document([answer])).nodes[0]), false);
});

test("diagram snapshots preserve SVG markers, colors and HTML labels without active content", () => {
  const svg = node("svg", [
    node("defs", [node("marker", [node("path", [], { d: "M0 0L10 5L0 10" }, "svg")], { id: "arrow", markerWidth: "6", refX: "9", orient: "auto" }, "svg")], {}, "svg"),
    node("rect", [], { fill: "rgb(222, 237, 248)", rx: "14", width: "250" }, "svg"),
    node("path", [], { "marker-end": "url(#arrow)", stroke: "#17252e" }, "svg"),
    node("foreignObject", [node("div", [{ text: "Generator" }, node("script", [{ text: "bad()" }]), node("a", [{ text: "label" }], { href: "javascript:bad()" })], { onclick: "bad()" })], { x: "370", width: "220", height: "63" }, "svg")
  ], { viewBox: "0 0 960 350", onload: "bad()" }, "svg");
  svg.layout = "diagram";
  const saved = R.sanitize(document([svg]));
  assert.equal(saved.nodes[0].layout, "diagram");
  assert.equal(saved.nodes[0].children[0].children[0].attrs.id, "arrow");
  assert.equal(saved.nodes[0].children[2].attrs["marker-end"], "url(#arrow)");
  assert.equal(saved.nodes[0].children[3].children[0].children.length, 2);
  assert.equal(saved.nodes[0].children[3].children[0].children[1].attrs.href, undefined);
  assert.deepEqual(R.stats(saved), { images: 0, formulas: 0, tables: 0, diagrams: 1 });
});

test("oversized or deeply nested snapshots are rejected without breaking import", () => {
  assert.equal(R.sanitize(document([{ text: "x".repeat(R.MAX_SNAPSHOT_SIZE + 1) }])), null);
  let nested = { text: "内容" };
  for (let i = 0; i < 65; i++) nested = node("div", [nested]);
  assert.equal(R.sanitize(document([nested])), null);
  assert.equal(R.sanitize({ version: 999, nodes: [] }), null);
});
test("HTML concept diagrams keep fixed geometry and exclude unsafe script styles", () => {
  const graphic = node("div", [node("div", [{ text: "Generator" }]), node("div", [{ text: "地面图" }])]); graphic.layout = "graphic"; graphic.size = { width: 700, height: 360 };
  graphic.style = { position: "relative", width: "700px", height: "360px" };
  graphic.children[0].style = { position: "absolute", left: "240px", top: "100px", "background-color": "#dceee1", "background-image": "url(https://bad.example/track)", "border-radius": "14px" };
  graphic.children[1].style = { position: "absolute", left: "500px", top: "100px" };
  const saved = R.sanitize(document([graphic]));
  assert.deepEqual(saved.nodes[0].size, { width: 700, height: 360 });
  assert.equal(saved.nodes[0].children[0].style.left, "240px"); assert.equal(saved.nodes[0].children[0].style["background-image"], undefined);
  assert.equal(R.stats(saved).diagrams, 1);
  graphic.size.width = 1000000; assert.equal(R.sanitize(document([graphic])).nodes[0].layout, undefined);
});

test("whole-answer graphic snapshots recover selectable prose, formulas and individual drawings", () => {
  const drawing = node("div", [node("div", [{ text: "输入" }]), node("div", [{ text: "输出" }])]);
  drawing.style = { position: "relative", width: "600px", height: "320px" };
  drawing.children.forEach((child, index) => { child.style = { position: "absolute", left: `${index * 250}px`, top: "80px" }; });
  const svg = node("svg", [node("rect", [], { width: "300", height: "100" }, "svg")], { viewBox: "0 0 600 300" }, "svg");
  const math = node("math", [node("mfrac", [node("mi", [{ text: "x" }], {}, "math"), node("mn", [{ text: "2" }], {}, "math")], {}, "math")], { display: "block" }, "math");
  const prose = node("p", [node("strong", [{ text: "正文可以选中" }]), node("br"), { text: "仍按段落阅读。" }]);
  prose.style = { width: "800px", height: "60px", position: "relative", "font-size": "16px", "line-height": "28px", "margin-bottom": "12px" };
  const answer = node("div", [node("h2", [{ text: "第一节" }]), prose, drawing, math, node("h2", [{ text: "第二节" }]), svg, node("img", [], { src: "https://chatgpt.com/image.png" })]);
  answer.layout = "graphic"; answer.size = { width: 800, height: 3900 }; answer.style = { position: "relative", width: "800px", height: "3900px", "max-width": "none" };
  const saved = R.sanitize(document([answer])), flow = saved.nodes[0];
  assert.equal(flow.layout, undefined); assert.equal(flow.size, undefined); assert.equal(flow.style, undefined);
  assert.deepEqual(flow.children[1].style, { "font-size": "16px", "line-height": "28px", "margin-bottom": "12px" });
  assert.equal(flow.children[1].children[0].tag, "strong"); assert.equal(flow.children[1].children[1].tag, "br");
  assert.equal(flow.children[3].tag, "math"); assert.equal(flow.children[3].children[0].tag, "mfrac");
  assert.equal(R.isMedia(flow), false); assert.equal(R.isMedia(flow.children[2]), true); assert.equal(R.isMedia(flow.children[5]), true);
  assert.deepEqual(R.stats(saved), { images: 1, formulas: 1, tables: 0, diagrams: 2 });
  assert.deepEqual(R.sanitize(saved), saved);
});

test("ordinary text and formulas cannot acquire media previews from a layout label", () => {
  for (const item of [node("p", [{ text: "一段说明" }]), node("math", [], {}, "math"), node("div", [node("p", [{ text: "全文" }])])]) {
    item.layout = "graphic"; item.size = { width: 800, height: 500 };
    const saved = R.sanitize(document([item])).nodes[0];
    assert.equal(saved.layout, undefined); assert.equal(R.isMedia(saved), false);
  }
  const mislabeled = node("div", [{ text: "不是 SVG" }]); mislabeled.layout = "diagram";
  assert.equal(R.isMedia(R.sanitize(document([mislabeled])).nodes[0]), false);
});

test("a renderer containing ordinary paragraphs is prose even with positioned decorations", () => {
  const answer = node("div", [node("p", [{ text: "没有标题的完整回答。" }]), node("div"), node("div")]);
  answer.children[1].style = answer.children[2].style = { position: "absolute" };
  answer.layout = "graphic"; answer.size = { width: 700, height: 500 };
  assert.equal(R.sanitize(document([answer])).nodes[0].layout, undefined);
});

test("image-only archived answers survive backup import", () => {
  const raw = { schema: 1, mode: "archive", id: "note-1", conversation: "c:abc", exchanges: [
    { id: "e1", question: "画出来", userText: "画出来", answer: "", placement: "sidebar", responseKind: "image", mediaKey: "gallery",
      answerDocument: document([node("img", [], { src: "https://chatgpt.com/image.png" })]) }
  ] };
  const saved = C.sanitizeNote(raw);
  assert.equal(saved.exchanges[0].status, "saved");
  assert.equal(R.stats(saved.exchanges[0].answerDocument).images, 1);
  assert.equal(saved.exchanges[0].placement, "sidebar");
  assert.equal(saved.exchanges[0].mediaKey, "gallery");
});
