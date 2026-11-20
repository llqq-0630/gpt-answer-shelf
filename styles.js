globalThis.GPTStickyStyles = String.raw`
:host {
  all: initial; font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #0d0d0d; color-scheme: light;
  --paper: #ffffff; --surface: #ffffff; --ink: #0d0d0d; --muted: #6b6b6b;
  --line: #e5e5e5; --accent: #0d0d0d; --accent-ink: #ffffff; --action-hover: #363636;
  --soft: #f4f4f4; --quote-line: #b4b4b4; --shadow: 0 8px 30px #00000014;
}
:host([data-theme="dark"]) {
  color-scheme: dark; --paper: #212121; --surface: #2f2f2f; --ink: #ececec;
  --muted: #b4b4b4; --line: #424242; --accent: #ececec; --accent-ink: #0d0d0d;
  --action-hover: #d5d5d5; --soft: #2f2f2f; --quote-line: #676767; --shadow: 0 8px 30px #0005;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input, textarea { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .55; }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.btn { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 7px 12px; }
.btn:hover { background: var(--soft); }
.quiet { background: transparent; border: 0; padding: 5px 8px; color: var(--muted); border-radius: 6px; }
.quiet:hover { color: var(--ink); background: var(--soft); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.between { justify-content: space-between; }
.muted { color: var(--muted); font-size: 12px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.launcher { position: fixed; right: 20px; bottom: 108px; z-index: 2147483000; padding: 10px 16px; background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow); }
.panel { position: fixed; margin: 0; padding: 0; right: 18px; top: 72px; bottom: 86px; width: min(460px, calc(100vw - 24px)); z-index: 2147483001; background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden; }
.panel::backdrop { background: transparent; pointer-events: none; }
.answer-card { border-top: 4px solid #d8bc70; }
.panel-head > .row.between { cursor: grab; touch-action: none; user-select: none; }
.panel[data-dragging] .panel-head > .row.between { cursor: grabbing; }
.panel-head > .row.between button { cursor: pointer; }
.answer-card .panel-head { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 8px; padding: 10px 14px 8px; }
.answer-card .panel-head > .row.between { width: 100%; }
.native-slot { width: 100%; min-width: 0; margin: 0 auto; }
.backup-label { padding: 4px 0 8px; }
.panel-head { padding: 17px 18px 12px; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.title { font-size: 17px; font-weight: 600; }
.search { width: 100%; margin: 12px 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); padding: 8px 10px; }
.check { display: flex; gap: 7px; align-items: center; font-size: 12px; color: var(--muted); }
.check input { accent-color: var(--accent); }
.backup-actions { margin-top: 10px; }
.panel-body { flex: 1; padding: 14px 18px 20px; overflow-y: auto; min-height: 0; }
.empty { padding: 24px 0; color: var(--muted); }
.directory-item { display: block; width: 100%; text-align: left; color: var(--ink); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 9px; background: var(--surface); }
.directory-item:hover { background: var(--soft); border-color: var(--quote-line); }
.directory-item .text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.question { font-weight: 600; margin-bottom: 7px; }
.target-question { border-inline-start: 3px solid #c5a04d; padding-inline-start: 9px; }
.answer { white-space: pre-wrap; overflow-wrap: anywhere; }
.rich { white-space: normal; font-size: 16px; line-height: 1.75; }
.rich-content { max-width: 100%; min-width: 0; position: relative; isolation: isolate; }
.rich-image-gallery { display: grid; gap: 16px; }
.rich-content > :first-child { margin-top: 0 !important; }
.rich-content > :last-child { margin-bottom: 0 !important; }
.rich p { margin: 0 0 1em; }
.rich h1, .rich h2, .rich h3, .rich h4, .rich h5, .rich h6 { line-height: 1.4; font-weight: 600; margin: 1.4em 0 .6em; }
.rich h1 { font-size: 1.4em; } .rich h2 { font-size: 1.25em; } .rich h3 { font-size: 1.125em; }
.rich strong, .rich b { font-weight: 600; }
.rich ul, .rich ol { padding-inline-start: 1.75em; margin: .75em 0; }
.rich li { margin: .25em 0; } .rich li > p { margin: .4em 0; }
.rich blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid var(--quote-line); }
.rich a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.rich img { display: block; max-width: 100%; width: auto; height: auto; border-radius: 10px; }
.rich figure { margin: .75em 0; min-width: 0; }
.rich figcaption { margin-top: .5em; font-size: 13px; color: var(--muted); }
.rich-media-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 175px), 1fr)); gap: 12px; align-items: start; }
.rich-media-grid > * { min-width: 0; margin: 0; }
.rich pre { margin: 1em 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); overflow-x: auto; white-space: pre; }
.rich code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; }
.rich :not(pre) > code { padding: .1em .3em; border-radius: 4px; background: var(--soft); }
.rich pre code { padding: 0; background: transparent; }
.rich-table-scroll { overflow-x: auto; margin: 1em 0; max-width: 100%; }
.rich table { border-collapse: collapse; min-width: 100%; }
.rich th, .rich td { padding: 8px 10px; border: 1px solid var(--line); text-align: left; }
.rich hr { border: 0; border-top: 1px solid var(--line); margin: 1.5em 0; }
.rich-formula-block, .rich-math-block { overflow-x: auto; overflow-y: hidden; text-align: center; margin: 1em 0; padding: 4px 0; }
.rich math { font-size: 1.05em; } .rich svg { max-width: 100%; }
.image-unavailable { display: block; padding: 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); font-size: 13px; }
.media-trigger { display: inline-block; border: 0; padding: 0; margin: 0; max-width: 100%; background: transparent; color: inherit; text-align: inherit; cursor: zoom-in; vertical-align: top; }
.diagram-trigger { display: block; width: 100%; margin: 1em 0; }
.image-trigger { display: block; width: 100%; }
.media-trigger img, .media-trigger svg { cursor: zoom-in; }
.media-overlay { position: fixed; inset: 0; margin: 0; width: 100%; height: 100%; max-width: none; max-height: none; border: 0; padding: 24px; background: #0009; z-index: 2147483008; display: grid; place-items: center; }
.media-dialog { display: flex; flex-direction: column; width: min(1200px, 100%); height: min(850px, 100%); min-height: 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--paper); color: var(--ink); box-shadow: var(--shadow); }
.media-head { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.media-title { font-weight: 600; overflow-wrap: anywhere; }
.media-stage { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
.media-art { margin: 0 auto; min-width: 0; max-width: none; }
.media-art > .rich-content > img, .media-art > .rich-content > svg { display: block !important; width: 100% !important; height: auto !important; max-width: none !important; }
.question-actions { display: flex; justify-content: flex-end; margin-top: 4px; }
.answer-actions { display: flex; margin-top: 6px; }
.answer-action { display: inline-flex; align-items: center; gap: 5px; border: 1px solid transparent; background: transparent; color: var(--muted); padding: 2px 8px; min-height: 25px; font-size: 12px; line-height: 1.45; border-radius: 6px; }
.answer-actions .answer-action { color: var(--ink); border-color: var(--line); }
.answer-action.archived { color: var(--ink); background: var(--paper); border-color: var(--line); }
.answer-action.archived::before { content: ""; width: 6px; height: 6px; border-radius: 2px; background: #c5a04d; }
.answer-action:hover { background: var(--soft); color: var(--ink); }
.toast { position: fixed; margin: 0; inset: auto; left: 50%; transform: translateX(-50%); bottom: 28px; max-width: min(620px, calc(100vw - 30px)); padding: 11px 16px; border-radius: 10px; background: var(--paper); color: var(--ink); border: 1px solid var(--line); box-shadow: var(--shadow); z-index: 2147483010; }
.toast .row { flex-wrap: nowrap; }
@media (max-width: 520px) {
  .panel { right: 12px; top: 58px; bottom: 70px; }
  .launcher { right: 12px; bottom: 94px; }
  button { min-height: 40px; }
  .answer-action { min-height: 34px; }
}
`;
