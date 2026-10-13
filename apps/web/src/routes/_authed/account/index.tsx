import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { IconPlus, IconX } from "@tabler/icons-react";
import { z } from "zod";
import {
  accountDeletionQueryOptions,
  cancelAccountDeletionFn,
  portfoliosEnabledQueryOptions,
  requestAccountDeletionFn,
  updateProfileFn,
  type Profile,
} from "@bogey/db/queries/profile";
import { requestFailure, unwrap } from "@bogey/db/errors";
import {
  kindForUrl,
  linksFromJson,
  MAX_PROFILE_LINKS,
  PROFILE_LINK_KINDS,
  profileLinkProblem,
} from "@bogey/utils/profile-links";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import {
  errorVisibility,
  fieldHelp,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { signOutDialog } from "#/components/app/SignOutDialog.tsx";
import { profileLinkOptions } from "#/components/profile/link-kinds.tsx";
import { useSessionRefresh } from "#/lib/refresh.ts";
import { searchFields, searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, type T, useHelperSay, useT } from "#/lib/translate.tsx";
import { sayEnglish, type Say } from "@bogey/utils/messages";

const nameSchema = (t: T) =>
  z.object({
    displayName: z
      .string()
      .trim()
      .min(1, t("form.enterName"))
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("profile.name") })
      .describe(t("profile.nameHelp")),
  });

const deletionSchema = (t: T) =>
  z.object({
    reason: z
      .string()
      .trim()
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("profile.deleteLabel"), placeholder: t("profile.deletePlaceholder") })
      .describe(t("profile.deleteHelp")),
  });

const portfolioSchema = (t: T, say: Say = sayEnglish) =>
  z.object({
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .max(32, t("form.maxLength", { max: 32 }))
      .refine((value) => value === "" || /^[a-z0-9_]{2,32}$/.test(value), t("profile.handleRule"))
      .meta({ label: t("profile.handle"), placeholder: "ada" })
      .register(fieldHelp, (handle) =>
        t("profile.handleHelp", { username: handle.trim().toLowerCase() || "ada" }),
      ),
    pronouns: z
      .string()
      .trim()
      .max(30, t("form.maxLength", { max: 30 }))
      .meta({ label: t("profile.pronouns"), placeholder: t("profile.pronounsPlaceholder") }),
    bio: z
      .string()
      .trim()
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("profile.bio"), placeholder: t("profile.bioPlaceholder") }),
    links: z
      .array(
        z.object({
          uid: z.string(),
          kind: z.enum(PROFILE_LINK_KINDS).meta({ label: t("profile.linkPlatform") }),
          url: z
            .string()
            .superRefine((value, context) => {
              const problem = profileLinkProblem(value, say);
              if (problem) context.addIssue({ code: "custom", message: problem });
            })
            .meta({ label: t("profile.linkAddress"), placeholder: "https://" }),
        }),
      )
      .max(MAX_PROFILE_LINKS)
      .meta({ label: t("profile.links") })
      .describe(t("profile.linksHelp")),
    visibility: z.enum(["org", "public"]).meta({ label: t("profile.visibility") }),
  });

