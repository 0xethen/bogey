import { expect, test } from "vite-plus/test";
import { escapeXml, hackathonJson, toAtom, toRss, type Feed } from "../src/feeds.ts";

const feed: Feed = {
  id: "tag:bogey,2026:ev",
  title: "News & more",
  url: "https://x.test/events/ev",
  selfUrl: "https://x.test/api/v1/events/ev/announcements.atom",
  entries: [
    {
      id: "a1",
      title: "Lunch <now>",
      updated: new Date("2026-10-09T12:00:00Z"),
      content: "Pizza & pop",
      url: "https://x.test/events/ev/announcements",
    },
    {
      id: "a2",
      title: "Doors",
      updated: new Date("2026-10-09T09:00:00Z"),
      content: "",
      url: "https://x.test/events/ev/announcements",
    },
  ],
};

test("XML text is escaped and control characters dropped", () => {
  expect(escapeXml(`<a href="x">&'</a>\u0001`)).toBe(
    "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
  );
});

test("Atom has an entry per announcement and the newest time", () => {
  const xml = toAtom(feed);
  expect(xml).toContain("<title>News &amp; more</title>");
  expect(xml).toContain("<updated>2026-10-09T12:00:00.000Z</updated>");
  expect(xml.match(/<entry>/g)).toHaveLength(2);
  expect(xml).toContain("Lunch &lt;now&gt;");
});

test("RSS has items with guids and dates", () => {
  const xml = toRss(feed);
  expect(xml.match(/<item>/g)).toHaveLength(2);
  expect(xml).toContain('<guid isPermaLink="false">a1</guid>');
  expect(xml).toContain("Fri, 09 Oct 2026 12:00:00 GMT");
});

test("an empty feed still has a valid updated time", () => {
  expect(toAtom({ ...feed, entries: [] })).toContain("<updated>1970-01-01T00:00:00.000Z</updated>");
});

test("hackathon.json leaves out what is empty", () => {
  expect(
    hackathonJson({
      name: "Hack",
      description: "",
      url: "https://x.test/e",
      startsAt: "2026-10-09T14:00:00Z",
      endsAt: null,
      timezone: "America/New_York",
    }),
  ).toEqual({
    name: "Hack",
    url: "https://x.test/e",
    start_date: "2026-10-09T14:00:00Z",
    timezone: "America/New_York",
  });
});
