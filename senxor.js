// Wire format comes from MeridianInnovation/pysenxor-lite, senxor/interface/serial_port/parser.py.
export const WIDTH = 80;
export const HEIGHT = 62;
export const STREAM_OFF = writeReg(0xb1, 0x00);
export const STREAM_ON = writeReg(0xb1, 0x02);

const FRAME_BYTES = 10240;
const HEADER_BYTES = 320;
const USB_CLASS_CDC_CONTROL = 2;
const PREFIX = [0x20, 0x20, 0x20, 0x23];

export function writeReg(reg, value) {
  const hex = (n) => n.toString(16).toUpperCase().padStart(2, "0");
  return new TextEncoder().encode(`   #000CWREG${hex(reg)}${hex(value)}XXXX`);
}

function findPrefix(buf, from) {
  for (let i = from; i + 4 <= buf.length; i++) {
    if (PREFIX.every((b, j) => buf[i + j] === b)) return i;
  }
  return -1;
}

const readText = (buf, start, end) => String.fromCharCode(...buf.subarray(start, end));

// Returns complete messages and the bytes to keep for the next chunk. Bad data is skipped.
export function parseMessages(buf) {
  const messages = [];
  let pos = 0;
  for (;;) {
    const start = findPrefix(buf, pos);
    if (start < 0) return { messages, rest: buf.subarray(Math.max(pos, buf.length - 3)) };
    if (buf.length < start + 8) return { messages, rest: buf.subarray(start) };
    const length = parseInt(readText(buf, start + 4, start + 8), 16);
    if (!(length >= 8)) {
      pos = start + 4;
      continue;
    }
    const end = start + 8 + length;
    if (buf.length < end) return { messages, rest: buf.subarray(start) };
    let sum = 0;
    for (let i = start + 4; i < end - 4; i++) sum += buf[i];
    if (parseInt(readText(buf, end - 4, end), 16) !== (sum & 0xffff)) {
      pos = start + 4;
      continue;
    }
    messages.push({ cmd: readText(buf, start + 8, start + 12), data: buf.subarray(start + 12, end - 4) });
    pos = end;
  }
}

// Pixels are little-endian deci-Kelvin, which is the sensor default.
export function decodeFrame(data) {
  if (data.length !== FRAME_BYTES) throw new Error(`Unexpected frame size: ${data.length} bytes`);
  const view = new DataView(data.buffer, data.byteOffset + HEADER_BYTES);
  const temps = new Float32Array(WIDTH * HEIGHT);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < temps.length; i++) {
    const t = view.getUint16(i * 2, true) / 10 - 273.15;
    temps[i] = t;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { temps, min, max };
}

// shortcut: uses the active alternate setting only. Revisit if a camera reports no bulk endpoints.
export function findPipes(configuration) {
  for (const iface of configuration.interfaces) {
    const endpoints = iface.alternate.endpoints.filter((e) => e.type === "bulk");
    const input = endpoints.find((e) => e.direction === "in");
    const output = endpoints.find((e) => e.direction === "out");
    if (input && output) {
      const control = configuration.interfaces.find(
        (i) => i.alternate.interfaceClass === USB_CLASS_CDC_CONTROL,
      );
      return {
        data: iface.interfaceNumber,
        control: control?.interfaceNumber,
        in: input.endpointNumber,
        out: output.endpointNumber,
      };
    }
  }
  throw new Error("No bulk endpoints");
}

// Maps each output pixel to its source pixel for 0 to 3 clockwise quarter turns.
export function rotationMap(turns) {
  const [w, h] = turns % 2 ? [HEIGHT, WIDTH] : [WIDTH, HEIGHT];
  const map = new Uint16Array(WIDTH * HEIGHT);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = [
        [x, y],
        [y, HEIGHT - 1 - x],
        [WIDTH - 1 - x, HEIGHT - 1 - y],
        [WIDTH - 1 - y, x],
      ][turns];
      map[y * w + x] = sy * WIDTH + sx;
    }
  }
  return { map, width: w, height: h };
}

// Ironbow stops as [position, r, g, b]. Entries are ABGR for a little-endian Uint32Array.
export function ironbow() {
  const stops = [
    [0, 0, 0, 10],
    [0.2, 50, 0, 130],
    [0.45, 170, 20, 120],
    [0.65, 235, 90, 20],
    [0.85, 255, 190, 30],
    [1, 255, 255, 235],
  ];
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const p = i / 255;
    const hi = stops.findIndex((s) => s[0] >= p) || 1;
    const [p0, ...a] = stops[hi - 1];
    const [p1, ...b] = stops[hi];
    const [r, g, bl] = a.map((v, c) => Math.round(v + ((b[c] - v) * (p - p0)) / (p1 - p0)));
    lut[i] = (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0;
  }
  return lut;
}
