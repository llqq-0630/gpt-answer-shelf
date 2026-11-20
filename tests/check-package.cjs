"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Expected Manifest V3");
if (manifest.permissions?.length !== 1 || manifest.permissions[0] !== "storage") throw new Error("The archive extension should request storage only");
const contentCode = fs.readFileSync(path.join(root, "content.js"), "utf8");
if (!contentCode.includes(`const SCRIPT_VERSION = "${manifest.version}";`)) throw new Error("Content script version differs from manifest");
const scripts = [...manifest.content_scripts.flatMap(item => item.js), "popup.js", manifest.background?.service_worker].filter(Boolean);
const fixture = fs.readFileSync(path.join(root, "tests/fixture.html"), "utf8");
for (const script of manifest.content_scripts.flatMap(item => item.js)) {
  if (!fixture.includes(`src="/${script}"`)) throw new Error(`Missing fixture script: ${script}`);
}
for (const script of scripts) new vm.Script(fs.readFileSync(path.join(root, script), "utf8"), { filename: script });
for (const file of [...manifest.content_scripts.flatMap(item => item.css), manifest.action.default_popup, "popup.css"]) {
  if (!fs.statSync(path.join(root, file)).isFile()) throw new Error(`Missing resource: ${file}`);
}
process.stdout.write(`扩展配置与 ${scripts.length} 个脚本检查通过。\n`);
