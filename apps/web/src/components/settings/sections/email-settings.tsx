import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { updateSettings } from "@bogey/db/queries/settings";
import {
  AUTH_EMAIL_KEYS,
  EMAIL_KINDS,
  EMAIL_KIND_KEYS,
  emailTemplateProblem,
  type EmailKind,
  type EmailTemplateKey,
} from "@bogey/config/email";
import type { SettingsValue } from "@bogey/config/settings";
import { DEFAULT_EMAIL_LAYOUT, layoutProblem } from "@bogey/utils/email-layout";
import { pluginLocales } from "@bogey/plugins";
import { localizedTemplateKey, renderEmail, templateVariables } from "@bogey/utils/email-template";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { IconAlertTriangle, IconCircleCheck, IconSend } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { Spinner } from "@bogey/ui/components/spinner";
import { toast } from "@bogey/ui/components/toast";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import {
  emailHookStatusQueryOptions,
  emailTranslationsQueryOptions,
  sendTestEmailFn,
  type TranslatedEmail,
} from "#/lib/email-admin.ts";
import { searchSection, type SettingsSearchEntry } from "../layout/search-entries.ts";
import { sayOr, useT, type T } from "#/lib/translate.tsx";

const subjectSchema = (t: T) =>
  z
    .string()
    .trim()
    .max(150, t("form.maxLength", { max: 150 }))
    .meta({ label: t("email.subject") });

export interface EmailKindEntry {
  key: string;
  kind: EmailKind;
}

const coreEntries = (keys: Tuple<EmailTemplateKey>): Tuple<EmailKindEntry> =>
  keys.map((key) => ({ key, kind: EMAIL_KINDS[key] }));

export function emailKindEntries(pluginKinds: Tuple<EmailKindEntry> = []): Tuple<EmailKindEntry> {
  // sign-in emails carry codes and links, so only bogey.config.ts can change them
  const auth: Tuple<string> = AUTH_EMAIL_KEYS;
  return [...coreEntries(EMAIL_KIND_KEYS.filter((key) => !auth.includes(key))), ...pluginKinds];
}

export function emailSearchEntries(
  scope: Scope["scope"],
  t: T,
  pluginKinds: Tuple<EmailKindEntry> = [],
): SettingsSearchEntry[] {
  return [
    searchSection(t("email.title"), { keywords: ["sender name", "from"], id: "email" }),
    ...(scope === "instance"
      ? [
          searchSection(t("email.layout"), {
            keywords: ["html", "template"],
            id: "layout",
          }),
        ]
      : []),
    ...emailKindEntries(pluginKinds).map(({ key, kind }) =>
      searchSection(kindName(t, key, kind), {
        description: kindHelp(t, key, kind),
        keywords: ["email", "subject"],
        id: key,
      }),
    ),
  ];
}

function kindName(t: T, key: string, kind: EmailKind): string {
  return sayOr(t, `emailKind.${key}`, kind.label);
}

function kindHelp(t: T, key: string, kind: EmailKind): string {
  return sayOr(t, `emailKind.${key}.help`, kind.description);
}

function templatesSchema(entries: Tuple<EmailKindEntry>, t: T) {
  return z
    .array(
      z.object({
        subject: subjectSchema(t),
        body: z
          .string()
          .max(5000, t("form.maxLength", { max: 5000 }))
          .meta({ label: t("compose.message") }),
      }),
    )
    .superRefine((rows, context) => {
      rows.forEach((row, index) => {
        const requires = entries[index]?.kind.requires ?? [];
        const used = templateVariables(row.body);
        if (
          row.body.trim() &&
          requires.length > 0 &&
          !requires.some((name) => used.includes(name))
        ) {
          context.addIssue({
            code: "custom",
            path: [index, "body"],
            message: t("email.mustInclude", {
              names: requires.map((name) => `{{${name}}}`).join(` ${t("email.or")} `),
            }),
          });
        }
      });
    });
}

function settingsSchema(entries: Tuple<EmailKindEntry>, t: T) {
  return z.object({
    senderName: z
      .string()
      .trim()
      .max(60, t("form.maxLength", { max: 60 }))
      .meta({ label: t("email.senderName") })
      .describe(t("email.senderNameHelp")),
    layout: z
      .string()
      .max(50_000, t("form.maxLength", { max: 50_000 }))
      .refine((value) => !value.trim() || layoutProblem(value) === null, {
        message: t("email.layoutProblem"),
      })
      .meta({ label: t("email.html"), placeholder: DEFAULT_EMAIL_LAYOUT })
      .describe(t("email.htmlHelp")),
    templates: templatesSchema(entries, t),
  });
}

