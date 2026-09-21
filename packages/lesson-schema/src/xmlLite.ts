export type XmlElem = {
  name: string;
  attrs: Record<string, string>;
  children: Array<XmlElem | string>;
};

export function parseXml(source: string): XmlElem {
  const stripped = source
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/g, "")
    .trim();
  const { elem, next } = parseElement(stripped, 0);
  skipWs(stripped, next);
  return elem;
}

export function childElems(el: XmlElem, name?: string): XmlElem[] {
  const kids = el.children.filter((child): child is XmlElem => typeof child !== "string");
  return name ? kids.filter((child) => child.name === name) : kids;
}

export function firstElem(el: XmlElem, name: string): XmlElem | undefined {
  return childElems(el, name)[0];
}

export function textOf(el: XmlElem, name?: string): string {
  const target = name ? firstElem(el, name) : el;
  if (!target) {
    return "";
  }
  return target.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("")
    .trim();
}

export function deepFind(el: XmlElem, name: string): XmlElem[] {
  const found: XmlElem[] = [];
  if (el.name === name) {
    found.push(el);
  }
  for (const child of childElems(el)) {
    found.push(...deepFind(child, name));
  }
  return found;
}

function parseElement(source: string, start: number): { elem: XmlElem; next: number } {
  let i = skipWs(source, start);
  if (source[i] !== "<") {
    throw new Error(`expected '<' at ${i}`);
  }
  i += 1;
  if (source[i] === "/") {
    throw new Error(`unexpected closing tag at ${i}`);
  }
  const nameStart = i;
  while (i < source.length && /[A-Za-z0-9:._-]/.test(source[i]!)) {
    i += 1;
  }
  const name = source.slice(nameStart, i);
  const attrs: Record<string, string> = {};
  i = skipWs(source, i);
  while (i < source.length && source[i] !== ">" && source[i] !== "/") {
    const keyStart = i;
    while (i < source.length && /[A-Za-z0-9:._-]/.test(source[i]!)) {
      i += 1;
    }
    const key = source.slice(keyStart, i);
    i = skipWs(source, i);
    if (source[i] !== "=") {
      throw new Error(`expected '=' after attribute ${key}`);
    }
    i = skipWs(source, i + 1);
    const quote = source[i];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`expected quoted attribute value for ${key}`);
    }
    i += 1;
    const valueStart = i;
    while (i < source.length && source[i] !== quote) {
      i += 1;
    }
    attrs[key] = decode(source.slice(valueStart, i));
    i += 1;
    i = skipWs(source, i);
  }
  if (source.startsWith("/>", i)) {
    return { elem: { name, attrs, children: [] }, next: i + 2 };
  }
  if (source[i] !== ">") {
    throw new Error(`expected '>' after <${name}`);
  }
  i += 1;
  const children: Array<XmlElem | string> = [];
  while (i < source.length) {
    if (source.startsWith("</", i)) {
      i += 2;
      const endNameStart = i;
      while (i < source.length && /[A-Za-z0-9:._-]/.test(source[i]!)) {
        i += 1;
      }
      const endName = source.slice(endNameStart, i);
      i = skipWs(source, i);
      if (source[i] !== ">") {
        throw new Error(`expected '>' after </${endName}`);
      }
      if (endName !== name) {
        throw new Error(`mismatched close </${endName}> for <${name}>`);
      }
      return { elem: { name, attrs, children }, next: i + 1 };
    }
    if (source[i] === "<") {
      const nested = parseElement(source, i);
      children.push(nested.elem);
      i = nested.next;
      continue;
    }
    const textStart = i;
    while (i < source.length && source[i] !== "<") {
      i += 1;
    }
    const text = decode(source.slice(textStart, i));
    if (text.length > 0) {
      children.push(text);
    }
  }
  throw new Error(`unclosed <${name}>`);
}

function skipWs(source: string, i: number): number {
  while (i < source.length && /\s/.test(source[i]!)) {
    i += 1;
  }
  return i;
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
