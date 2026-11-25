(function (root) {
  "use strict";
  const INDEX = "index.json";
  const FORMAT = "gpt-answer-shelf-folder";
  const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  const recordFile = /^note-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/;
  const harmless = error => error.name === "NotFoundError";

  let database;
  function openHandles() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = root.indexedDB.open("GPTAnswerShelfFolders", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { database = undefined; throw error; });
    return database;
  }
  async function withHandles(mode, action) {
    const db = await openHandles();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("handles", mode);
      transaction.onabort = () => reject(transaction.error || new Error("文件夹设置保存失败。"));
      const request = action(transaction.objectStore("handles"));
      transaction.oncomplete = () => resolve(request.result);
    });
  }
  const getHandle = id => withHandles("readonly", store => store.get(id));
  const saveHandle = (id, handle) => withHandles("readwrite", store => store.put(handle, id));
  const removeHandle = id => withHandles("readwrite", store => store.delete(id));

  async function write(handle, contents) {
    const stream = await handle.createWritable();
    try {
      await stream.write(contents);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }
  async function open(handle, libraryId, { create = false, writable = false } = {}) {
    if (!handle || await handle.queryPermission({ mode: writable ? "readwrite" : "read" }) !== "granted") {
      throw new DOMException("文件夹授权需要更新。", "NotAllowedError");
    }
    if (!UUID.test(libraryId)) throw new Error("收纳文件夹的设置无效。");
    // Each browser installation gets its own subfolder in the selected location.
    const directory = await handle.getDirectoryHandle(`GPT Answer Shelf ${libraryId}`, { create });
    async function index() {
      let file;
      try { file = await (await directory.getFileHandle(INDEX)).getFile(); }
      catch (error) { if (create && harmless(error)) return {}; throw error; }
      if (create && file.size === 0) return {};
      let data;
      try { data = JSON.parse(await file.text()); } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (data?.format !== FORMAT || data.version !== 1 || !data.records || Array.isArray(data.records)
          || typeof data.records !== "object" || Object.entries(data.records).some(([key, record]) =>
            !key.startsWith(root.GPTStickyStorage.PREFIX) || !recordFile.test(record?.file) || !Number.isSafeInteger(record.bytes) || record.bytes < 1)) {
        throw new Error("这个文件夹中的收纳索引无法读取。");
      }
      return data.records;
    }
    async function saveIndex(records) {
      const handle = await directory.getFileHandle(INDEX, { create: true });
      await write(handle, JSON.stringify({ format: FORMAT, version: 1, records }));
    }
    async function get(names, catalog) {
      const result = {};
      for (const name of names) {
        const record = catalog[name];
        const file = await (await directory.getFileHandle(record.file)).getFile();
        const note = JSON.parse(await file.text());
        if (file.size !== record.bytes || !root.GPTStickyStorage.isRecord(name, note)) throw new Error("收纳文件与索引不一致。");
        result[name] = note;
      }
      return result;
    }
    async function removeFiles(files) {
      let failure;
      for (const file of files) {
        try { await directory.removeEntry(file); }
        catch (error) { if (!harmless(error)) failure ||= error; }
      }
      if (failure) throw failure;
    }
    async function clearUnindexed(catalog) {
      const referenced = new Set(Object.values(catalog).map(record => record.file));
      const obsolete = [];
      for await (const name of directory.keys()) if (recordFile.test(name) && !referenced.has(name)) obsolete.push(name);
      await removeFiles(obsolete);
    }
    async function persist(before, records, after) {
      const staged = [];
      try {
        for await (const item of records) {
          const name = `note-${root.crypto.randomUUID()}.json`;
          staged.push(name);
          const file = await directory.getFileHandle(name, { create: true });
          await write(file, item.json);
          if ((await file.getFile()).size !== item.bytes) throw new Error("写入的收纳记录不完整。");
          after[item.name] = { file: name, bytes: item.bytes };
        }
        // The old index and its files remain readable until this write closes.
        await saveIndex(after);
      } catch (error) {
        await removeFiles(staged).catch(() => {});
        throw error;
      }
      const obsolete = Object.entries(before).filter(([name, record]) => after[name]?.file !== record.file);
      await removeFiles(obsolete.map(([, record]) => record.file)).catch(() => {});
    }
    return {
      index, get,
      commit: (before, records) => persist(before, records, { ...before }),
      async replace(before, records) {
        await clearUnindexed(before);
        await persist(before, records, {});
      },
      async clear() {
        await saveIndex({});
        await clearUnindexed({});
      }
    };
  }

  const api = { open, getHandle, saveHandle, removeHandle };
  root.GPTAnswerShelfFolders = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
