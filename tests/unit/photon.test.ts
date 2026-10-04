import { expect, test } from 'bun:test';
import { decodeMessage, encodeMessage, type Message, type Params, type Value } from '../../src/host/photon/protocol';

const bytes = (hex: string) => new Uint8Array(Buffer.from(hex.replace(/\s/g, ''), 'hex'));
const hex = (data: Uint8Array) => Buffer.from(data).toString('hex');
const utf8 = (text: string) => Buffer.from(text).toString('hex');
const params = (...entries: [number, Value][]): Params => new Map(entries);
const event = (value: Value): Message => ({ kind: 'event', code: 0, params: params([0, value]) });
const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** `frame` decodes to `message`, which encodes back to the same bytes. */
function roundTrip(frame: string, message: Message): void {
  expect(decodeMessage(bytes(frame))).toEqual(message);
  expect(hex(encodeMessage(message))).toBe(frame.replace(/\s/g, ''));
}

// Name Server frames recorded from the original client.
test('frames captured from the original client round-trip byte-identically', () => {
  const ping = (time: number): Message =>
    ({ kind: 'request', internal: true, code: 1, params: params([1, { int: time }]) });
  roundTrip('f306 01 01 01 0bc6', ping(198));
  roundTrip('f306 01 01 01 0dd204', ping(1234));
  roundTrip('f306 01 01 01 0d7a14', ping(5242));
  roundTrip('f306 01 01 01 0d8018', ping(6272));
  roundTrip('f306 01 01 01 0d6b23', ping(9067));
  const appId = '748df142-c087-424c-b6ca-b57f4b0db24d';
  roundTrip(`f302 dc 01 e0 0724 ${utf8(appId)}`,
    { kind: 'request', internal: false, code: 220, params: params([224, appId]) });
});

test('server replies the client reads: ping and GetRegions responses (DeserializeOperationResponse f113921)', () => {
  // Code, return code as int16 little-endian, typed debug message (Null 08), parameter count and typed parameters.
  roundTrip('f307 01 0000 08 02 01 0dd204 02 0980897a', { kind: 'response', internal: true, code: 1, returnCode: 0,
    debugMessage: null, params: params([1, { int: 1234 }], [2, { int: 1_000_000 }]) });
  roundTrip(`f303 dc 0000 08 02 d2 47 01 02 6575 e6 47 01 0e ${utf8('127.0.0.1:9090')}`, { kind: 'response',
    internal: false, code: 220, returnCode: 0, debugMessage: null,
    params: params([210, { strings: ['eu'] }], [230, { strings: ['127.0.0.1:9090'] }]) });
});

test('golden messages built from the client serializers', () => {
  roundTrip('f301', { kind: 'init' });
  roundTrip('f302 e3 03 ff 0704726f6f6d f8 1502 03ff 0302 07046d6f6465 09e0c508 fa 1c', { kind: 'request',
    internal: false, code: 227, params: params([255, 'room'],
      [248, { hashtable: [[{ byte: 255 }, { byte: 2 }], ['mode', { int: 70000 }]] }], [250, true]) });
  const refused: Message = { kind: 'response', internal: false, code: 226, returnCode: -2, debugMessage: 'no',
    params: params([254, { int: 1 }]) };
  roundTrip('f303 e2 feff 07026e6f 01 fe 0b01', refused);
  expect(hex(encodeMessage({ ...refused, debugMessage: '' }))).toBe('f303e2feff0801fe0b01');
  roundTrip('f304 ff 03 fe 0b02 fc 49020204 f9 1501 03ff 0703626f62', { kind: 'event', code: 255,
    params: params([254, { int: 2 }], [252, Int32Array.of(1, 2)], [249, { hashtable: [[{ byte: 255 }, 'bob']] }]) });
});

