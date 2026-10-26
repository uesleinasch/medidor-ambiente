const EXIF_IFD_POINTER = 0x8769;
const FOCAL_LENGTH_35MM = 0xa405;

function parseFocalLength35mm(view, tiff) {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (offset) => view.getUint16(offset, little);
  const u32 = (offset) => view.getUint32(offset, little);
  const findEntry = (ifd, tag) => {
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === tag) return entry;
    }
    return null;
  };

  const pointer = findEntry(tiff + u32(tiff + 4), EXIF_IFD_POINTER);
  if (pointer === null) return null;
  const entry = findEntry(tiff + u32(pointer + 8), FOCAL_LENGTH_35MM);
  return entry === null ? null : u16(entry + 8) || null;
}

export async function readFocalLength35mm(file) {
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 10 < view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) return null;
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
        return parseFocalLength35mm(view, offset + 10);
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  } catch {}
  return null;
}
