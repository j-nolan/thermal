import assert from "node:assert/strict";
import test from "node:test";
import { HEIGHT, WIDTH, decodeFrame, findPipes, ironbow, parseMessages, rotationMap, writeReg } from "./senxor.js";

const text = (bytes) => String.fromCharCode(...bytes);
const ascii = (s) => new TextEncoder().encode(s);

function gfra(deciKelvin = 2981) {
  const body = new Uint8Array(4 + 10240);
  body.set(ascii("GFRA"));
  const view = new DataView(body.buffer, 4 + 320);
  for (let i = 0; i < WIDTH * HEIGHT; i++) view.setUint16(i * 2, deciKelvin + (i === 7 ? 100 : 0), true);
  const length = ascii((body.length + 4).toString(16).toUpperCase().padStart(4, "0"));
  const sum = [...length, ...body].reduce((a, b) => a + b, 0) & 0xffff;
  return Uint8Array.from([...ascii("   #"), ...length, ...body, ...ascii(sum.toString(16).padStart(4, "0"))]);
}

test("writeReg matches the vendor encoding", () => {
  assert.equal(text(writeReg(0xb1, 0x02)), "   #000CWREGB102XXXX");
});

test("parses the documented WREG ack", () => {
  const { messages, rest } = parseMessages(ascii("   #0008WREG01FD"));
  assert.equal(messages[0].cmd, "WREG");
  assert.equal(messages[0].data.length, 0);
  assert.equal(rest.length, 0);
});

test("reassembles a frame split across chunks", () => {
  const frame = gfra();
  const first = parseMessages(frame.subarray(0, 5000));
  assert.equal(first.messages.length, 0);
  const joined = Uint8Array.from([...first.rest, ...frame.subarray(5000)]);
  assert.equal(parseMessages(joined).messages[0].cmd, "GFRA");
});

test("resyncs after garbage and a bad checksum", () => {
  const frame = gfra();
  const corrupt = frame.slice();
  corrupt[500] ^= 0xff;
  const { messages } = parseMessages(Uint8Array.from([...ascii("xx"), ...corrupt, ...frame]));
  assert.deepEqual(messages.map((m) => m.cmd), ["GFRA"]);
});

test("decodes deci-Kelvin to Celsius and finds the range", () => {
  const { temps, min, max } = decodeFrame(parseMessages(gfra()).messages[0].data);
  assert.ok(Math.abs(min - 24.95) < 0.01);
  assert.ok(Math.abs(max - 34.95) < 0.01);
  assert.ok(Math.abs(temps[7] - max) < 0.01);
});

test("rejects an unknown frame size", () => {
  assert.throws(() => decodeFrame(new Uint8Array(100)), /Unexpected frame size/);
});

test("rotationMap is a permutation with the expected corners", () => {
  for (const turns of [0, 1, 2, 3]) {
    assert.equal(new Set(rotationMap(turns).map).size, WIDTH * HEIGHT);
  }
  const quarter = rotationMap(1);
  assert.deepEqual([quarter.width, quarter.height], [HEIGHT, WIDTH]);
  assert.equal(quarter.map[HEIGHT - 1], 0);
  assert.equal(rotationMap(2).map[0], WIDTH * HEIGHT - 1);
  assert.equal(rotationMap(3).map[0], WIDTH - 1);
});

test("findPipes picks the CDC data and control interfaces", () => {
  const control = { interfaceNumber: 0, alternate: { interfaceClass: 2, endpoints: [{ type: "interrupt", direction: "in", endpointNumber: 3 }] } };
  const data = {
    interfaceNumber: 1,
    alternate: {
      interfaceClass: 10,
      endpoints: [
        { type: "bulk", direction: "in", endpointNumber: 1 },
        { type: "bulk", direction: "out", endpointNumber: 2 },
      ],
    },
  };
  assert.deepEqual(findPipes({ interfaces: [control, data] }), { data: 1, control: 0, in: 1, out: 2 });
  assert.throws(() => findPipes({ interfaces: [control] }), /No bulk endpoints/);
});

test("ironbow runs from dark to bright and is opaque", () => {
  const lut = ironbow();
  assert.equal(lut[0], 0xff0a0000);
  assert.equal(lut[255], 0xffebffff);
  assert.ok(lut.every((c) => c >>> 24 === 0xff));
});
