import { useState } from "react";
import { browserClientFor } from "@bogey/db/browser";
import { Button } from "@bogey/ui/components/button";
import { Panel } from "@bogey/ui/components/panel";
import { Screen } from "@bogey/ui/components/screen";
import { createPluginMessages } from "@bogey/plugins/messages";
import { createPluginNav } from "@bogey/plugins/nav";
import {
  definePluginRuntime,
  type PluginContext,
  type PluginItemFieldProps,
  type PluginItemViewProps,
  type PluginJudgingPanelContext,
  type PluginPublicContext,
  type PluginSessionPanelContext,
} from "@bogey/plugins/runtime";
import type { SettingsOf } from "@bogey/plugins/types";
import { manifest } from "./manifest.ts";

type Settings = SettingsOf<typeof manifest>;

const { Link, SettingsLink } = createPluginNav(manifest);

const { useT } = createPluginMessages(manifest, {
  "page.title": "Hello",
  "greeters.title": "Greeters",
  "greeters.body": "{count, plural, one {# person has} other {# people have}} said hello.",
  "greeters.settings": "Change the greeting",
  "about.link": "About Hello",
});

function message(settings: Settings, name: string): string {
  return settings.tone === "brief"
    ? `${settings.greeting}.`
    : `${settings.greeting}, ${name}! Glad you're here.`;
}

function HelloPage({ settings, session }: PluginContext<Settings>) {
  const t = useT();
  const name = session.profile?.display_name ?? "there";
  return (
    <Screen title={t("page.title")} width="narrow">
      <p>{message(settings, name)}</p>
      <Link to="/about">{t("about.link")}</Link>
    </Screen>
  );
}

function GreetersPage() {
  const t = useT();
  return (
    <Screen title={t("greeters.title")} width="narrow">
      <p>{t("greeters.body", { count: 0 })}</p>
      <SettingsLink>{t("greeters.settings")}</SettingsLink>
    </Screen>
  );
}

function HomePanel({ settings, session }: PluginContext<Settings>) {
  if (!settings.showOnHome) return null;
  return (
    <Panel title="Hello">
      <p className="text-sm">{message(settings, session.profile?.display_name ?? "there")}</p>
    </Panel>
  );
}

function OrganizerPanel({ settings }: PluginContext<Settings>) {
  return (
    <p className="text-sm text-muted-fg">
      Participants see “{settings.greeting}” {settings.showOnHome ? "on the event home and " : ""}on
      the Hello tab.
    </p>
  );
}

function About({ splat }: PluginPublicContext) {
  return (
    <Screen title="About Hello" width="narrow">
      <p>The Hello plugin says hello.{splat ? ` You asked about “${splat}”.` : ""}</p>
    </Screen>
  );
}

interface HelloDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      hello_applause: { Args: { p_submission: string; p_volume: number }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

function maxStars(config: PluginItemFieldProps["item"]["config"]): number {
  return typeof config.max === "number" ? config.max : 5;
}

function StarsField({ item, value, onChange, onBlur, disabled }: PluginItemFieldProps) {
  const chosen = Number(value ?? 0);
  return (
    <div className="flex gap-1" onBlur={onBlur}>
      {Array.from({ length: maxStars(item.config) }, (_, index) => index + 1).map((star) => (
        <Button
          key={star}
          type="button"
          size="sm"
          variant={star <= chosen ? "default" : "outline"}
          disabled={disabled}
          aria-label={`${star} ${star === 1 ? "star" : "stars"}`}
          onClick={() => onChange(String(star))}
        >
          ★
        </Button>
      ))}
    </div>
  );
}

function StarsView({ value }: PluginItemViewProps) {
  return <span aria-label={`${value} stars`}>{"★".repeat(Number(value) || 0)}</span>;
}

function validateStars(
  value: unknown,
  item: { label: string; required: boolean; config: Readonly<Record<string, unknown>> },
) {
  if (value === undefined || value === "")
    return item.required ? `${item.label} is required` : null;
  const stars = Number(value);
  const most = typeof item.config.max === "number" ? item.config.max : 5;
  return Number.isInteger(stars) && stars >= 1 && stars <= most ? null : `Pick 1 to ${most} stars`;
}

function ApplausePanel({ submissionId }: PluginJudgingPanelContext<Settings>) {
  const [sent, setSent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const record = async (volume: number) => {
    const { error } = await browserClientFor<HelloDatabase>().rpc("hello_applause", {
      p_submission: submissionId,
      p_volume: volume,
    });
    setProblem(error ? error.message : null);
    setSent(error ? null : volume);
  };
  return (
    <Panel title="How loud was the room?">
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((volume) => (
          <Button
            key={volume}
            size="sm"
            variant={volume === sent ? "default" : "outline"}
            onClick={() => void record(volume)}
          >
            {volume}
          </Button>
        ))}
      </div>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </Panel>
  );
}

function GreetingPanel({ settings }: PluginSessionPanelContext<Settings>) {
  return <Panel title="Hello">{settings.greeting}, everyone!</Panel>;
}

export default definePluginRuntime(manifest, {
  itemTypes: { stars: { Field: StarsField, View: StarsView, validate: validateStars } },
  serverRoutes: {
    "GET /greeting": (_request, { user }) =>
      Response.json({ greeting: `Hello, ${user?.email ?? "stranger"}!` }),
  },
  routes: { "": HelloPage, "/greeters": GreetersPage },
  messages: {
    es: async () => ({
      "page.title": "Hola",
      "greeters.title": "Saludadores",
      "greeters.body": "{count, plural, one {# persona ha} other {# personas han}} saludado.",
      "greeters.settings": "Cambiar el saludo",
      "about.link": "Acerca de Hello",
    }),
  },
  publicRoutes: { "/about": About },
  homePanels: { greeters: HomePanel },
  slots: {
    organizerPanel: OrganizerPanel,
    judgingPanel: ApplausePanel,
    sessionPanel: GreetingPanel,
  },
  actions: {
    wave: ({ session }) => console.log(`Hello, ${session.profile?.display_name ?? "there"}!`),
  },
});
