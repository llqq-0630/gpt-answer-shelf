"use strict";
const status = document.getElementById("status");
const openButton = document.getElementById("open");
const reloadButton = document.getElementById("reload");
const help = document.getElementById("help");
const version = chrome.runtime.getManifest().version;
document.getElementById("version").textContent = `v${version}`;
let checking = false;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有活动网页。");
  return tab;
}
function needsReload(text) {
  status.textContent = text;
  openButton.disabled = true;
  reloadButton.hidden = false;
  help.hidden = false;
}
async function checkPage() {
  if (checking) return;
  checking = true;
  openButton.disabled = true;
  reloadButton.hidden = true;
  help.hidden = true;
  status.textContent = "正在检查当前页面…";
  try {
    const tab = await currentTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "gpt-answer-shelf:ping" });
    if (!response) {
      needsReload("当前页面没有响应，请先刷新 ChatGPT 网页。");
    } else if (!response.ok) {
      needsReload(response?.status === "error" ? `扩展启动失败：${response.error}\n请重新加载扩展，再刷新网页。` : "扩展正在启动，请稍后重新检查。");
    } else if (response.version !== version) {
      needsReload(`此网页仍在运行旧版 v${response.version || "未知"}，刷新后将使用 v${version}。`);
    } else if (response.pageScriptVersion !== version) {
      needsReload("当前网页的脚本版本尚未确认。请刷新 ChatGPT 网页，确保扩展更新已经生效。");
    } else if (!response.uiMounted) {
      needsReload("扩展脚本已加载，页面入口暂未显示。请刷新网页后重试。");
    } else if (response.uiInstances > 1) {
      needsReload("当前网页检测到多个收纳入口。请刷新网页，再检查是否启用了重复的扩展。");
    } else {
      openButton.disabled = false;
      const guidance = !response.conversationReady ? "打开一段 ChatGPT 对话即可使用。"
        : response.questionCount ? `已识别 ${response.questionCount} 组可收纳问答。`
        : "暂未识别到可收纳问答。若页面已有完整回答，可复制页面诊断。";
      status.textContent = `当前页面已加载 v${version}。\n${guidance}`;
    }
  } catch {
    needsReload("当前页面还没有加载收纳扩展。请刷新 ChatGPT 网页后重新检查。");
  } finally { checking = false; }
}
openButton.addEventListener("click", async () => {
  try {
    const tab = await currentTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "gpt-answer-shelf:open" });
    if (!response?.ok) throw new Error("收纳扩展尚未完成启动。");
    window.close();
  } catch { await checkPage(); }
});
reloadButton.addEventListener("click", async () => {
  reloadButton.disabled = true;
  try {
    const tab = await currentTab();
    await chrome.tabs.reload(tab.id);
    status.textContent = "网页正在刷新。加载完成后，点击“重新检查加载状态”。";
  } catch { status.textContent = "网页刷新失败，请返回 ChatGPT 标签页按 Ctrl+R。"; }
  finally { reloadButton.disabled = false; }
});
document.getElementById("check").addEventListener("click", checkPage);
document.getElementById("settings").addEventListener("click", async () => {
  try { await chrome.runtime.openOptionsPage(); window.close(); }
  catch { status.textContent = "暂时无法打开存储设置，请从浏览器的扩展详情页打开。"; }
});
document.getElementById("diagnose").addEventListener("click", async () => {
  const reportBox = document.getElementById("diagnostic-report");
  try {
    const tab = await currentTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "gpt-answer-shelf:diagnose" });
    if (!response?.report) throw new Error("页面还没有加载诊断，请先刷新 ChatGPT 网页。");
    const report = JSON.stringify(response.report, null, 2);
    reportBox.value = report; reportBox.hidden = false;
    try { await navigator.clipboard.writeText(report); status.textContent = "页面诊断已复制，不包含聊天正文。请粘贴到当前 Codex 对话，协助修复。"; }
    catch { reportBox.focus(); reportBox.select(); status.textContent = "页面诊断已选中，按 Ctrl+C 复制后粘贴到当前 Codex 对话即可。"; }
  } catch (error) { status.textContent = error.message; }
});
checkPage();