test('every value round-trips through the bytes the client writes for it', () => {
  const values: [Value, string][] = [
    [null, '08'], [true, '1c'], [false, '1b'], [{ byte: 0 }, '22'], [{ byte: 200 }, '03c8'], [{ short: 0 }, '1d'],
    [{ short: -2 }, '04feff'], [{ int: 0 }, '1e'], [{ int: 255 }, '0bff'], [{ int: -255 }, '0cff'],
    [{ int: 65535 }, '0dffff'], [{ int: -256 }, '0e0001'], [{ int: 65536 }, '09808008'], [{ int: -65536 }, '09ffff07'],
    [{ int: -(2 ** 31) }, '09ffffffff0f'], [{ long: 0n }, '1f'], [{ long: 255n }, '0fff'], [{ long: -1n }, '1001'],
    [{ long: 65535n }, '11ffff'], [{ long: -65535n }, '12ffff'], [{ long: -(2n ** 63n) }, `0a${'ff'.repeat(9)}01`],
    [{ float: 1.5 }, '050000c03f'], [{ float: NaN, bits: 0xffc00000 }, '050000c0ff'],
    [{ double: -2.5 }, '0600000000000004c0'], ['Hi', '07024869'], ['', '0700'], ['é', '0702c3a9'],
    [[{ int: 1 }, 'x', null], '1703 0b01 070178 08'], [Uint8Array.of(1, 2, 3), '4303010203'],
    [Int16Array.of(1, -1), '4402 0100 ffff'], [Float32Array.of(1.5), '4501 0000c03f'],
    [Float64Array.of(-2.5), '4601 00000000000004c0'], [{ strings: ['a', ''] }, '4702 0161 00'],
    [Int32Array.of(1, -1), '4902 02 01'], [BigInt64Array.of(1n, -1n), '4a02 02 01'],
    [{ bools: [true, false, true, true, false, false, false, false, true] }, '4209 0d 01'],
    [{ arrays: [Int32Array.of(7), null] }, '4002 49010e 08'],
    [{ hashtable: [[{ byte: 255 }, 'bob'], ['k', { long: 5n }]] }, '1502 03ff 0703626f62 07016b 0f05'],
    [{ hashtables: [[], [[true, null]]] }, '5502 00 01 1c 08'],
    [{ dictionary: [['a', { int: 1 }]], types: [7, 9] }, '14 0709 01 0161 02'],
    [{ dictionary: [[{ byte: 1 }, ['x']]], types: [3, 23] }, '14 0317 01 01 01070178'],
    [{ dictionary: [[{ short: 0 }, { dictionary: [], types: [0, 0] }]], types: [4, 20, 0, 0] },
      '14 04140000 01 0000 0000 00'],
    [{ dictionary: [['z', { arrays: [] }]], types: [7, 64, 73] }, '14 074049 01 017a 4000'],
    [{ dictionaries: [[], [[{ int: 2 }, true]]], types: [9, 2] }, '54 0902 02 00 01 04 01'],
    [{ custom: 86, bytes: Uint8Array.of(1, 2) }, 'd6 02 0102'], [{ custom: 100, bytes: new Uint8Array() }, '1364 00'],
    [{ custom: 81, items: [Uint8Array.of(9), new Uint8Array()] }, '5302 51 0109 00'],
  ];
  for (const [value, payload] of values) roundTrip(`f304 00 01 00 ${payload}`, event(value));
});

test('forms only the client reader accepts decode to the value the writer would re-encode', () => {
  const forms: [string, Value][] = [
    ['0205', true], ['0300', { byte: 0 }], ['040000', { short: 0 }], ['0902', { int: 1 }], ['0c00', { int: 0 }],
    ['0a02', { long: 1n }], ['20', { float: 0 }], ['21', { double: 0 }],
    ['130100', { custom: 1, bytes: new Uint8Array() }], ['e400', { custom: 100, bytes: new Uint8Array() }],
  ];
  for (const [payload, value] of forms) expect(decodeMessage(bytes(`f304 00 01 00 ${payload}`))).toEqual(event(value));
});

// Everything outside the Read f113879 dispatch, plus operations as values (24-26), which the codec does not support.
test('type codes the codec does not read are rejected, never guessed', () => {
  const error = (code: number) => {
    try { decodeMessage(Uint8Array.of(0xf3, 4, 0, 1, 0, code)); } catch (e) { return (e as Error).message; }
    return '';
  };
  const read = new Set([...span(2, 21), 23, ...span(27, 34), 64, ...span(66, 71), 73, 74, ...span(83, 85),
    ...span(128, 228)]);
  expect(span(0, 255).filter(code => /GpType/.test(error(code)))).toEqual(span(0, 255).filter(code => !read.has(code)));
});

test('frames and values the client cannot read are rejected', () => {
  const frames: [string, RegExp][] = [
    ['f00101', /Not a Photon message/], ['f38201', /Encrypted/], ['f300', /message type 0/], ['f305', /type 5/],
    ['f30100', /Trailing/], ['f302dc', /Truncated/], ['f304 00 02 0008 0008', /Duplicate/],
    ['f304 00 01 00 14 0200 00', /key type 2/], ['f304 00 01 00 07 ffffffff7f', /32 bits/],
    ['f304 00 01 00 07 02 c328', /utf-8/], ['f304 00 01 00 17 05 08', /Truncated/],
  ];
  for (const [frame, reason] of frames) expect(() => decodeMessage(bytes(frame))).toThrow(reason);
  expect(() => encodeMessage(event({ byte: 256 }))).toThrow(/outside/);
  expect(() => encodeMessage(event({ dictionary: [['a', 'b']], types: [7, 9] }))).toThrow(/declared type 9/);
  const crowded = params(...span(0, 255).map((key): [number, Value] => [key, null]));
  expect(() => encodeMessage({ kind: 'event', code: 0, params: crowded })).toThrow(/outside 0..255/);
});
