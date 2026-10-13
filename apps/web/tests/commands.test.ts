import { resolveSettings } from "@bogey/config/settings";
import { describe, expect, test } from "vite-plus/test";
import type { Session } from "@bogey/db/auth";
import type { Event } from "@bogey/db/queries/events";
import {
  groupCommands,
  matchCommand,
  routeCommands,
  type CommandRoute,
} from "../src/lib/commands.ts";
import type { EventViewer, Viewer } from "../src/lib/viewer.ts";

const session: Session = {
  user: { id: "u1", email: "a@example.com" },
  profile: null,
  org: null,
  orgRole: null,
  platformAdmin: false,
  adminNeedsMfa: false,
};

const event: Event = {
  created_at: "",
  created_by: null,
  description_md: "",
  ends_at: null,
  id: "e1",
  is_template: false,
  kind: "hackathon",
  location: null,
  name: "Spring Jam",
  org_id: "o1",
  short_name: null,
  slug: "spring-jam",
  starts_at: null,
  team_size_max: 4,
  team_size_min: 1,
  timezone: "UTC",
  updated_at: "",
  visibility: "public",
  website_url: null,
};

const inEvent: EventViewer = {
  event,
  access: { eventId: "e1", role: null, orgAdmin: true, grants: [], roleKeys: [], matrix: {} },
  windows: [],
  plugins: [],
  pluginSettings: {},
  hasAgenda: false,
  chat: resolveSettings("chat", undefined),
};

const root: CommandRoute = { id: "__root__", fullPath: "/", staticData: {} };
const authed: CommandRoute = { id: "/_authed", fullPath: "/", staticData: {}, parent: root };

function route(
  id: string,
  staticData: CommandRoute["staticData"],
  parent: CommandRoute = authed,
): CommandRoute {
  return { id: `/_authed${id}`, fullPath: id, staticData, parent };
}

describe("routeCommands", () => {
  const account = route("/account", { title: "Account", command: { group: "Account" } });
  const org = route("/org", {
    title: "Organization",
    command: { group: "Organization", when: ({ session }: Viewer) => session.orgRole === "owner" },
  });
  const orgIndex = route("/org/", { command: false }, org);
  const members = route("/org/members", { title: "Members" }, org);
  const eventRoute = route("/events/$slug", {
    title: "Event",
    command: { group: ({ event }: Viewer) => event?.event.name ?? "Event" },
  });
  const eventHome = route("/events/$slug/", { command: { label: "Home" } }, eventRoute);
  const page = route("/events/$slug/pages/$page", { title: "Page" }, eventRoute);
  const routes = [root, authed, account, org, orgIndex, members, eventRoute, eventHome, page];

  test("skips pages the viewer can't use, and $slug pages outside an event", () => {
    expect(routeCommands(routes, { session })).toEqual([
      { href: "/account", label: "Account", group: "Account", keywords: ["Account"] },
    ]);
  });

  test("a group and its check apply to everything under the route that declares them", () => {
    const owner: Viewer = { session: { ...session, orgRole: "owner" } };
    expect(routeCommands(routes, owner).map((item) => [item.href, item.group])).toEqual([
      ["/account", "Account"],
      ["/org/members", "Organization"],
    ]);
  });

  test("fills $slug from the current event and lets the index name the path", () => {
    const items = routeCommands(routes, { session, event: inEvent });
    expect(items).toContainEqual({
      href: "/events/spring-jam",
      label: "Home",
      group: "Spring Jam",
      keywords: ["Home", "Spring Jam"],
    });
    expect(items.some((item) => item.href.includes("$"))).toBe(false);
  });
});

test("groupCommands orders groups, unnamed ones last", () => {
  const item = (group: string) => ({ href: `/${group}`, label: group, group, keywords: [] });
  const grouped = groupCommands([item("b"), item("z"), item("a")], ["a", "b"]);
  expect(grouped.map(([group]) => group)).toEqual(["a", "b", "z"]);
});

test("matchCommand matches word starts, not scattered letters", () => {
  expect(matchCommand("/e/results", "sett", ["Results", "Spring Jam"])).toBe(0);
  expect(matchCommand("/o/settings", "sett", ["Organization settings", "Organization"])).toBe(0.5);
  expect(matchCommand("/o/settings", "org set", ["Organization settings"])).toBe(1);
  expect(matchCommand("/x", "", ["Anything"])).toBe(1);
});
