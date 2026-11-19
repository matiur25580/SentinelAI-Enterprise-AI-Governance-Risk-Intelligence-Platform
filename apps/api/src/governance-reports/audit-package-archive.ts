import { deflateRawSync } from "node:zlib";

export type AuditPackageFile = { name: string; content: string | Buffer };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

/** Creates a standards-compliant ZIP archive using only Node.js built-ins. */
export function createZipArchive(files: AuditPackageFile[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);
    const flags = 0x0800;
    const method = 8;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(raw.length), u16(name.length), u16(0), name,
    ]);
    local.push(localHeader, compressed);

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(raw.length), u16(name.length),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    central.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...local, centralDirectory, end]);
}

function pdfText(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Minimal searchable multi-page PDF renderer; avoids a runtime dependency. */
export function createReportPdf(title: string, lines: string[]): Buffer {
  const allLines = [title, "SentinelAI governance audit package", ...lines];
  const pageLines: string[][] = [];
  for (let index = 0; index < allLines.length; index += 48) pageLines.push(allLines.slice(index, index + 48));
  if (!pageLines.length) pageLines.push([title]);

  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "binary")); return objects.length; };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];

  for (const page of pageLines) {
    const commands = ["BT", "/F1 10 Tf", "48 750 Td", "14 TL"];
    page.forEach((line, index) => {
      if (index > 0) commands.push("T*");
      commands.push(`(${pdfText(line.slice(0, 150))}) Tj`);
    });
    commands.push("ET");
    const stream = Buffer.from(commands.join("\n"), "ascii");
    const contentId = add(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
      stream,
      Buffer.from("\nendstream", "ascii"),
    ]));
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "ascii");
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "ascii");

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%SentinelAI\n", "ascii")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"), object, Buffer.from("\nendobj\n", "ascii"),
    ]);
    chunks.push(wrapped);
    length += wrapped.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
}
