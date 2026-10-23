import { describe, expect, test } from "vite-plus/test";
import { eventTabs, NO_MENUS } from "../src/lib/event-tabs.ts";
import type { T } from "../src/lib/translate.tsx";

const t = ((key: string) => key) as T;

describe("eventTabs", () => {
  test("the Agenda menu lists each session's main page, then attendance for those who take it", () => {
    const sessions = [
      { id: "s1", name: "Opening" },
      { id: "s2", name: "Workshop", attendance: true },
    ];
    const agenda = eventTabs("spring", [], {}, { ...NO_MENUS, sessions }, t).find(
      (tab) => tab.key === "agenda",
    );
    expect(agenda?.menu).toEqual([
      {
        key: "s1",
        label: "Opening",
        to: "/events/spring/agenda/s1",
        pages: [{ key: "main", label: "agenda.mainPage", to: "/events/spring/agenda/s1" }],
      },
      {
        key: "s2",
        label: "Workshop",
        to: "/events/spring/agenda/s2",
        pages: [
          { key: "main", label: "agenda.mainPage", to: "/events/spring/agenda/s2" },
          {
            key: "attendance",
            label: "agenda.attendance",
            to: "/events/spring/agenda/s2/attendance",
          },
        ],
      },
    ]);
  });
});
