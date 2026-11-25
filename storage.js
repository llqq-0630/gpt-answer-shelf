(function (root) {
  "use strict";
  const PREFIX = "gpt-sticky:note:";
  const SETTINGS = "gpt-answer-shelf:storage-settings";
  const CHANGE = "gpt-answer-shelf:storage-change";
  const CATALOG = "gpt-answer-shelf:catalog";
  const MIB = 1024 ** 2;
  const DEFAULT_LIMIT = 1024 * MIB;
  const READ_BATCH = 12 * MIB;
  const LOCK = "gpt-answer-shelf:storage";
  const revision = note => Number.isSafeInteger(note?.revision) && note.revision >= 0 ? note.revision : 0;
  function key(note) {
    if (note?.schema !== 1 || !/^\w[\w:-]{0,160}$/.test(note.id || "") || !/^(c|share):[\w-]{1,160}$/.test(note.conversation || "")) throw new Error("收纳记录格式不正确。");
    return `${PREFIX}${note.conversation}:${note.id}`;
  }
  function isRecord(name, note) {
    try { return key(note) === name; } catch { return false; }
  }
  function summarize(note) {
    if (!Array.isArray(note?.exchanges) || !note.exchanges.some(entry => entry?.answerDocument)) return note;
    return { ...note, exchanges: note.exchanges.map(entry => {
      if (!entry?.answerDocument) return entry;
      const { answerDocument, ...rest } = entry;
      return { ...rest, hasStoredDocument: true };
    }) };
  }
  function prepare(name, note) {
    const json = JSON.stringify(note);
    return { name, note, json, bytes: new TextEncoder().encode(json).byteLength };
  }
  const usedBytes = index => Object.values(index).reduce((sum, record) => sum + record.bytes, 0);
  const validLimit = bytes => Number.isSafeInteger(bytes) && bytes >= MIB && bytes % MIB === 0;
  function issue(code, message) { return Object.assign(new Error(message), { code }); }
  function* batches(names, catalog) {
    let batch = [], bytes = 0;
    for (const name of names) {
      const size = catalog[name].bytes;
      if (batch.length && (bytes + size > READ_BATCH || batch.length >= 256)) { yield batch; batch = []; bytes = 0; }
      batch.push(name);
      bytes += size;
    }
    if (batch.length) yield batch;
  }
  function tombstone(note) {
    // Keep only the deletion/version fence. The content lives in the undo closure,
    // never in persistent trash, so deleting a large note immediately frees space.
    return { schema: 1, id: note.id, conversation: note.conversation, createdAt: note.createdAt,
      updatedAt: note.updatedAt, revision: revision(note), deletedAt: note.deletedAt, exchanges: [], pending: null };
  }
  function failure(error) {
    if (error.code === "limit") return { ok: false, code: "quota", error: error.message };
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return { ok: false, code: "folder-permission", error: "请在存储设置中重新授权数据文件夹。" };
    }
    if (error.name === "NotFoundError") {
      return { ok: false, code: "folder-missing", error: "数据文件夹或记录已移走，请在存储设置中检查位置。" };
    }
    const quota = /quota|QUOTA_BYTES|exceed.*(?:bytes|storage)/i.test(error.message || "");
    return { ok: false, code: error.code || (quota ? "quota" : "storage"),
      error: quota ? "收纳空间不足。可以先导出备份，再放回不需要收纳的回答。" : error.message || "收纳记录保存失败。",
      ...(error.current ? { current: error.current } : {}) };
  }
  function browserStorage(area) {
    async function index() {
      const cached = (await area.get(CATALOG))[CATALOG];
      if (cached) return cached;
      // Older versions stored only notes. Build the index once on upgrade.
      const legacy = await area.get(null), catalog = {};
      for (const [name, note] of Object.entries(legacy)) {
        if (name.startsWith(PREFIX) && isRecord(name, note)) catalog[name] = { bytes: prepare(name, note).bytes };
      }
      if (Object.keys(catalog).length) await area.set({ [CATALOG]: catalog });
      return catalog;
    }
    async function remove(names, catalog) {
      for (const batch of batches(names, catalog)) await area.remove(batch);
    }
    return {
      index,
      async get(names) {
        if (!names.length) return {};
        const notes = await area.get(names);
        if (names.some(name => !isRecord(name, notes[name]))) throw new Error("有一条收纳记录无法读取。");
        return notes;
      },
      async commit(before, records) {
        const after = { ...before }, values = {};
        for (const { name, note, bytes } of records) { after[name] = { bytes }; values[name] = note; }
        await area.set({ ...values, [CATALOG]: after });
      },
      async replace(before, records) {
        // This backend is inactive during migration. Publish its index after the last note.
        const catalog = {};
        for await (const { name, note, bytes } of records) {
          await area.set({ [name]: note });
          catalog[name] = { bytes };
        }
        const stale = Object.keys(before).filter(name => !catalog[name]);
        await remove(stale, before);
        await area.set({ [CATALOG]: catalog });
      },
      async clear(catalog) {
        await remove(Object.keys(catalog), catalog);
        await area.remove(CATALOG);
      }
    };
  }
  function create({ area, folders, now = Date.now, locks = root.navigator?.locks }) {
    const browser = browserStorage(area);
    // The worker and the settings tab share this lock, including the copy and switch.
    let queue = Promise.resolve();
    function serialized(task) {
      if (locks) return locks.request(LOCK, task);
      const operation = queue.then(task);
      queue = operation.catch(() => {});
      return operation;
    }
    async function readSettings() {
      const saved = (await area.get(SETTINGS))[SETTINGS];
      return { limitBytes: validLimit(saved?.limitBytes) ? saved.limitBytes : DEFAULT_LIMIT,
        folder: saved?.folder || null, libraryId: saved?.libraryId || null };
    }
    async function location(settings) {
      if (!settings.folder) return browser;
      if (!folders) throw issue("folder-permission", "请在存储设置中重新授权数据文件夹。");
      return folders.open(await folders.getHandle(settings.folder.id), settings.libraryId);
    }
    const change = (conversations, noteId) => ({ id: root.crypto.randomUUID(), conversations, ...(noteId ? { noteId } : {}) });
    async function commit(storage, index, changes, settings) {
      const records = Object.entries(changes).map(([name, note]) => prepare(name, note));
      if (!records.length) return;
      const before = usedBytes(index);
      const after = before + records.reduce((sum, item) => sum + item.bytes - (index[item.name]?.bytes || 0), 0);
      if (after > settings.limitBytes && after > before) {
        throw issue("limit", "已达到收纳上限。可以在存储设置中调高上限，或先放回部分回答。");
      }
      await storage.commit(index, records);
      // The archive is already committed even if notifying another tab fails.
      const conversations = [...new Set(records.map(record => record.note.conversation))];
      await area.set({ [CHANGE]: change(conversations, records.length === 1 ? records[0].note.id : null) }).catch(() => {});
    }
    async function* copyRecords(storage, index) {
      for (const name of Object.keys(index)) {
        const note = (await storage.get([name], index))[name];
        if (!isRecord(name, note)) throw issue("invalid-record", "有一条收纳记录无法读取，原存储位置仍然可用。");
        yield prepare(name, note);
      }
    }
    async function move(settings, handle) {
      if (!handle && !settings.folder) return { ok: true };
      if (handle && !folders) throw issue("folder-permission", "此浏览器暂不支持选择数据文件夹。");
      const previousHandle = settings.folder && await folders.getHandle(settings.folder.id);
      const libraryId = settings.libraryId || root.crypto.randomUUID();
      if (!settings.libraryId) await area.set({ [SETTINGS]: { ...settings, libraryId } });
      const nextFolder = handle && { id: root.crypto.randomUUID(), name: handle.name };
      const sameFolder = Boolean(handle && previousHandle && await handle.isSameEntry(previousHandle));
      const target = handle ? await folders.open(handle, libraryId, { create: !sameFolder, writable: true }) : browser;
      if (sameFolder) await target.index();
      else {
        const source = await location(settings), sourceIndex = await source.index();
        await target.replace(await target.index(), copyRecords(source, sourceIndex));
        const copied = await target.index();
        const names = Object.keys(sourceIndex);
        if (names.length !== Object.keys(copied).length || names.some(name => sourceIndex[name].bytes !== copied[name]?.bytes)) {
          throw issue("migration", "迁移后的记录校验失败，仍在使用原存储位置。");
        }
        return finishMove(settings, nextFolder, handle, libraryId, () => source.clear(sourceIndex));
      }
      return finishMove(settings, nextFolder, handle, libraryId);
    }
    async function finishMove(settings, folder, handle, libraryId, clearSource) {
      if (folder) await folders.saveHandle(folder.id, handle);
      try {
        await area.set({ [SETTINGS]: { ...settings, folder, libraryId }, [CHANGE]: change(null) });
      } catch (error) {
        if (folder) await folders.removeHandle(folder.id).catch(() => {});
        throw error;
      }
      let cleanupWarning = false;
      if (clearSource) {
        try { await clearSource(); } catch { cleanupWarning = true; }
      }
      if (settings.folder) await folders.removeHandle(settings.folder.id).catch(() => {});
      return { ok: true, cleanupWarning };
    }
    function request(message) {
      return serialized(async () => {
        const settings = await readSettings();
        if (message.operation === "settings") {
          try { return { ok: true, settings, usedBytes: usedBytes(await (await location(settings)).index()) }; }
          catch (error) { return { ok: true, settings, usedBytes: null, warning: failure(error).error }; }
        }
        if (message.operation === "limit") {
          if (!validLimit(message.bytes)) throw new Error("请输入大于零的整数 MB。");
          await area.set({ [SETTINGS]: { ...settings, limitBytes: message.bytes } });
          return { ok: true };
        }
        if (message.operation === "location") return move(settings, message.folder || null);

        const storage = await location(settings), index = await storage.index();
        if (message.operation === "list") {
          const scope = key({ schema: 1, id: "x", conversation: message.conversation }).slice(0, -1);
          const matches = Object.keys(index).filter(name => name.startsWith(scope) && name > (message.after || "")).sort();
          const batch = batches(matches, index).next().value || [];
          const saved = await storage.get(batch, index);
          return { ok: true, notes: batch.map(name => summarize(saved[name])).filter(Boolean), next: batch.length < matches.length ? batch.at(-1) : null };
        }
        if (message.operation === "read") {
          const name = key({ schema: 1, id: message.id, conversation: message.conversation });
          const note = (await storage.get(index[name] ? [name] : [], index))[name] || null;
          return { ok: true, note: message.summary ? summarize(note) : note };
        }
        if (message.operation === "save" || message.operation === "restore") {
          const incoming = message.note, name = key(incoming);
          const current = (await storage.get(index[name] ? [name] : [], index))[name];
          if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0) throw new Error("缺少记录版本，请刷新页面后重试。");
          if (revision(current) !== message.expectedRevision || current?.deletedAt && !incoming.deletedAt && message.operation !== "restore") {
            const error = new Error("这条收纳记录已更新，请重新打开侧栏后重试。");
            error.code = "conflict"; error.current = current; throw error;
          }
          const value = structuredClone(incoming);
          value.revision = revision(current) + 1;
          value.updatedAt = Math.max(now(), Number.isFinite(current?.updatedAt) ? current.updatedAt + 1 : 0);
          const saved = value.deletedAt ? tombstone(value) : value;
          await commit(storage, index, { [name]: saved }, settings);
          return { ok: true, note: saved };
        }
        if (message.operation === "import") {
          if (!Array.isArray(message.notes)) throw new Error("备份缺少收纳记录。");
          const changes = {};
          for (const incoming of message.notes) {
            const name = key(incoming);
            const current = changes[name] || (index[name] && (await storage.get([name], index))[name]);
            if (current && incoming.updatedAt <= current.updatedAt) continue;
            const value = structuredClone(incoming);
            value.revision = revision(current) + 1;
            changes[name] = value.deletedAt ? tombstone(value) : value;
          }
          await commit(storage, index, changes, settings);
          return { ok: true, notes: Object.values(changes).map(summarize) };
        }
        if (message.operation === "compact") {
          const changes = {};
          for await (const { name, note } of copyRecords(storage, index)) {
            if (!note.deletedAt) continue;
            const compact = tombstone(note);
            if (JSON.stringify(compact) === JSON.stringify(note)) continue;
            key(note);
            compact.revision = revision(note) + 1;
            changes[name] = compact;
          }
          await commit(storage, index, changes, settings);
          return { ok: true, notes: Object.values(changes) };
        }
        throw new Error("不支持的收纳存储操作。");
      });
    }
    return { request, handle: message => request(message).catch(failure) };
  }
  const api = { PREFIX, CHANGE, SETTINGS, MIB, revision, key, isRecord, summarize, create, failure };
  root.GPTStickyStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
