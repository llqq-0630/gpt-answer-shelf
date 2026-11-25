"use strict";
const storage = GPTStickyStorage.create({ area: chrome.storage.local, folders: GPTAnswerShelfFolders });
const byId = id => document.getElementById(id);
const limit = byId("limit"), choose = byId("choose-folder"), authorize = byId("authorize"), browser = byId("browser-storage");
const controls = [limit, byId("save-limit"), choose, authorize, browser];
const storageSupported = typeof window.showDirectoryPicker === "function";
let busy = false, folderHandle = null;

function format(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit++; }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(bytes) + " " + units[unit];
}
function notice(text, error = false) {
  const status = byId("status");
  status.textContent = text;
  status.dataset.error = String(error);
}
function setBusy(value) {
  busy = value;
  for (const control of controls) control.disabled = value;
  choose.disabled ||= !storageSupported;
}
async function update(resetLimit = false) {
  const { settings, usedBytes, warning } = await storage.request({ operation: "settings" });
  if (resetLimit) limit.value = settings.limitBytes / GPTStickyStorage.MIB;
  const folder = settings.folder;
  byId("location").textContent = folder ? `文件夹「${folder.name}」` : "浏览器本地存储";
  byId("usage").textContent = usedBytes == null ? `上限 ${format(settings.limitBytes)}。当前用量暂不可用。`
    : `已用 ${format(usedBytes)}，上限 ${format(settings.limitBytes)}`;
  const meter = byId("meter");
  meter.hidden = usedBytes == null;
  meter.max = settings.limitBytes;
  meter.value = Math.min(usedBytes || 0, settings.limitBytes);
  meter.classList.toggle("over-limit", usedBytes > settings.limitBytes);
  browser.hidden = !folder;
  folderHandle = folder ? await GPTAnswerShelfFolders.getHandle(folder.id).catch(() => null) : null;
  authorize.hidden = !folderHandle || await folderHandle.queryPermission({ mode: "readwrite" }) === "granted";
  if (!storageSupported) byId("location-hint").textContent = "此浏览器可使用本地存储。选择数据文件夹需要支持文件夹访问的桌面浏览器。";
  if (warning) return warning;
  if (!authorize.hidden) return "请重新授权数据文件夹，以继续保存收纳记录。";
  return usedBytes > settings.limitBytes ? "当前用量超过了上限。放回部分回答或调高上限后，可继续收纳。" : "";
}
async function act(action, pendingText = "") {
  if (busy) return;
  setBusy(true);
  if (pendingText) notice(pendingText);
  try {
    const message = await action();
    const warning = await update(true);
    notice([message, warning].filter(Boolean).join(" "), Boolean(warning));
  } catch (error) {
    notice(error.name === "AbortError" ? "已取消选择。" : GPTStickyStorage.failure(error).error, error.name !== "AbortError");
  } finally { setBusy(false); }
}
byId("limit-form").addEventListener("submit", event => {
  event.preventDefault();
  void act(async () => {
    await storage.request({ operation: "limit", bytes: limit.valueAsNumber * GPTStickyStorage.MIB });
    return "收纳上限已保存。";
  });
});
choose.addEventListener("click", () => void act(async () => {
  const folder = await window.showDirectoryPicker({ mode: "readwrite", id: "gpt-answer-shelf" });
  notice("正在迁移收纳记录，请保持此页打开…");
  const result = await storage.request({ operation: "location", folder });
  return result.cleanupWarning ? "已切换到所选文件夹。原位置有部分副本未清理。" : "已切换到所选文件夹。";
}));
browser.addEventListener("click", () => void act(async () => {
  const result = await storage.request({ operation: "location", folder: null });
  return result.cleanupWarning ? "已改用浏览器存储。原文件夹有部分副本未清理。" : "已改用浏览器存储。";
}, "正在迁移收纳记录，请保持此页打开…"));
authorize.addEventListener("click", () => void act(async () => {
  if (!folderHandle || await folderHandle.requestPermission({ mode: "readwrite" }) !== "granted") {
    return "请允许读取和写入这个数据文件夹。";
  }
  await chrome.storage.local.set({ [GPTStickyStorage.CHANGE]: { id: crypto.randomUUID(), conversations: null } });
  return "已重新授权数据文件夹。";
}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (busy || area !== "local" || !(changes[GPTStickyStorage.CHANGE] || changes[GPTStickyStorage.SETTINGS])) return;
  update(Boolean(changes[GPTStickyStorage.SETTINGS])).then(warning => { if (warning) notice(warning, true); })
    .catch(error => notice(GPTStickyStorage.failure(error).error, true));
});
void act(async () => "");
