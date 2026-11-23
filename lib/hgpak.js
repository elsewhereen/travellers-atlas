"use strict";
/*
 * HGPak: reads files out of the game's own .pak archives (GAMEDATA/PCBANKS/*.pak, the HGPAK format), in the browser
 * and in Node. Exposes window.HGPak.open(source). Needs vendor/fzstd.js (window.fzstd) for compressed paks.
 *
 * The format, as hgpaktool (MIT) reads it:
 *   0x00  "HGPAK", 3 bytes padding
 *   0x08  u64 version (2), u64 file count, u64 chunk count, bool compressed + 7 padding, u64 data offset
 *   0x30  file index: per file a 16-byte name hash, u64 start (absolute, in decompressed bytes), u64 size
 *         then, if compressed, chunk index: u64 compressed size per chunk
 * Compressed data is a run of chunks of 64 KiB each once decompressed (zstd on PC), each one padded to 16 bytes
 * in the file. A chunk stored at exactly 64 KiB is raw. File 0 is the manifest: the paths of files 1… joined by CRLF.
 * Offsets in the index count from the data offset in the decompressed stream.
 *
 * source: a Blob/File, or { size, read(offset, length) → Promise<Uint8Array> } (Node).
 * Reads only the bytes it needs, so a 600 MB pak never has to fit in memory.
 */
(function (root) {

  const CHUNK = 0x10000;

  function reader(source) {
    if (typeof source.read === "function") return source;
    return {
      size: source.size,
      read: async (off, len) => new Uint8Array(await source.slice(off, off + len).arrayBuffer()),
    };
  }

  // u64 as a Number: every offset in a pak is far below 2^53.
  const u64 = (dv, o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 0x100000000;

  async function open(source) {
    const src = reader(source);
    let head = await src.read(0, 0x30);
    if (String.fromCharCode(...head.subarray(0, 5)) !== "HGPAK") throw new Error("Not an HGPAK file");
    let dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const version = u64(dv, 8), fileCount = u64(dv, 16), chunkCount = u64(dv, 24);
    const compressed = head[32] !== 0, dataOffset = u64(dv, 40);
    if (version !== 2) throw new Error(`Unknown HGPAK version ${version}`);

    const indexLen = fileCount * 32 + (compressed ? chunkCount * 8 : 0);
    const index = await src.read(0x30, indexLen);
    dv = new DataView(index.buffer, index.byteOffset, index.byteLength);
    const starts = new Float64Array(fileCount), sizes = new Float64Array(fileCount);
    for (let i = 0; i < fileCount; i++) {
      starts[i] = u64(dv, i * 32 + 16) - (compressed ? dataOffset : 0);
      sizes[i] = u64(dv, i * 32 + 24);
    }
    let chunkOffsets = null, chunkSizes = null;
    if (compressed) {
      if (!root.fzstd) throw new Error("fzstd is not loaded");
      chunkOffsets = new Float64Array(chunkCount);
      chunkSizes = new Float64Array(chunkCount);
      let pos = dataOffset;
      for (let i = 0; i < chunkCount; i++) {
        const s = u64(dv, fileCount * 32 + i * 8);
        chunkOffsets[i] = pos;
        chunkSizes[i] = s;
        pos += Math.ceil(s / 16) * 16;
      }
    }

    // A few recent chunks, since neighbouring files (and a file's header and its mips) share chunks.
    const cache = new Map();
    async function chunk(i) {
      let c = cache.get(i);
      if (c) { cache.delete(i); cache.set(i, c); return c; }
      const raw = await src.read(chunkOffsets[i], chunkSizes[i]);
      const zstd = raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd;
      if (zstd) c = root.fzstd.decompress(raw);
      else if (raw.length === CHUNK) c = raw;
      else throw new Error(`Chunk ${i} is neither zstd nor raw (other platforms use lz4 or Oodle)`);
      cache.set(i, c);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return c;
    }

    // Bytes [off, off + len) of the decompressed stream.
    async function stream(off, len) {
      if (!compressed) return src.read(off, len);
      const out = new Uint8Array(len);
      let done = 0;
      while (done < len) {
        const p = off + done, ci = Math.floor(p / CHUNK), at = p - ci * CHUNK;
        const c = await chunk(ci);
        const n = Math.min(c.length - at, len - done);
        if (n <= 0) throw new Error(`Chunk ${ci} is short`);
        out.set(c.subarray(at, at + n), done);
        done += n;
      }
      return out;
    }

    const manifest = new TextDecoder().decode(await stream(starts[0], sizes[0]));
    const names = manifest.replace(/[\r\n]+$/, "").split("\r\n");
    if (names.length !== fileCount - 1) throw new Error("The pak's file list doesn't match its index");
    const files = new Map();
    names.forEach((n, i) => n && files.set(n.toLowerCase(), i + 1));

    function entry(path) {
      const i = files.get(path.toLowerCase());
      if (i == null) throw new Error(`Not in this pak: ${path}`);
      return i;
    }

    return {
      compressed, fileCount,
      paths: () => files.keys(),
      has: path => files.has(path.toLowerCase()),
      size: path => sizes[entry(path)],
      // A whole file, or `len` bytes of it from `start`.
      async read(path, start = 0, len) {
        const i = entry(path);
        if (len == null) len = sizes[i] - start;
        if (start < 0 || start + len > sizes[i]) throw new Error(`Read past the end of ${path}`);
        return stream(starts[i] + start, len);
      },
    };
  }

  root.HGPak = { open };
})(typeof window !== "undefined" ? window : globalThis);
