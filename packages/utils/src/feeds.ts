export interface FeedEntry {
  id: string;
  title: string;
  updated: Date;
  content: string;
  url: string;
}

export interface Feed {
  id: string;
  title: string;
  url: string;
  selfUrl: string;
  entries: Tuple<FeedEntry>;
}

function isXmlControl(code: number): boolean {
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
}

export function escapeXml(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isXmlControl(code)) continue;
    out +=
      char === "&"
        ? "&amp;"
        : char === "<"
          ? "&lt;"
          : char === ">"
            ? "&gt;"
            : char === '"'
              ? "&quot;"
              : char === "'"
                ? "&apos;"
                : char;
  }
  return out;
}

function latest(feed: Feed): Date {
  return feed.entries.reduce(
    (newest, entry) => (entry.updated > newest ? entry.updated : newest),
    new Date(0),
  );
}

export function toAtom(feed: Feed): string {
  const entries = feed.entries.map(
    (entry) => `  <entry>
    <id>${escapeXml(entry.id)}</id>
    <title>${escapeXml(entry.title)}</title>
    <updated>${entry.updated.toISOString()}</updated>
    <link href="${escapeXml(entry.url)}"/>
    <content type="text">${escapeXml(entry.content)}</content>
  </entry>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(feed.id)}</id>
  <title>${escapeXml(feed.title)}</title>
  <updated>${latest(feed).toISOString()}</updated>
  <link href="${escapeXml(feed.url)}"/>
  <link rel="self" href="${escapeXml(feed.selfUrl)}"/>
${entries.join("\n")}
</feed>
`;
}

export function toRss(feed: Feed): string {
  const items = feed.entries.map(
    (entry) => `    <item>
      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.url)}</link>
      <pubDate>${entry.updated.toUTCString()}</pubDate>
      <description>${escapeXml(entry.content)}</description>
    </item>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.url)}</link>
    <description>${escapeXml(feed.title)}</description>
    <lastBuildDate>${latest(feed).toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feed.selfUrl)}" rel="self" type="application/rss+xml"/>
${items.join("\n")}
  </channel>
</rss>
`;
}

export interface HackathonCard {
  name: string;
  description: string;
  url: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  logo?: string | null;
}

export function hackathonJson(card: HackathonCard): Record<string, string> {
  const entries: Array<[string, string | null | undefined]> = [
    ["name", card.name],
    ["description", card.description],
    ["url", card.url],
    ["start_date", card.startsAt],
    ["end_date", card.endsAt],
    ["timezone", card.timezone],
    ["logo", card.logo],
  ];
  const out: Record<string, string> = {};
  for (const [key, value] of entries) if (value) out[key] = value;
  return out;
}
