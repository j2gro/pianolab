import { unzipSync, strFromU8 } from "fflate";
import { firstElem, parseXml, textOf } from "./xmlLite";

export function musicXmlFromBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return xmlFromMxl(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function xmlFromMxl(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  const container = names.find((name) => name.replace(/\\/g, "/").endsWith("META-INF/container.xml"));
  let rootPath: string | undefined;
  if (container) {
    const xml = strFromU8(files[container]!);
    const doc = parseXml(xml);
    const rootfile = firstElem(firstElem(doc, "rootfiles") ?? doc, "rootfile") ?? doc;
    rootPath = rootfile.attrs["full-path"] ?? textOf(rootfile);
  }
  const normalized = rootPath?.replace(/\\/g, "/");
  const match =
    (normalized ? names.find((name) => name.replace(/\\/g, "/") === normalized) : undefined) ??
    names.find((name) => /\.(musicxml|xml)$/i.test(name) && !name.includes("META-INF"));
  if (!match) {
    throw new Error("MXL archive has no MusicXML score");
  }
  return strFromU8(files[match]!);
}
