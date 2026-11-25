# GPT 回答收纳

把 ChatGPT 的长回答收进侧栏，问句和「查看回答」入口留在原处。回看长对话时，可以顺着问句找到需要的回答。

**版本 0.3.0** · Chrome 和 Microsoft Edge 桌面版 114 及以上。安装、迁移和备份的详细步骤见 [使用说明](使用说明.md)。

## 安装与升级

1. 在本仓库点 **Code → Download ZIP**，下载后解压。
2. 在 Chrome 地址栏打开 `chrome://extensions`，或在 Edge 地址栏打开 `edge://extensions`。
3. 启用**开发人员模式**，点击**加载已解压的扩展程序**（Load unpacked），选中解压后包含 `manifest.json` 的文件夹。[Chrome 安装文档](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) · [Edge 安装文档](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/getting-started/extension-sideloading)
4. 打开或刷新 ChatGPT 对话。

升级时，把新版文件复制到原来的扩展文件夹，覆盖旧文件并包含新增文件。在同一个浏览器配置的扩展管理页点击该扩展的「重新加载」，再刷新 ChatGPT 标签页。这样可以沿用已有收纳记录和设置。[Chrome 重新加载说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload)

## 使用

1. **收纳回答**。点击问句旁或回答末尾的「收进侧栏」。从回答末尾收纳时，插件会尝试回到对应的问句。
2. **查看回答**。点击原问句旁的「查看回答」，也可以从页面右下角打开「收纳」目录，按问句或回答内容搜索。
3. **放回原位**。在侧栏点击「放回主对话」。如果网页还没加载原问答，可以在提示里点击「查找原问答」。

已经加载的历史问答也能收纳。收纳目录中的「在主对话中收起已收纳的回答」默认勾选。按住标题栏可以拖动侧栏，点「宽窗口」可以展开阅读区域。原回答可用时，侧栏沿用 ChatGPT 对表格、代码和公式的排版，并保留原回答自带的操作。点击图片可在侧栏上方预览，按 Esc 关闭。

## 存储与备份

点浏览器工具栏上的扩展图标，再点「存储设置」。

- **收纳容量**。默认上限为 **1 GB（1024 MB）**，由同一浏览器配置下的所有对话共用。可以查看已用容量，并按整数 MB 调整上限。
- **收纳位置**。默认使用浏览器本地存储。支持文件夹访问的桌面浏览器可以选择本机文件夹并授权读写，也可以切回浏览器存储。扩展会复制并校验已有记录，再切换位置。
- **导出与导入**。在收纳目录可导出当前对话的 JSON 备份，也可以导入备份。单个备份文件最多 64 MB，较大的备份会显示「导出下一份」。

收纳记录保存在当前设备。扩展使用 `storage` 和 `unlimitedStorage` 管理浏览器本地存储，并按「存储设置」里的上限控制收纳容量。原回答尚未加载时，可以在侧栏查看本地备份。[浏览器存储说明](https://developer.chrome.com/docs/extensions/reference/api/storage#property-local)

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
