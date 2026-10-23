import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isOrgAdmin } from "@bogey/db/auth";
import { usePreference } from "@bogey/db/queries/preferences";
import { eventsQueryOptions } from "@bogey/db/queries/events";
import { updateProfileFn, type ProfileChanges } from "@bogey/db/queries/profile";
import { unwrap } from "@bogey/db/errors";
import { msg, useT, type PlainKey } from "#/lib/translate.tsx";
import { localizationQueryOptions, setLanguageFn } from "#/lib/i18n.ts";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { SearchSelect } from "@bogey/ui/components/search-select";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import { detectedTimezone, timezoneOptions } from "#/lib/timezone.ts";
import { previewTheme, useTheme, type Theme } from "#/lib/theme.ts";
import { useSessionRefresh } from "#/lib/refresh.ts";
import { useClockPreference } from "#/lib/time.ts";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { HOME_PREFERENCE, isHomeChoice, type HomeChoice } from "#/lib/home.ts";

export const Route = createFileRoute("/_authed/account/preferences")({
  staticData: {
    title: msg("accountNav.preferences"),
    settings: (t) => [
      searchSection(t("prefs.section"), { id: "time-and-appearance" }),
      searchSection(t("prefs.homeSection"), { id: "home-page" }),
      { label: t("account.language"), hash: "prefs.language", keywords: ["locale", "translate"] },
      { label: t("prefs.timezone"), hash: "prefs.timezone" },
      { label: t("prefs.clock24"), hash: "prefs.clock24h", keywords: ["clock"] },
      { label: t("prefs.theme"), hash: "prefs.theme", keywords: ["dark mode", "light mode"] },
      { label: t("prefs.home"), hash: "prefs.home", keywords: ["start page", "logo", "landing"] },
    ],
  },
  component: RouteComponent,
});

const THEMES: Tuple<{ value: Theme; label: PlainKey }> = [
  { value: "system", label: "prefs.themeSystem" },
  { value: "light", label: "prefs.themeLight" },
  { value: "dark", label: "prefs.themeDark" },
];

function useSaveProfile() {
  const refreshSession = useSessionRefresh();
  return useMutation({
    mutationFn: async (changes: ProfileChanges) => unwrap(await updateProfileFn({ data: changes })),
    onSuccess: refreshSession,
  });
}

function LanguageField() {
  const t = useT();
  const queryClient = useQueryClient();
  const router = useRouter();
  const refreshSession = useSessionRefresh();
  const { session } = Route.useRouteContext();
  const localization = useQuery(localizationQueryOptions());
  const languages = localization.data?.languages ?? [];
  const [language, setLanguage] = useDraft(
    session.profile?.locale ?? localization.data?.locale ?? "en",
    async (next) => {
      try {
        unwrap(await updateProfileFn({ data: { locale: next } }));
        await setLanguageFn({ data: next });
        await refreshSession();
        await queryClient.invalidateQueries({ queryKey: localizationQueryOptions().queryKey });
        await router.invalidate();
        return true;
      } catch {
        return false;
      }
    },
  );
  if (languages.length < 2) return null;
  return (
    <Field id="prefs.language" className="jump-target">
      <FieldLabel htmlFor="language">{t("account.language")}</FieldLabel>
      <OptSelect
        id="language"
        value={language}
        options={languages.map((each) => ({ value: each.code, label: each.label }))}
        onChange={setLanguage}
      />
      <FieldDescription>{t("account.languageHelp")}</FieldDescription>
    </Field>
  );
}

function HomeField() {
  const t = useT();
  const { session } = Route.useRouteContext();
  const home = usePreference<HomeChoice>(
    HOME_PREFERENCE.namespace,
    HOME_PREFERENCE.key,
    "default",
    isHomeChoice,
  );
  const events = useQuery({
    ...eventsQueryOptions(session.org?.id ?? ""),
    enabled: Boolean(session.org),
  });
  const orgAdmin = isOrgAdmin(session);
  const mine = (events.data ?? []).filter((event) => orgAdmin || event.myRole !== null);
  const options: { value: HomeChoice; label: string }[] = [
    {
      value: "default",
      label: t("prefs.homeDefault", {
        place: session.platformAdmin ? t("prefs.homeAdmin") : t("prefs.homeEvents"),
      }),
    },
    { value: "events", label: t("prefs.homeEvents") },
    ...(orgAdmin ? [{ value: "org" as const, label: t("prefs.homeOrg") }] : []),
    ...(session.platformAdmin ? [{ value: "admin" as const, label: t("prefs.homeAdmin") }] : []),
    ...mine.map((event) => ({ value: `event:${event.id}` as const, label: event.name })),
  ];
  // a pick that's gone (left the event) shows as the default, which is where "/" sends them
  const value = options.some((option) => option.value === home.value) ? home.value : "default";
  return (
    <Field id="prefs.home" className="jump-target">
      <FieldLabel htmlFor="home">{t("prefs.home")}</FieldLabel>
      <OptSelect id="home" value={value} options={options} onChange={home.set} />
      <FieldDescription>{t("prefs.homeHelp")}</FieldDescription>
      <ErrorAlert
        error={home.error instanceof Error ? home.error : null}
        title={t("prefs.saveFailed")}
      />
    </Field>
  );
}

function RouteComponent() {
  const t = useT();
  const { session } = Route.useRouteContext();
  const timezone = session.profile?.timezone ?? null;
  const clock = useClockPreference();
  const save = useSaveProfile();
  const { theme, setTheme } = useTheme();
  const detected = detectedTimezone();
  const [zone, setZone] = useDraft(timezone ?? detected, async (next) => {
    try {
      await save.mutateAsync({ timezone: next });
      return true;
    } catch {
      return false;
    }
  });
  const [chosen, choose] = useDraft(theme, async (next) => {
    setTheme(next);
    return true;
  });
  useEffect(() => {
    if (chosen === theme) return;
    previewTheme(chosen);
    return () => previewTheme(null);
  }, [chosen, theme]);

  return (
    <Screen title={t("accountNav.preferences")} width="embedded">
      <Screen.Section id="time-and-appearance" title={t("prefs.section")}>
        <LanguageField />
        <Field id="prefs.timezone" className="jump-target">
          <FieldLabel htmlFor="timezone">{t("prefs.timezone")}</FieldLabel>
          <SearchSelect
            id="timezone"
            value={zone}
            options={timezoneOptions(detected)}
            onValueChange={(next) => next && setZone(next)}
          />
          <FieldDescription>{t("prefs.timezoneHelp")}</FieldDescription>
        </Field>
        <Field id="prefs.clock24h" orientation="horizontal" className="jump-target justify-between">
          <FieldLabel htmlFor="clock-24h">{t("prefs.clock24")}</FieldLabel>
          <Switch
            id="clock-24h"
            checked={clock.value}
            onCheckedChange={(checked) => clock.set(checked)}
          />
        </Field>
        <Field id="prefs.theme" className="jump-target">
          <FieldLabel htmlFor="theme">{t("prefs.theme")}</FieldLabel>
          <OptSelect
            id="theme"
            value={chosen}
            options={THEMES.map((each) => ({ ...each, label: t(each.label) }))}
            onChange={choose}
          />
        </Field>
        <ErrorAlert error={save.error} title={t("prefs.saveFailed")} />
      </Screen.Section>
      <Screen.Section id="home-page" title={t("prefs.homeSection")}>
        <HomeField />
      </Screen.Section>
    </Screen>
  );
}
