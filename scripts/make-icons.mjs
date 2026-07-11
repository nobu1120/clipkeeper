// Generates simple solid-color placeholder PNG icons (no external deps).
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Draws a filled circle in `bgColor` with a white "C" ring mark on top (a
// ring with a wedge cut out on the right, standing in for ClipKeep's
// initial). Still a generated placeholder, not a designed logo, but more
// distinctive than a plain solid dot.
function makePng(size, bgColor, markColor) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const cx = size / 2;
  const cy = size / 2;
  const bgRadius = size * 0.46;
  const ringOuter = size * 0.32;
  const ringInner = size * 0.2;
  const openHalfAngleDeg = 40;

  const rowLen = size * 4;
  const raw = Buffer.alloc((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowLen + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      const insideBg = distSq <= bgRadius * bgRadius;
      const insideRing = dist <= ringOuter && dist >= ringInner;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const isOpening = Math.abs(angleDeg) <= openHalfAngleDeg;
      const insideMark = insideRing && !isOpening;

      const [r, g, b, a] = insideMark ? markColor : bgColor;
      const visible = insideMark || insideBg;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = visible ? a : 0;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true });
const bgColor = [37, 99, 235, 255]; // brand blue circle
const markColor = [255, 255, 255, 255]; // white "C" ring mark
for (const size of [16, 48, 128]) {
  const png = makePng(size, bgColor, markColor);
  writeFileSync(new URL(`../public/icons/icon${size}.png`, import.meta.url), png);
}
console.log("Icons generated.");
