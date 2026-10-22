export function plural(count: number, one: string, many = `${one}s`, showCount = true): string {
  return `${showCount ? `${count} ` : ""}${count === 1 ? one : many}`;
}

export function excerpt(markdown: string, max = 160): string {
  const plain = markdown
    .replace(/!\[[^[\]]*\]\([^()]*\)/g, "")
    .replace(/\[([^[\]]*)\]\([^()]*\)/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const space = plain.slice(0, max).lastIndexOf(" ");
  const cut = space > max / 2 ? plain.slice(0, space) : plain.slice(0, max - 1);
  return `${cut.trimEnd()}...`;
}
