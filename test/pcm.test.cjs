const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('capture downmixes stereo, preserves last partial chunk, and outputs silence locally', () => {
  let Processor; const messages = [];
  const sandbox = { AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => messages.push(data) }; } }, Int16Array, Math, registerProcessor: (_name, klass) => Processor = klass };
  vm.runInNewContext(fs.readFileSync('src/pcm-worklet.js', 'utf8'), sandbox);
  const processor = new Processor(), left = new Float32Array(128).fill(.8), right = new Float32Array(128).fill(.2), output = new Float32Array(128).fill(1);
  processor.process([[left, right]], [[output]]); assert.equal(messages.length, 0); assert.equal(output.every(x => x === 0), true);
  processor.port.onmessage({ data: 'flush' }); assert.equal(new Int16Array(messages[0]).length, 128); assert.equal(new Int16Array(messages[0])[0], 16384); assert.equal(messages[1].flushed, true);
});
test('capture emits bounded 100ms packets and clamps loud samples', () => {
  let Processor; const messages = [];
  vm.runInNewContext(fs.readFileSync('src/pcm-worklet.js', 'utf8'), { AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => messages.push(data) }; } }, Int16Array, Math, registerProcessor: (_, klass) => Processor = klass });
  const processor = new Processor(); for (let i = 0; i < 20; i++) processor.process([[new Float32Array(128).fill(2)]], [[new Float32Array(128)]]);
  assert.equal(messages.length, 1); assert.equal(messages[0].byteLength, 4800); assert.equal(new Int16Array(messages[0])[0], 32767);
});
