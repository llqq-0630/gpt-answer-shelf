(function (root) {
  "use strict";
  const PREFIX = "gpt-sticky:note:";
  const revision = note => Number.isSafeInteger(note?.revision) && note.revision >= 0 ? note.revision : 0;
  function key(note) {
    if (note?.schema !== 1 || !/^\w[\w:-]{0,160}$/.test(note.id || "") || !/^(c|share):[\w-]{1,160}$/.test(note.conversation || "")) throw new Error("收纳记录格式不正确。");
    return `${PREFIX}${note.conversation}:${note.id}`;
  }
  function tombstone(note) {
    // Keep only the deletion/version fence. The content lives in the undo closure,
    // never in persistent trash, so deleting a large note immediately frees space.
    return { schema: 1, id: note.id, conversation: note.conversation, createdAt: note.createdAt,
      updatedAt: note.updatedAt, revision: revision(note), deletedAt: note.deletedAt, exchanges: [], pending: null };
  }
  function failure(error) {
    const quota = /quota|QUOTA_BYTES|exceed.*(?:bytes|storage)/i.test(error.message || "");
    return { ok: false, code: error.code || (quota ? "quota" : "storage"),
      error: quota ? "收纳空间不足。可以先导出备份，再放回不需要收纳的回答。" : error.message || "收纳记录保存失败。",
      ...(error.current ? { current: error.current } : {}) };
  }
  function create({ area, now = Date.now }) {
    // All tabs use this one worker queue. A version check and its write must not
    // be interleaved with another tab's check/write or a backup import.
    let queue = Promise.resolve();
    function request(message) {
      const operation = queue.then(async () => {
        if (message.operation === "save" || message.operation === "restore") {
          const incoming = message.note, name = key(incoming);
          const current = (await area.get(name))[name];
          if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0) throw new Error("缺少记录版本，请刷新页面后重试。");
          if (revision(current) !== message.expectedRevision || current?.deletedAt && !incoming.deletedAt && message.operation !== "restore") {
            const error = new Error("这条收纳记录已更新，请重新打开侧栏后重试。");
            error.code = "conflict"; error.current = current; throw error;
          }
          const value = structuredClone(incoming);
          value.revision = revision(current) + 1;
          value.updatedAt = Math.max(now(), Number.isFinite(current?.updatedAt) ? current.updatedAt + 1 : 0);
          const saved = value.deletedAt ? tombstone(value) : value;
          await area.set({ [name]: saved });
          return { ok: true, note: saved };
        }
        if (message.operation === "import") {
          if (!Array.isArray(message.notes)) throw new Error("备份缺少收纳记录。");
          const saved = await area.get(null), changes = {};
          for (const incoming of message.notes) {
            const name = key(incoming), current = changes[name] || saved[name];
            if (current && incoming.updatedAt <= current.updatedAt) continue;
            const value = structuredClone(incoming);
            value.revision = revision(current) + 1;
            changes[name] = value.deletedAt ? tombstone(value) : value;
          }
          if (Object.keys(changes).length) await area.set(changes);
          return { ok: true, notes: Object.values(changes) };
        }
        if (message.operation === "compact") {
          const saved = await area.get(null), changes = {};
          for (const [name, note] of Object.entries(saved)) {
            if (!name.startsWith(PREFIX) || note?.schema !== 1 || !note.deletedAt) continue;
            const compact = tombstone(note);
            if (JSON.stringify(compact) === JSON.stringify(note)) continue;
            key(note);
            compact.revision = revision(note) + 1;
            changes[name] = compact;
          }
          if (Object.keys(changes).length) await area.set(changes);
          return { ok: true, notes: Object.values(changes) };
        }
        throw new Error("不支持的收纳存储操作。");
      });
      queue = operation.catch(() => {});
      return operation;
    }
    return { request, handle: message => request(message).catch(failure) };
  }
  const api = { PREFIX, revision, key, create, failure };
  root.GPTStickyStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
