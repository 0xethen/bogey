interface Range {
  v6: boolean;
  start: bigint;
  end: bigint;
}

function ipv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function ipv6(text: string): bigint | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

function parseRange(text: string): Range | null {
  const [address = "", prefix] = text.trim().split("/");
  const v6 = address.includes(":");
  const bits = v6 ? 128 : 32;
  const value = v6 ? ipv6(address) : ipv4(address);
  const length = prefix === undefined ? bits : Number(prefix);
  if (value === null || !Number.isInteger(length) || length < 0 || length > bits) return null;
  const host = (1n << BigInt(bits - length)) - 1n;
  const start = value & ~host;
  return { v6, start, end: start | host };
}

export function collapseRanges(ranges: Tuple<string>): string[] {
  const parsed = ranges.map((text) => ({ text: text.trim(), range: parseRange(text) }));
  return parsed
    .filter(({ range }, index) => {
      if (!range) return true;
      return !parsed.some((other, otherIndex) => {
        if (otherIndex === index || !other.range || other.range.v6 !== range.v6) return false;
        const covers = other.range.start <= range.start && other.range.end >= range.end;
        const same = other.range.start === range.start && other.range.end === range.end;
        return covers && (!same || otherIndex < index);
      });
    })
    .map(({ text }) => text);
}