type Scope =
  | { scope: "instance" }
  | { scope: "org"; orgId: string }
  | { scope: "event"; eventId: string };

function HookStatus() {
  const t = useT();
  const { data } = useQuery(emailHookStatusQueryOptions());
  if (!data) return null;
  if (!data.lastAt) {
    return (
      <Alert>
        <IconAlertTriangle />
        <AlertTitle>{t("email.noneYet")}</AlertTitle>
        <AlertDescription>
          {t("email.noneYetHelp")}{" "}
          <a
            href="https://github.com/0xethen/bogey/wiki/self-hosting-email"
            target="_blank"
            rel="noreferrer noopener"
            className="link"
          >
            {t("email.noneYetHelpLink")}
          </a>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <IconCircleCheck />
      <AlertTitle>{t("email.goingThrough")}</AlertTitle>
      <AlertDescription>
        {t("email.lastWas")} <RelativeTime value={data.lastAt} />,{" "}
        {t("email.lastDay", { count: data.last24h })} {t("email.appliesNext")}
      </AlertDescription>
    </Alert>
  );
}

function EmailPreview({
  kind,
  reason,
  layout,
  subject: subjectTemplate,
  body: bodyTemplate,
  orgName,
  platform,
}: {
  kind: EmailKind;
  reason: string;
  layout: string;
  subject: string;
  body: string;
  orgName: string;
  platform: string;
}) {
  const t = useT();
  const rendered = useMemo(() => {
    const examples = Object.fromEntries(
      kind.variables.map((variable) => [variable.name, variable.example]),
    );
    return renderEmail({
      layout,
      fallbackLayout: DEFAULT_EMAIL_LAYOUT,
      subject: subjectTemplate,
      body: bodyTemplate,
      org: orgName,
      platform,
      reason,
      values: { ...examples, org: orgName, platform },
    });
  }, [kind, reason, layout, subjectTemplate, bodyTemplate, orgName, platform]);
  return (
    <figure className="flex flex-col gap-2 rounded-2xl border border-dashed border-border p-4">
      <figcaption className="text-xs font-medium tracking-wide text-muted-fg uppercase">
        {t("email.preview")}
      </figcaption>
      <p className="text-sm font-medium">{rendered.subject}</p>
      <iframe
        title={t("email.previewOf", { kind: kind.label })}
        sandbox=""
        srcDoc={rendered.html}
        className="h-[28rem] w-full rounded-xl border border-border bg-white"
      />
    </figure>
  );
}

function SendTest({
  kind,
  orgId,
  eventId,
  locale,
}: {
  kind: string;
  orgId?: string;
  eventId?: string;
  locale?: string;
}) {
  const t = useT();
  const send = useMutation({
    mutationFn: async () => {
      const result = await sendTestEmailFn({
        data: {
          kind,
          ...(orgId ? { orgId } : {}),
          ...(eventId ? { eventId } : {}),
          ...(locale ? { locale } : {}),
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: ({ to }) =>
      toast.add({ title: t("email.testSent"), description: t("email.checkInbox", { to }) }),
    onError: (error) =>
      toast.add({ title: t("email.testFailed"), description: error.message, type: "error" }),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="self-start"
      disabled={send.isPending}
      onClick={() => send.mutate()}
    >
      {send.isPending ? <Spinner /> : <IconSend />}
      {t("email.sendTest")}
    </Button>
  );
}

interface EmailSettingsProps {
  scope: Scope;
  current: Partial<SettingsValue<"email">>;
  inheritedLayout?: string | undefined;
  orgName: string;
  platform: string;
  pluginKinds?: Tuple<EmailKindEntry>;
}

export function EmailSettings(props: EmailSettingsProps) {
  const [language, setLanguage] = useState("");
  const translations = useQuery({
    ...emailTranslationsQueryOptions(language),
    enabled: language !== "",
  });
  return (
    <EmailSettingsForm
      key={language}
      {...props}
      language={language}
      onLanguage={setLanguage}
      translations={language ? (translations.data ?? {}) : {}}
    />
  );
}

function EmailSettingsForm({
  scope,
  current,
  inheritedLayout,
  orgName,
  platform,
  pluginKinds = [],
  language,
  onLanguage,
  translations,
}: EmailSettingsProps & {
  language: string;
  onLanguage: (language: string) => void;
  translations: Readonly<Record<string, TranslatedEmail>>;
}) {
  const t = useT();
  const languages = pluginLocales();
  const queryClient = useQueryClient();
  const templates = current.templates ?? {};
  const instance = scope.scope === "instance";
  const entries = useMemo(() => emailKindEntries(pluginKinds), [pluginKinds]);
  const schema = useMemo(() => settingsSchema(entries, t), [entries, t]);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        senderName: current.senderName ?? "",
        layout: current.layout ?? "",
        templates: entries.map(({ key }) => ({
          subject: templates[localizedTemplateKey(key, language)]?.subject ?? "",
          body: templates[localizedTemplateKey(key, language)]?.body ?? "",
        })),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const picked: Record<string, { subject: string; body: string }> = {};
      for (const [index, { key, kind }] of entries.entries()) {
        const template = {
          subject: value.templates[index]?.subject.trim() ?? "",
          body: value.templates[index]?.body.trim() ?? "",
        };
        if (!template.subject || !template.body) continue;
        const problem = emailTemplateProblem(kind, template);
        if (problem) return createValidationError(`${kind.label}: ${problem}`);
        picked[localizedTemplateKey(key, language)] = template;
      }
      const edited = new Set(entries.map(({ key }) => localizedTemplateKey(key, language)));
      const merged = {
        ...Object.fromEntries(Object.entries(templates).filter(([key]) => !edited.has(key))),
        ...picked,
      };
      const result = await updateSettings(scope, "email", {
        templates: Object.keys(merged).length ? merged : null,
        ...(language ? {} : { senderName: value.senderName.trim() || null }),
        ...(instance && !language ? { layout: value.layout.trim() || null } : {}),
      });
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(value);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-10">
        <Screen.Section id="email" title={t("email.title")} description={t("email.intro")}>
          {instance && <HookStatus />}
          {instance && <p className="text-sm text-muted-fg">{t("email.authInConfig")}</p>}
          {languages.length > 0 && (
            <form.Subscribe selector={(state) => state.isDirty}>
              {(dirty) => (
                <div className="flex flex-col gap-1.5">
                  <OptSelect
                    ariaLabel={t("email.language")}
                    value={language || "default"}
                    disabled={dirty}
                    options={[
                      { value: "default", label: t("email.languageDefault") },
                      ...languages.map((each) => ({ value: each.code, label: each.label })),
                    ]}
                    onChange={(next) => onLanguage(next === "default" ? "" : next)}
                  />
                  <p className="text-sm text-muted-fg">
                    {dirty ? t("email.languageSaveFirst") : t("email.languageHelp")}
                  </p>
                </div>
              )}
            </form.Subscribe>
          )}
          {!language && (
            <form.Field name="senderName">
              {(field) => (
                <field.TextField placeholder={scope.scope === "org" ? orgName : platform} />
              )}
            </form.Field>
          )}
        </Screen.Section>

        {instance && !language && (
          <Screen.Section id="layout" title={t("email.layout")} description={t("email.layoutHelp")}>
            <form.Field name="layout">{(field) => <field.TextAreaField rows={16} />}</form.Field>
          </Screen.Section>
        )}

        {entries.map(({ key, kind }, index) => {
          const fallback = translations[key] ?? kind.defaults;
          return (
            <Screen.Section
              key={key}
              id={key}
              title={kindName(t, key, kind)}
              description={kindHelp(t, key, kind)}
            >
              <form.Field name={`templates[${index}].subject`}>
                {(field) => <field.TextField placeholder={fallback.subject} />}
              </form.Field>
              <form.Field name={`templates[${index}].body`}>
                {(field) => (
                  <field.MarkdownField
                    rows={9}
                    preview={false}
                    placeholder={fallback.body}
                    description={t("email.bodyHelp", {
                      variables: kind.variables
                        .map((variable) => `{{${variable.name}}}`)
                        .join(", "),
                    })}
                  />
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values}>
                {(values) => (
                  <EmailPreview
                    kind={kind}
                    reason={translations[key]?.reason ?? kind.reason}
                    layout={
                      (instance ? values.layout.trim() : inheritedLayout) || DEFAULT_EMAIL_LAYOUT
                    }
                    subject={values.templates[index]?.subject.trim() || fallback.subject}
                    body={values.templates[index]?.body.trim() || fallback.body}
                    orgName={orgName}
                    platform={platform}
                  />
                )}
              </form.Subscribe>
              <SendTest
                kind={key}
                {...(scope.scope === "org"
                  ? { orgId: scope.orgId }
                  : scope.scope === "event"
                    ? { eventId: scope.eventId }
                    : {})}
                {...(language ? { locale: language } : {})}
              />
            </Screen.Section>
          );
        })}

        <form.FormAlert title={t("email.saveFailed")} />
      </form.Form>
    </form.AppForm>
  );
}
