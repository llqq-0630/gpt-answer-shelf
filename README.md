# GPT 回答收纳

把 ChatGPT 的长回答收进侧栏，问句和「查看回答」入口留在原处。回看长对话时，可以顺着问句找到需要的回答。

**版本 0.2.9** · 支持 Chrome 和 Microsoft Edge 114 及以上

## 安装

1. 在本仓库点 **Code → Download ZIP**，下载后解压。
2. 在 Chrome 地址栏打开 `chrome://extensions`，或在 Edge 地址栏打开 `edge://extensions`。
3. 启用**开发人员模式**，点击**加载已解压的扩展程序**（Load unpacked），选中解压后包含 `manifest.json` 的文件夹。 [Chrome 安装文档](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) · [Edge 安装文档](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/getting-started/extension-sideloading)
4. 打开或刷新 ChatGPT 对话。

## 使用

1. **收纳回答**。点击问句旁或回答末尾的「收进侧栏」。从回答末尾收纳时，页面会回到对应的问句。
2. **查看回答**。点击原问句旁的「查看回答」，也可以从页面右下角打开「收纳」目录，按问句或回答内容搜索。
3. **放回原位**。在侧栏点击「放回主对话」。如果网页还没加载原问答，可以在提示里点击「查找原问答」。

已经加载的历史问答也能收纳。按住标题栏可以拖动侧栏，点「宽窗口」可以展开阅读区域。原回答可用时，侧栏沿用 ChatGPT 的排版，支持复制回答、阅读表格、代码和公式。点击图片可以在侧栏上方预览，按 Esc 关闭。

## 本地保存与备份

扩展按对话把收纳记录保存在当前浏览器。刷新后会恢复收纳状态，原回答尚未加载时可以在侧栏查看本地备份。可以从「收纳」目录导出或导入 JSON 备份。

## 本地演示与测试

安装 Node.js 后，在仓库根目录运行以下命令。

```powershell
node tests/preview.cjs
```

然后在浏览器打开示例对话。 [本地演示](http://127.0.0.1:8787/c/demo) · [富文本演示](http://127.0.0.1:8787/c/demo?fixture=rich&structure=work&rich=1&strict=1&native-test=1)

运行测试和扩展文件检查。

```powershell
node --test tests/*.test.cjs
node tests/check-package.cjs
```
