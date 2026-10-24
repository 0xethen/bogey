import { createFileRoute } from "@tanstack/react-router";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import {
  FONTS,
  SPOILER_MODES,
  TEXT_SIZES,
  useCodeLineNumbersPreference,
  useFontPreference,
  useMoreContrastPreference,
  useReduceMotionPreference,
  useSpoilerPreference,
  useTextSizePreference,
  useUnderlineLinksPreference,
  useWideSpacingPreference,
} from "#/lib/accessibility.tsx";
import { msg, useT, type PlainKey } from "#/lib/translate.tsx";
import { SettingRow } from "#/components/settings/fields/setting-fields.tsx";

const SWITCHES = [
  { id: "reduce-motion", label: "a11y.motion", description: "a11y.motionHelp" },
  { id: "more-contrast", label: "a11y.contrast", description: "a11y.contrastHelp" },
  { id: "wide-spacing", label: "a11y.spacing", description: "a11y.spacingHelp" },
  { id: "underline-links", label: "a11y.underline", description: "a11y.underlineHelp" },
  { id: "code-line-numbers", label: "a11y.lineNumbers", description: "a11y.lineNumbersHelp" },
] as const satisfies Tuple<{ id: string; label: PlainKey; description: PlainKey }>;

export const Route = createFileRoute("/_authed/account/accessibility")({
  staticData: {
    title: msg("accountNav.accessibility"),
    settings: (t) => [
      { label: t("a11y.textSize"), hash: "a11y.textSize", keywords: ["zoom", "bigger"] },
      { label: t("a11y.font"), hash: "a11y.font", keywords: ["dyslexia", "hyperlegible"] },
      { label: t("a11y.spoilers"), hash: "a11y.spoilers" },
      ...SWITCHES.map(({ id, label, description }) => ({
        label: t(label),
        description: t(description),
        hash: `a11y.${id}`,
      })),
    ],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const size = useTextSizePreference();
  const font = useFontPreference();
  const spoilers = useSpoilerPreference();

  const motion = useReduceMotionPreference();
  const contrast = useMoreContrastPreference();
  const spacing = useWideSpacingPreference();
  const links = useUnderlineLinksPreference();
  const lineNumbers = useCodeLineNumbersPreference();

  const preferences = {
    "reduce-motion": motion,
    "more-contrast": contrast,
    "wide-spacing": spacing,
    "underline-links": links,
    "code-line-numbers": lineNumbers,
  };

  const mode = SPOILER_MODES.find((item) => item.value === spoilers.value);
  const named = <O extends { label: PlainKey }>(options: Tuple<O>) =>
    options.map((option) => ({ ...option, label: t(option.label) }));

  return (
    <Screen title={t("accountNav.accessibility")} description={t("a11y.intro")} width="embedded">
      <div className="flex flex-col gap-4">
        <SettingRow
          id="text-size"
          anchor="a11y.textSize"
          label={t("a11y.textSize")}
          description={t("a11y.textSizeHelp")}
          layout="row"
        >
          <OptSelect
            id="text-size"
            value={size.value}
            options={named(TEXT_SIZES)}
            onChange={size.set}
          />
        </SettingRow>
        <SettingRow
          id="font"
          anchor="a11y.font"
          label={t("a11y.font")}
          description={t("a11y.fontHelp")}
          layout="row"
        >
          <OptSelect id="font" value={font.value} options={named(FONTS)} onChange={font.set} />
        </SettingRow>
        <SettingRow
          id="spoilers"
          anchor="a11y.spoilers"
          label={t("a11y.spoilers")}
          description={
            <>
              {mode ? t(mode.description) : null} {t("a11y.spoilersHelp")}
            </>
          }
          layout="row"
        >
          <OptSelect
            id="spoilers"
            value={spoilers.value}
            options={named(SPOILER_MODES)}
            onChange={spoilers.set}
          />
        </SettingRow>
        {SWITCHES.map((item) => (
          <SettingRow
            key={item.id}
            id={item.id}
            anchor={`a11y.${item.id}`}
            label={t(item.label)}
            description={t(item.description)}
            layout="switch"
          >
            <Switch
              id={item.id}
              checked={preferences[item.id].value}
              onCheckedChange={(checked) => preferences[item.id].set(checked)}
            />
          </SettingRow>
        ))}
        {[size, font, spoilers, lineNumbers, spacing, motion, links, contrast].map(
          (preference, index) => (
            <ErrorAlert
              key={index}
              error={preference.error instanceof Error ? preference.error : null}
              title={t("a11y.saveFailed")}
            />
          ),
        )}
      </div>
    </Screen>
  );
}
