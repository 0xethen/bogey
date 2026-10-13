import { definePlugin } from "@bogey/plugins/api";

export const manifest = definePlugin({
  key: "hello",
  name: "Hello",
  api: 1,
  version: "0.0.0",
  description: "Greets participants on the event home and on its own page.",
  author: { name: "Bogey" },
  license: "MIT",
  source: { repository: "github:0xethen/bogey", directory: "packages/plugins/examples/hello" },
  homePanels: [{ key: "greeters", label: "Greeters", description: "Who has said hello." }],
  windows: [{ key: "greetings", label: "Greetings" }],
  settings: {
    greeting: { type: "string", label: "Greeting", default: "Hello" },
    showOnHome: {
      type: "boolean",
      label: "Show on the event home",
      description: "A panel above the schedule.",
      default: true,
    },
    tone: {
      type: "select",
      label: "Tone",
      scope: "org",
      default: "warm",
      options: [
        { value: "warm", label: "Warm" },
        { value: "brief", label: "Brief" },
      ],
    },
  },
  routes: [
    { path: "", label: "Hello" },
    { path: "/greeters", area: "manage", label: "Greeters" },
    { path: "/about", area: "public" },
  ],
  translations: ["es"],
  shares: { messages: true, sql: ["hello_applause"] },
  commands: [
    { path: "", label: "Say hello", keywords: ["greet"] },
    {
      label: "Hello plugin docs",
      href: "https://github.com/0xethen/bogey/blob/main/docs/plugins.md",
    },
    { label: "Wave", action: "wave" },
  ],
  accountLinks: [{ label: "About Hello", path: "/about" }],
  itemTypes: [
    {
      kind: "stars",
      label: "Star rating",
      description: "Pick a number of stars.",
      config: { max: { type: "number", label: "Most stars", default: 5, min: 1, max: 10 } },
    },
  ],
  ranking: [
    {
      key: "applause",
      label: "Applause",
      description: "Judges record how loud the room was, 1 to 10. The loudest ranks first.",
    },
  ],
  sessionKinds: [{ key: "greeting", label: "Greeting", icon: "confetti", tone: "pink" }],
  serverRoutes: [{ path: "/greeting", method: "GET" }],
  uses: { settings: ["plugin.hello"] },
});

export default manifest;
