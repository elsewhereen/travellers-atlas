"use strict";
/*
 * DDS: reads the game's .dds textures into RGBA pixels, in the browser and in Node. Exposes window.DDS.
 * Handles what the UI textures use: BC7 (most icons), BC1/DXT1, BC3/DXT5 and plain 8-bit RGBA/BGRA.
 * The BC7 decoder is a port of bcdec by Sergii Kudlai (MIT or Unlicense, https://github.com/iOrange/bcdec).
 *
 *   const info = DDS.info(firstBytes)        // the first 148 bytes are enough
 *   const m = DDS.mip(info, level)           // { offset, length, width, height } of one mip level in the file
 *   const rgba = DDS.decode(info, bytes, m.width, m.height)   // Uint8ClampedArray, width × height × 4
 */
(function (root) {

  const FMT = {   // DXGI format → [name, bytes per 4×4 block (0: uncompressed), bytes per pixel]
    98: ["bc7", 16], 99: ["bc7", 16], 71: ["bc1", 8], 72: ["bc1", 8], 77: ["bc3", 16], 78: ["bc3", 16],
    28: ["rgba", 0, 4], 29: ["rgba", 0, 4], 87: ["bgra", 0, 4], 91: ["bgra", 0, 4],
  };

  function info(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(0, true) !== 0x20534444) throw new Error("Not a DDS file");
    const height = dv.getUint32(12, true), width = dv.getUint32(16, true);
    const mips = Math.max(1, dv.getUint32(28, true));
    const pfFlags = dv.getUint32(80, true);
    const fourcc = String.fromCharCode(b[84], b[85], b[86], b[87]);
    let dataOffset = 128, f;
    if (pfFlags & 4) {   // DDPF_FOURCC
      if (fourcc === "DX10") { f = FMT[dv.getUint32(128, true)]; dataOffset = 148; }
      else f = { DXT1: FMT[71], DXT5: FMT[77] }[fourcc];
    } else if (dv.getUint32(88, true) === 32) {   // 32-bit RGB(A): red mask tells the byte order
      f = dv.getUint32(92, true) === 0xff ? FMT[28] : FMT[87];
    }
    if (!f) throw new Error(`Unsupported DDS format (${fourcc}${fourcc === "DX10" ? " " + dv.getUint32(128, true) : ""})`);
    return { width, height, mips, format: f[0], blockBytes: f[1], pixelBytes: f[2] || 0, dataOffset };
  }

  function levelBytes(i, w, h) {
    return i.blockBytes ? Math.ceil(w / 4) * Math.ceil(h / 4) * i.blockBytes : w * h * i.pixelBytes;
  }

  function mip(i, level) {
    level = Math.min(level, i.mips - 1);
    let off = i.dataOffset, w = i.width, h = i.height;
    for (let l = 0; l < level; l++) {
      off += levelBytes(i, w, h);
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    return { level, offset: off, length: levelBytes(i, w, h), width: w, height: h };
  }

  // The smallest mip level that is still at least `px` wide (or the largest, if none is).
  function mipFor(i, px) {
    let l = 0;
    while (l + 1 < i.mips && Math.max(1, i.width >> (l + 1)) >= px) l++;
    return mip(i, l);
  }

  // ---- BC1 / BC3 ----

  function rgb565(v, out, o) {
    const r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31;
    out[o] = (r << 3) | (r >> 2); out[o + 1] = (g << 2) | (g >> 4); out[o + 2] = (b << 3) | (b >> 2);
  }

  const pal = new Uint8Array(16);
  function colorBlock(s, p, px, opaque) {   // px: 16 × RGBA
    const c0 = s[p] | (s[p + 1] << 8), c1 = s[p + 2] | (s[p + 3] << 8);
    rgb565(c0, pal, 0); rgb565(c1, pal, 4);
    pal[3] = pal[7] = 255;
    if (c0 > c1 || opaque) {
      for (let k = 0; k < 3; k++) {
        pal[8 + k] = (2 * pal[k] + pal[4 + k] + 1) / 3 | 0;
        pal[12 + k] = (pal[k] + 2 * pal[4 + k] + 1) / 3 | 0;
      }
      pal[11] = pal[15] = 255;
    } else {
      for (let k = 0; k < 3; k++) { pal[8 + k] = (pal[k] + pal[4 + k] + 1) >> 1; pal[12 + k] = 0; }
      pal[11] = 255; pal[15] = 0;
    }
    const bits = s[p + 4] | (s[p + 5] << 8) | (s[p + 6] << 16) | (s[p + 7] << 24);
    for (let t = 0; t < 16; t++) {
      const c = ((bits >>> (2 * t)) & 3) * 4;
      px[t * 4] = pal[c]; px[t * 4 + 1] = pal[c + 1]; px[t * 4 + 2] = pal[c + 2]; px[t * 4 + 3] = pal[c + 3];
    }
  }

  function alphaBlock(s, p, px) {   // BC3's smooth alpha into px[t*4+3]
    const a = [s[p], s[p + 1]];
    if (a[0] > a[1]) for (let k = 1; k < 7; k++) a.push(((7 - k) * a[0] + k * a[1] + 3) / 7 | 0);
    else { for (let k = 1; k < 5; k++) a.push(((5 - k) * a[0] + k * a[1] + 2) / 5 | 0); a.push(0, 255); }
    let lo = s[p + 2] | (s[p + 3] << 8) | (s[p + 4] << 16), hi = s[p + 5] | (s[p + 6] << 8) | (s[p + 7] << 16);
    for (let t = 0; t < 16; t++) {
      const v = t < 8 ? (lo >> (3 * t)) & 7 : (hi >> (3 * (t - 8))) & 7;
      px[t * 4 + 3] = a[v];
    }
  }

  // ---- BC7 (bcdec's bcdec_bc7) ----

  // Partition tables from bcdec, 16 texels each (texel 0 first): the subset 0–2, or 8 + subset for a fix-up texel.
  const P2 = [
    "8011001100110019", "8001000100010009", "8111011101110119", "8001001100110119", "8000000100010019",
    "8011011101111119", "8001001101111119", "8000000100110119", "8000000000010019", "8011011111111119",
    "8000000101111119", "8000000000010119", "8001011111111119", "8000000011111119", "8000111111111119",
    "8000000000001119", "8000100011101119", "8191000100000000", "8000000090001110", "8191001100010000",
    "8091000100000000", "8000100091001110", "8000000090001100", "8111001100110009", "8091000100010000",
    "8000100090001100", "8190011001100110", "8091011001101100", "8001011191101000", "8000111191110000",
    "8191000110001110", "8091100110011100", "8101010101010109", "8000111100001119", "8101109001011010",
    "8011001191001100", "8091110000111100", "8101010190101010", "8110100101101009", "8101101010100109",
    "8191001111001110", "8001001191001000", "8091001001001100", "8091101111011100", "8190100110010110",
    "8011110011000019", "8110011010011009", "8000019001100000", "8100119001000000", "8090011100100000",
    "8000009001110010", "8000010091100100", "8110110010010019", "8011011011001009", "8190001110011100",
    "8091100111000110", "8110110011001009", "8110001100111009", "8111111010000009", "8001100011100119",
    "8000111100110019", "8091001111110000", "8090001011101110", "8100010001110119",
  ];
  const P3 = [
    "801900110221222a", "80090011a2112221", "80002001a2112219", "822a002200110119", "800000009122112a",
    "801900110022002a", "802a002211111119", "80110011a2112219", "800000009111222a", "800011119111222a",
    "800011912222222a", "801200920012001a", "811201920112011a", "812209220122012a", "801901121122122a",
    "80192001a2002220", "800900110112112a", "81190011a0012200", "800011229122112a", "802a002200221119",
    "811901110222022a", "80090001a2212221", "800000910122012a", "80001100a2902210", "812a092200110000",
    "801200129122222a", "811012a192210110", "8000019012a11221", "802211029102002a", "811009102002222a",
    "8011012201a20019", "80002000a2112229", "800000029122122a", "822a002200120019", "801900120022022a",
    "8120092001a00120", "8000119122a20000", "81201201a0920120", "812020129a010120", "8011220011a20019",
    "801111a222000019", "810901012222222a", "80000000a1212129", "802219220022112a", "802a001100220019",
    "822012a102201229", "810122a222220109", "80002121a1212129", "810901010101222a", "822a011102220119",
    "800219120002111a", "800029122112211a", "822209110111022a", "800211129112000a", "811009100110222a",
    "800000002192211a", "811009102222222a", "802200110091002a", "802211229122002a", "800000000000291a",
    "800a000100020009", "822212220222922a", "810922222222222a", "81192011a2012220",
  ];

  function decodeRow(s) {
    const out = new Uint8Array(16);
    for (let t = 0; t < 16; t++) { const v = parseInt(s[t], 16); out[t] = v >= 8 ? 0x80 | (v - 8) : v; }
    return out;
  }

  let PART2 = null, PART3 = null;
  function tables() {
    if (!PART2) { PART2 = P2.map(decodeRow); PART3 = P3.map(decodeRow); }
  }

  const W2 = [0, 21, 43, 64], W3 = [0, 9, 18, 27, 37, 46, 55, 64];
  const W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
  const COLOR_BITS = [4, 6, 5, 7, 5, 7, 7, 5], ALPHA_BITS = [0, 0, 0, 0, 6, 8, 7, 5];
  const HAS_PBITS = 0b11001011;

  const ep = Array.from({ length: 6 }, () => new Int32Array(4));
  const idx = new Uint8Array(16);

  function bc7Block(s, p, px) {
    tables();
    let bit = 0;
    const read = n => {
      let v = 0;
      for (let k = 0; k < n; k++, bit++) v |= ((s[p + (bit >> 3)] >> (bit & 7)) & 1) << k;
      return v;
    };
    let mode = 0;
    while (mode < 8 && read(1) === 0) mode++;
    if (mode >= 8) { px.fill(0); return; }

    let partition = 0, nParts = 1, rotation = 0, isb = 0;
    if (mode === 0 || mode === 1 || mode === 2 || mode === 3 || mode === 7) {
      nParts = mode === 0 || mode === 2 ? 3 : 2;
      partition = read(mode === 0 ? 4 : 6);
    }
    const nEp = nParts * 2;
    if (mode === 4 || mode === 5) {
      rotation = read(2);
      if (mode === 4) isb = read(1);
    }
    for (let c = 0; c < 3; c++) for (let e = 0; e < nEp; e++) ep[e][c] = read(COLOR_BITS[mode]);
    if (ALPHA_BITS[mode]) for (let e = 0; e < nEp; e++) ep[e][3] = read(ALPHA_BITS[mode]);
    else for (let e = 0; e < nEp; e++) ep[e][3] = 0;

    const hasP = (HAS_PBITS >> mode) & 1;
    if (hasP) {
      for (let e = 0; e < nEp; e++) for (let c = 0; c < 4; c++) ep[e][c] <<= 1;
      if (mode === 1) {
        const a = read(1), b = read(1);
        for (let c = 0; c < 3; c++) { ep[0][c] |= a; ep[1][c] |= a; ep[2][c] |= b; ep[3][c] |= b; }
      } else {
        for (let e = 0; e < nEp; e++) { const v = read(1); for (let c = 0; c < 4; c++) ep[e][c] |= v; }
      }
    }
    for (let e = 0; e < nEp; e++) {
      let n = COLOR_BITS[mode] + hasP;
      for (let c = 0; c < 3; c++) { const v = ep[e][c] << (8 - n); ep[e][c] = (v | (v >> n)) & 0xff; }
      n = ALPHA_BITS[mode] + hasP;
      if (ALPHA_BITS[mode]) { const v = ep[e][3] << (8 - n); ep[e][3] = (v | (v >> n)) & 0xff; }
      else ep[e][3] = 255;
    }

    const ib = mode === 0 || mode === 1 ? 3 : mode === 6 ? 4 : 2;
    const ib2 = mode === 4 ? 3 : mode === 5 ? 2 : 0;
    const w = ib === 2 ? W2 : ib === 3 ? W3 : W4, w2 = ib2 === 2 ? W2 : W3;
    const part = nParts === 1 ? null : (nParts === 2 ? PART2 : PART3)[partition];
    const set = t => part ? part[t] : (t ? 0 : 0x80);

    for (let t = 0; t < 16; t++) idx[t] = read(set(t) & 0x80 ? ib - 1 : ib);
    const lerp = (a, b, ws, i) => (((64 - ws[i]) * a + ws[i] * b + 32) >> 6);
    for (let t = 0; t < 16; t++) {
      const sub = set(t) & 3, e0 = ep[sub * 2], e1 = ep[sub * 2 + 1], i = idx[t];
      let r, g, b, a;
      if (!ib2) {
        r = lerp(e0[0], e1[0], w, i); g = lerp(e0[1], e1[1], w, i); b = lerp(e0[2], e1[2], w, i); a = lerp(e0[3], e1[3], w, i);
      } else {
        const i2 = read(t ? ib2 : ib2 - 1);
        if (!isb) {
          r = lerp(e0[0], e1[0], w, i); g = lerp(e0[1], e1[1], w, i); b = lerp(e0[2], e1[2], w, i); a = lerp(e0[3], e1[3], w2, i2);
        } else {
          r = lerp(e0[0], e1[0], w2, i2); g = lerp(e0[1], e1[1], w2, i2); b = lerp(e0[2], e1[2], w2, i2); a = lerp(e0[3], e1[3], w, i);
        }
      }
      if (rotation === 1) [a, r] = [r, a];
      else if (rotation === 2) [a, g] = [g, a];
      else if (rotation === 3) [a, b] = [b, a];
      px[t * 4] = r; px[t * 4 + 1] = g; px[t * 4 + 2] = b; px[t * 4 + 3] = a;
    }
  }

  // ---- whole images ----

  function decode(i, s, width, height) {
    const out = new Uint8ClampedArray(width * height * 4);
    if (!i.blockBytes) {
      out.set(s.subarray(0, out.length));
      if (i.format === "bgra") for (let k = 0; k < out.length; k += 4) { const t = out[k]; out[k] = out[k + 2]; out[k + 2] = t; }
      return out;
    }
    const px = new Uint8Array(64), bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
    let p = 0;
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, p += i.blockBytes) {
      if (i.format === "bc7") bc7Block(s, p, px);
      else if (i.format === "bc1") colorBlock(s, p, px, false);
      else { colorBlock(s, p + 8, px, true); alphaBlock(s, p, px); }
      for (let y = 0; y < 4; y++) {
        const yy = by * 4 + y;
        if (yy >= height) break;
        for (let x = 0; x < 4; x++) {
          const xx = bx * 4 + x;
          if (xx >= width) break;
          const o = (yy * width + xx) * 4, q = (y * 4 + x) * 4;
          out[o] = px[q]; out[o + 1] = px[q + 1]; out[o + 2] = px[q + 2]; out[o + 3] = px[q + 3];
        }
      }
    }
    return out;
  }

  root.DDS = { info, mip, mipFor, decode };
})(typeof window !== "undefined" ? window : globalThis);
