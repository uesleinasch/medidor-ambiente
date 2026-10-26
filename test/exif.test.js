import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFocalLength35mm } from '../js/exif.js';

function jpegWithFocal(focal, little = true) {
  const tiff = [];
  const u16 = (v) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const exifIfdOffset = 8 + 2 + 12 + 4;
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdOffset), ...u32(0));
  tiff.push(...u16(1), ...u16(0xa405), ...u16(3), ...u32(1), ...u16(focal), 0, 0, ...u32(0));

  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = payload.length + 2;
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...payload, 0xff, 0xd9])]);
}

test('lê a distância focal equivalente a 35 mm do EXIF', async () => {
  assert.equal(await readFocalLength35mm(jpegWithFocal(26)), 26);
  assert.equal(await readFocalLength35mm(jpegWithFocal(24, false)), 24);
});

test('sem EXIF ou arquivo que não é JPEG devolve null', async () => {
  assert.equal(await readFocalLength35mm(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])])), null);
  assert.equal(await readFocalLength35mm(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])])), null);
});
