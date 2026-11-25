"use strict";
importScripts("storage.js", "file-storage.js");
const noteStore = GPTStickyStorage.create({ area: chrome.storage.local, folders: GPTAnswerShelfFolders });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "gpt-answer-shelf:store") return;
  let page;
  try { page = new URL(sender.url); } catch { sendResponse({ ok: false, error: "无法确认页面来源。" }); return; }
  if (page.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(page.hostname)) {
    sendResponse({ ok: false, error: "收纳存储只允许 ChatGPT 页面使用。" }); return;
  }
  if (!["list", "read", "save", "restore", "import", "compact"].includes(message.operation)) {
    sendResponse({ ok: false, error: "请打开扩展的存储设置进行此操作。" }); return;
  }
  noteStore.handle(message).then(sendResponse);
  return true;
});
