import { z } from "zod";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  certificateTemplatesQueryOptions,
  eventCertificatesQueryOptions,
  issueCertificatesFn,
  revokeCertificateFn,
  saveCertificateTemplateFn,
  type Certificate,
  type CertificateTemplate,
} from "@bogey/db/queries/certificates";
import { requestFailure, unwrap } from "@bogey/db/errors";
import {
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  CERTIFICATE_VARIABLES,
  DEFAULT_CERTIFICATE_BODY,
  type CertificateKind,
} from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Panel } from "@bogey/ui/components/panel";
import { Screen } from "@bogey/ui/components/screen";
import { toast } from "@bogey/ui/components/toast";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { CertificateSheet } from "#/components/event/certificate-sheet.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, sayOr, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/certificates")({
  staticData: {
    title: msg("certificates.title"),
    settings: (t) => [
      searchSection(t("certificates.title"), {
        id: "certificates",
        keywords: ["award", "participation", "print"],
      }),
      ...searchSettings("certificates", ["enabled"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "certificates",
      ]),
      context.query.ensureQueryData(certificateTemplatesQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventCertificatesQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const wordingSchema = (t: T) =>
  z.object({
    body: z
      .string()
      .max(5000, t("form.maxLength", { max: 5000 }))
      .meta({ label: t("manageCerts.wording") })
      .describe(t("manageCerts.wordingHelp")),
    orientation: z.enum(["landscape", "portrait"]).meta({ label: t("manageCerts.orientation") }),
    background: z
      .string()
      .trim()
      .refine((value) => value === "" || (value.startsWith("https://") && URL.canParse(value)), {
        message: t("webhooks.needHttps"),
      })
      .meta({
        label: t("manageCerts.background"),
        placeholder: t("manageCerts.backgroundPlaceholder"),
      }),
  });

const orientations = (t: T) =>
  [
    {
      value: "landscape",
      label: t("manageCerts.landscape", { width: "297 mm", height: "210 mm" }),
    },
    { value: "portrait", label: t("manageCerts.portrait", { width: "210 mm", height: "297 mm" }) },
  ] as const;

function Wording({
  kind,
  saved,
  eventId,
  orgId,
}: {
  kind: CertificateKind;
  saved: CertificateTemplate | undefined;
  eventId: string;
  orgId: string;
}) {
  const t = useT();
  const schema = useMemo(() => wordingSchema(t), [t]);
  const kindName = sayOr(t, `certKind.${kind}`, CERTIFICATE_LABELS[kind]);
  const queryClient = useQueryClient();
  const standard = {
    body: DEFAULT_CERTIFICATE_BODY[kind],
    orientation: "landscape",
    background: "",
  } as const;
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        body: saved?.body_md ?? DEFAULT_CERTIFICATE_BODY[kind],
        orientation: saved?.orientation === "portrait" ? "portrait" : "landscape",
        background: saved?.background_url ?? "",
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await saveCertificateTemplateFn({
        data: { orgId, eventId, kind, ...value },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      toast.add({ title: t("manageCerts.saved") });
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
      return undefined;
    },
  });
  const useStandard = useMutation({
    mutationFn: async () =>
      unwrap(
        await saveCertificateTemplateFn({
          data: { orgId, eventId, kind, body: "", orientation: "landscape", background: "" },
        }),
      ),
    onSuccess: async () => {
      form.reset(standard);
      toast.add({ title: t("manageCerts.backToStandard") });
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
    },
  });
  return (
    <Panel size="sm" title={kindName}>
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-3">
          <form.Field name="body">
            {(field) => (
              <field.Field>
                <field.Label className="sr-only">
                  {t("manageCerts.wordingOf", { kind: kindName })}
                </field.Label>
                <field.TextArea rows={7} className="font-mono text-xs" />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <div className="flex flex-wrap items-start gap-2">
            <form.Field name="orientation">
              {(field) => (
                <field.Field className="w-40">
                  <field.Label className="sr-only" />
                  <FieldSelect field={field} options={orientations(t)} />
                </field.Field>
              )}
            </form.Field>
            <form.Field name="background">
              {(field) => (
                <field.Field className="min-w-64 flex-1">
                  <field.Label className="sr-only" />
                  <field.TextInput type="url" />
                  <field.Error />
                </field.Field>
              )}
            </form.Field>
          </div>
          <form.FormAlert />
          <ErrorAlert error={useStandard.error} />
          {saved && (
            <div>
              <Button
                type="button"
                variant="ghost"
                disabled={useStandard.isPending}
                onClick={() => useStandard.mutate()}
              >
                {t("manageCerts.useStandard")}
              </Button>
            </div>
          )}
        </form.Form>
      </form.AppForm>
    </Panel>
  );
}

function Issued({
  certificates,
  eventId,
}: {
  certificates: readonly Certificate[];
  eventId: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: async (code: string) => unwrap(await revokeCertificateFn({ data: code })),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["certificates", "event", eventId] }),
  });
  return (
    <Panel
      title={t("manageCerts.issued")}
      description={t("manageCerts.soFar", { count: certificates.length })}
    >
      <ErrorAlert error={revoke.error} />
      <ul className="divide-y divide-border text-sm">
        {certificates.map((certificate) => (
          <li
            key={certificate.code}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <span>
              {certificate.name},{" "}
              {sayOr(
                t,
                `certKind.${certificate.kind}`,
                CERTIFICATE_LABELS[certificate.kind],
              ).toLowerCase()}
              {certificate.label ? ` (${certificate.label})` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              confirm={{
                title: t("manageCerts.withdrawTitle", { name: certificate.name }),
                description: t("manageCerts.withdrawBody"),
                label: t("manageCerts.withdrawLabel"),
              }}
              onClick={() => revoke.mutate(certificate.code)}
            >
              {t("manageCerts.withdraw")}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  const queryClient = useQueryClient();
  const { data: templates } = useSuspenseQuery(certificateTemplatesQueryOptions(event.id));
  const { data: issued } = useSuspenseQuery(eventCertificatesQueryOptions(event.id));
  const issue = useMutation({
    mutationFn: async () => unwrap(await issueCertificatesFn({ data: event.id })),
    onSuccess: async (count) => {
      toast.add({
        title: count === 0 ? t("manageCerts.everyoneHas") : t("manageCerts.issuedCount", { count }),
      });
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
    },
  });
  const [printing, setPrinting] = useState(false);
  return (
    <Screen
      title={t("certificates.title")}
      description={t("manageCerts.intro")}
      width="embedded"
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            confirm={{
              title: t("manageCerts.issueTitle"),
              description: t("manageCerts.issueBody"),
              label: t("manageCerts.issueLabel"),
              variant: "default",
            }}
            disabled={issue.isPending}
            onClick={() => issue.mutate()}
          >
            {t("manageCerts.issueAll")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={issued.length === 0}
            onClick={() => {
              setPrinting(true);
              setTimeout(() => {
                window.print();
                setPrinting(false);
              }, 100);
            }}
          >
            {t("manageCerts.printAll")}
          </Button>
        </>
      }
    >
      <ErrorAlert error={issue.error} />
      <Screen.Section id="certificates" title={t("certificates.title")}>
        <SettingFields scope={scope} namespace="certificates" keys={["enabled"]} />
      </Screen.Section>
      <Screen.Section
        id="wording"
        title={t("manageCerts.wording")}
        description={t("manageCerts.wordingIntro", {
          variables: Object.keys(CERTIFICATE_VARIABLES)
            .map((name) => `{{${name}}}`)
            .join(", "),
        })}
      >
        {CERTIFICATE_KINDS.map((kind) => (
          <Wording
            key={kind}
            kind={kind}
            saved={templates.find((template) => template.kind === kind)}
            eventId={event.id}
            orgId={event.org_id}
          />
        ))}
      </Screen.Section>
      {issued.length > 0 && <Issued certificates={issued} eventId={event.id} />}
      {printing && (
        <div data-print-area className="hidden print:block">
          {issued.map((certificate) => (
            <CertificateSheet key={certificate.code} certificate={certificate} />
          ))}
        </div>
      )}
      <PluginSettingSections page="certificates" />
    </Screen>
  );
}
