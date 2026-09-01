export function makeR2() {
  const store = new Map();
  return {
    async put(key, value, options = {}) {
      let bytes;
      if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
      else if (value instanceof Uint8Array) bytes = value;
      else if (typeof value === 'string') bytes = new TextEncoder().encode(value);
      else if (value && typeof value.getReader === 'function') {
        // ReadableStream (as returned by another mock's .body) — drain it.
        const reader = value.getReader();
        const chunks = [];
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(chunk);
        }
        const total = chunks.reduce((n, c) => n + c.length, 0);
        bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
      } else {
        throw new Error('unsupported R2 put() value type in mock');
      }
      store.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
      return { key };
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        httpMetadata: entry.httpMetadata,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(entry.bytes);
            controller.close();
          },
        }),
        arrayBuffer: async () => entry.bytes.buffer,
      };
    },
    async delete(key) {
      store.delete(key);
    },
    _has(key) {
      return store.has(key);
    },
    _keys() {
      return [...store.keys()];
    },
  };
}
