"use strict";
function memoryArea(initial = {}, quota = Infinity) {
  let values = structuredClone(initial);
  return {
    async get(keys) {
      return structuredClone(keys == null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in values).map(key => [key, values[key]])));
    },
    async set(changes) {
      const next = { ...values, ...structuredClone(changes) };
      const size = Object.entries(next).reduce((sum, [key, value]) => sum + key.length + Buffer.byteLength(JSON.stringify(value)), 0);
      if (size > quota) throw new Error("QUOTA_BYTES quota exceeded");
      values = next;
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }
  };
}
module.exports = { memoryArea };
