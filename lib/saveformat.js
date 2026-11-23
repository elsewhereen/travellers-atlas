"use strict";
/*
 * SaveFormat: reading NMS save files in the browser. Exposes window.SaveFormat.
 *
 *  - mf_saveN.hg (manifest, 432 bytes): XXTEA with the game's key, as libNOM.io does. The key depends on the file
 *    number (save.hg = archive 2, save2.hg = 3, … saveN.hg = N+1); 6 rounds since the 2004 manifest format.
 *    Holds the save name (offset 88), the summary shown in the load menu (216, e.g. "On Planet (Rotingt)"),
 *    total play time in seconds (word 19) and a mode/difficulty name (364).
 *  - saveN.hg: chunks of LZ4 blocks (magic 0xFEEDA1E5) around JSON with obfuscated keys. The name ("Pk4") and play
 *    time ("Lg8") are read from it when there is no manifest; the summary only exists in the manifest.
 *
 *   SaveFormat.fileNumber("save11.hg")      -> 11  (save.hg -> 1)
 *   SaveFormat.readManifest(buf, number)    -> { name, summary, playTime, mode, gameVersion } | null
 *   SaveFormat.decompress(buf)              -> string (the save's JSON text)
 *   SaveFormat.readSaveMeta(buf)            -> { name, playTime } from the save itself
 */
(function () {
  const DELTA = 0x9E3779B9;
  const BASE_KEY = new Uint32Array(new Uint8Array([..."NAESEVADNAYRTNRG"].map(c => c.charCodeAt(0))).buffer);
  const MAGIC_MANIFEST = 0xEEEEEEBE, MAGIC_CHUNK = 0xFEEDA1E5;

  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

  function keyFor(archive) {
    const k = Uint32Array.from(BASE_KEY);
    k[0] = (Math.imul(rotl((archive ^ 0x1422CB8C) >>> 0, 13), 5) + 0xE6546B64) >>> 0;
    return k;
  }

  // XXTEA decode (corrected block TEA), in place on a copy.
  function xxteaDecode(words, k, rounds) {
    const v = Uint32Array.from(words), n = v.length;
    const mx = (s, y, z, p, e) =>
      ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((s ^ y) + (k[(p & 3) ^ e] ^ z))) >>> 0;
    let s = Math.imul(rounds, DELTA) >>> 0, y = v[0], z;
    for (let r = 0; r < rounds; r++) {
      const e = (s >>> 2) & 3;
      for (let p = n - 1; p > 0; p--) { z = v[p - 1]; v[p] = (v[p] - mx(s, y, z, p, e)) >>> 0; y = v[p]; }
      z = v[n - 1]; v[0] = (v[0] - mx(s, y, z, 0, e)) >>> 0; y = v[0];
      s = (s - DELTA) >>> 0;
    }
    return v;
  }

  function fileNumber(name) {
    const m = /^(?:mf_)?save(\d*)\.hg$/i.exec(name);
    return m ? (m[1] ? Number(m[1]) : 1) : null;
  }

  function cstr(bytes, start, max) {
    let end = start;
    while (end < start + max && end < bytes.length && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(start, end)).trim();
  }

  function readManifest(buf, number) {
    if (!buf || buf.byteLength < 384 || buf.byteLength % 4) return null;
    const words = new Uint32Array(buf.slice(0));
    // The expected key first; then the others, in case the file was renamed.
    const tries = [];
    if (number != null) tries.push([number + 1, 6], [number + 1, 8]);
    for (let a = 0; a < 40; a++) tries.push([a, 6], [a, 8]);
    for (const [a, r] of tries) {
      const v = xxteaDecode(words, keyFor(a), r);
      if (v[0] !== MAGIC_MANIFEST) continue;
      const bytes = new Uint8Array(v.buffer);
      return {
        name: cstr(bytes, 88, 128),
        summary: cstr(bytes, 216, 128),
        playTime: v[19],
        gameVersion: v[17],
        mode: cstr(bytes, 364, 64),
      };
    }
    return null;
  }

  function lz4Block(src, dst, dpos) {
    let i = 0;
    const n = src.length;
    while (i < n) {
      const tok = src[i++];
      let lit = tok >>> 4;
      if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
      dst.set(src.subarray(i, i + lit), dpos); i += lit; dpos += lit;
      if (i >= n) break;
      const off = src[i] | (src[i + 1] << 8); i += 2;
      let ml = tok & 15;
      if (ml === 15) { let b; do { b = src[i++]; ml += b; } while (b === 255); }
      ml += 4;
      let from = dpos - off;
      if (off >= ml) { dst.copyWithin(dpos, from, from + ml); dpos += ml; }
      else for (let k = 0; k < ml; k++) dst[dpos++] = dst[from++];
    }
    return dpos;
  }

  function decompress(buf) {
    const dv = new DataView(buf), src = new Uint8Array(buf);
    if (dv.getUint32(0, true) !== MAGIC_CHUNK) {
      // Old saves were plain JSON.
      return new TextDecoder().decode(src).replace(/\0+$/, "");
    }
    let total = 0;
    for (let i = 0; i < buf.byteLength;) {
      if (dv.getUint32(i, true) !== MAGIC_CHUNK) throw new Error("Not a No Man's Sky save file");
      total += dv.getUint32(i + 8, true);
      i += 16 + dv.getUint32(i + 4, true);
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (let i = 0; i < buf.byteLength;) {
      const cs = dv.getUint32(i + 4, true);
      pos = lz4Block(src.subarray(i + 16, i + 16 + cs), out, pos);
      i += 16 + cs;
    }
    let end = pos;
    while (end > 0 && out[end - 1] === 0) end--;
    return new TextDecoder().decode(out.subarray(0, end));
  }

  function readSaveMeta(buf) {
    const text = decompress(buf);
    const name = /"Pk4":"((?:[^"\\]|\\.)*)"/.exec(text);
    const time = /"Lg8":(\d+)/.exec(text);
    return {
      name: name ? JSON.parse(`"${name[1]}"`) : "",
      playTime: time ? Number(time[1]) : null,
    };
  }

  window.SaveFormat = { fileNumber, readManifest, decompress, readSaveMeta };
})();