export const Route = createFileRoute("/_authed/account/")({
  staticData: {
    title: msg("accountNav.profile"),
    settings: (t) => [
      ...searchFields(nameSchema(t), t("profile.nameTitle"), "your-name"),
      ...searchFields(portfolioSchema(t), t("profile.pageTitle"), "your-public-page"),
      searchSection(t("profile.signOut"), { keywords: ["log out"], id: "sign-out" }),
      searchSection(t("profile.danger"), {
        keywords: ["delete account", "remove"],
        id: "danger-zone",
      }),
    ],
  },
  validateSearch: z.object({ mfa: z.literal("admin").optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    if (search.mfa) throw Route.redirect({ to: "/account/security", search, replace: true });
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(accountDeletionQueryOptions()),
      context.query.ensureQueryData(portfoliosEnabledQueryOptions()),
    ]),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { session } = Route.useRouteContext();
  return (
    <Screen
      title={t("accountNav.profile")}
      description={session.user.email ?? undefined}
      width="embedded"
    >
      <NameSection initial={session.profile?.display_name ?? ""} />
      <PortfolioSection profile={session.profile} />
      <Screen.Section
        id="sign-out"
        title={t("profile.signOut")}
        description={t("profile.signOutHelp")}
      >
        <div>
          <Button variant="secondary" onClick={() => signOutDialog.open(null)}>
            {t("nav.signOut")}
          </Button>
        </div>
      </Screen.Section>
      <DangerZone />
    </Screen>
  );
}

function NameSection({ initial }: { initial: string }) {
  const t = useT();
  const schema = useMemo(() => nameSchema(t), [t]);
  const refreshSession = useSessionRefresh();
  const form = useAppForm({
    defaultValues: { displayName: initial },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await updateProfileFn({ data: { displayName: value.displayName } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(value);
      await refreshSession();
      return undefined;
    },
  });

  return (
    <Screen.Section
      id="your-name"
      title={t("profile.nameTitle")}
      description={t("profile.nameHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-3">
          <form.Field name="displayName">
            {(field) => (
              <field.Field>
                <field.Label className="sr-only" />
                <field.TextInput maxLength={80} autoComplete="name" />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.FormAlert title={t("profile.nameFailed")} />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

const newUid = (): string => crypto.randomUUID();

function PortfolioSection({ profile }: { profile: Profile | null }) {
  const { data: enabled } = useSuspenseQuery(portfoliosEnabledQueryOptions());
  return enabled ? <PortfolioForm profile={profile} /> : null;
}

function PortfolioForm({ profile }: { profile: Profile | null }) {
  const t = useT();
  const say = useHelperSay();
  const schema = useMemo(() => portfolioSchema(t, say), [t, say]);
  const kinds = useMemo(() => profileLinkOptions(t), [t]);
  const refreshSession = useSessionRefresh();
  const form = useAppForm({
    defaultValues: {
      handle: profile?.handle ?? "",
      pronouns: profile?.pronouns ?? "",
      bio: profile?.bio_md ?? "",
      links: linksFromJson(profile?.links).map((link) => ({ uid: newUid(), ...link })),
      visibility: profile?.visibility === "public" ? ("public" as const) : ("org" as const),
    },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await updateProfileFn({
        data: {
          handle: value.handle || null,
          pronouns: value.pronouns || null,
          bio: value.bio,
          links: value.links.map(({ kind, url }) => ({ kind, url: url.trim() })),
          visibility: value.visibility,
        },
      }).catch(requestFailure);
      if (!result.ok) {
        return createValidationError(
          result.error.code === "conflict" ? t("profile.handleTaken") : result.error.message,
        );
      }
      formApi.reset(value);
      await refreshSession();
      return undefined;
    },
  });

  return (
    <Screen.Section
      id="your-public-page"
      title={t("profile.pageTitle")}
      description={t("profile.pageHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-4">
          <form.Field name="handle">
            {(field) => <field.TextField autoComplete="username" />}
          </form.Field>
          <form.Field name="pronouns">{(field) => <field.TextField />}</form.Field>
          <form.Field name="bio">{(field) => <field.TextAreaField rows={4} />}</form.Field>
          <form.Field name="links">
            {(list) => (
              <list.Field>
                <list.Label />
                <ol className="flex flex-col gap-2">
                  {list.value.map((link, index) => (
                    <li key={link.uid} className="flex items-start gap-2">
                      <form.Field
                        name={`links[${index}].kind`}
                        listeners={[
                          {
                            triggers: ["change"],
                            watchFields: [`links[${index}].url`],
                            run: ({ value, fieldApi, formApi }) => {
                              if (fieldApi.meta.isTouched) return;
                              const kind = kindForUrl(formApi.getFieldValue(`links[${index}].url`));
                              if (kind && kind !== value)
                                fieldApi.handleChange(kind, { markAsTouched: false });
                            },
                          },
                        ]}
                      >
                        {(field) => (
                          <div className="w-36 shrink-0">
                            <FieldSelect field={field} options={kinds} />
                          </div>
                        )}
                      </form.Field>
                      <form.Field name={`links[${index}].url`}>
                        {(field) => (
                          <field.Field className="min-w-0 flex-1">
                            <field.Label className="sr-only" />
                            <field.TextInput type="url" inputMode="url" autoComplete="url" />
                            <field.Error />
                          </field.Field>
                        )}
                      </form.Field>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t("ui.removeNamed", { name: link.url || t("profile.link") })}
                        onClick={() => list.removeValue(index)}
                      >
                        <IconX />
                      </Button>
                    </li>
                  ))}
                </ol>
                {list.value.length < MAX_PROFILE_LINKS && (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-muted border-dashed"
                      onClick={() =>
                        list.pushValue({
                          uid: newUid(),
                          kind: "website",
                          url: "",
                        })
                      }
                    >
                      <IconPlus />
                      {t("ui.addNoun", { noun: t("profile.link").toLowerCase() })}
                    </Button>
                  </div>
                )}
                <list.Description />
              </list.Field>
            )}
          </form.Field>
          <form.Field name="visibility">
            {(field) => (
              <field.Field>
                <field.Label />
                <FieldSelect
                  field={field}
                  options={[
                    { value: "org", label: t("profile.visibleOrg") },
                    { value: "public", label: t("profile.visiblePublic") },
                  ]}
                />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.FormAlert title={t("profile.pageFailed")} />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

function DangerZone() {
  const t = useT();
  const schema = useMemo(() => deletionSchema(t), [t]);
  const queryClient = useQueryClient();
  const options = accountDeletionQueryOptions();
  const { data: deletion } = useSuspenseQuery(options);
  const refresh = () => queryClient.invalidateQueries({ queryKey: options.queryKey });
  const form = useAppForm({
    defaultValues: { reason: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await requestAccountDeletionFn({ data: { reason: value.reason } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      await refresh();
      return undefined;
    },
  });
  const cancel = useMutation({
    mutationFn: async () => unwrap(await cancelAccountDeletionFn()),
    onSuccess: refresh,
  });

  if (!deletion.enabled && !deletion.requestedAt) return null;

  return (
    <Screen.Section id="danger-zone" title={t("profile.danger")}>
      {deletion.requestedAt ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {t("profile.deletionRequested")} <RelativeTime value={deletion.requestedAt} />.{" "}
            {t("profile.deletionPending")}
          </p>
          <div>
            <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {cancel.isPending ? t("profile.cancelling") : t("profile.cancelRequest")}
            </Button>
          </div>
        </div>
      ) : (
        <form.AppForm>
          <form.Form className="flex flex-col gap-3">
            <form.Field name="reason">{(field) => <field.TextAreaField rows={3} />}</form.Field>
            <form.FormAlert title={t("profile.deleteFailed")} />
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <div>
                  <Button
                    variant="destructive"
                    disabled={submitting}
                    confirm={{
                      title: t("profile.deleteConfirmTitle"),
                      description: t("profile.deleteConfirmBody"),
                      label: t("profile.deleteConfirmLabel"),
                    }}
                    onClick={() => void form.handleSubmit()}
                  >
                    {t("profile.askDelete")}
                  </Button>
                </div>
              )}
            </form.Subscribe>
          </form.Form>
        </form.AppForm>
      )}
      <ErrorAlert error={cancel.error} title={t("profile.cancelFailed")} />
    </Screen.Section>
  );
}
