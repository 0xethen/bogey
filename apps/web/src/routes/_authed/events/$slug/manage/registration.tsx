import { exportHref } from "#/lib/exports.ts";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  createInviteLinkFn,
  eventInviteLinksQueryOptions,
  setInviteLinkDisabledFn,
  deleteInviteLinkFn,
  type InviteLink,
} from "@bogey/db/queries/invites";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { formatDateTime, wallTimeToIso } from "@bogey/utils/time";
import { Button } from "@bogey/ui/components/button";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bogey/ui/components/dialog";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldGroup } from "@bogey/ui/components/field";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { Screen } from "@bogey/ui/components/screen";
import { IconCopy, IconPlus, IconDownload } from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/registration")({
  staticData: {
    title: msg("manageNav.registration"),
    settings: (t) => [
      searchSection(t("manageReg.joining"), { id: "joining" }),
      ...searchSettings("registration", ["capacity", "autoPromote"], t),
      ...searchSettings("identity", ["enabled"], t),
      searchSection(t("window.checkin"), { id: "check-in" }),
      ...searchSettings(
        "checkin",
        [
          "requiredToCompete",
          "confirmName",
          "allowWalkIns",
          "selfCheckIn",
          "badgeEmailHours",
          "takers",
        ],
        t,
      ),
      searchSection(t("manageReg.links"), { keywords: ["share", "link"], id: "invite-links" }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "registration",
        "identity",
        "checkin",
      ]),
      context.query.ensureQueryData(eventInviteLinksQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  return (
    <Screen title={t("manageNav.registration")} width="embedded">
      <Screen.Section
        id="joining"
        title={t("manageReg.joining")}
        actions={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={exportHref(event.slug, "registrations")} download />}
          >
            <IconDownload />
            {t("manageReg.export")}
          </Button>
        }
      >
        <SettingFields scope={scope} namespace="registration" keys={["capacity", "autoPromote"]} />
        <SettingFields scope={scope} namespace="identity" keys={["enabled"]} />
      </Screen.Section>
      <Screen.Section
        id="check-in"
        title={t("window.checkin")}
        description={t("manageReg.checkInHelp")}
      >
        <SettingFields
          scope={scope}
          namespace="checkin"
          keys={[
            "requiredToCompete",
            "confirmName",
            "allowWalkIns",
            "selfCheckIn",
            "badgeEmailHours",
            "takers",
          ]}
        />
      </Screen.Section>
      <InviteLinks />
      <PluginSettingSections page="registration" />
    </Screen>
  );
}

const linkSchema = (t: T) =>
  z.object({
    label: z
      .string()
      .trim()
      .min(1, t("manageReg.nameLink"))
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("manageReg.linkLabel"), placeholder: t("manageReg.linkPlaceholder") }),
    autoApprove: z.boolean().meta({ label: t("manageReg.autoApprove") }),
    capacity: z
      .union([
        z
          .number()
          .int(t("eventForm.whole"))
          .min(1, t("eventForm.atLeast", { min: 1 })),
        z.nan(),
      ])
      .meta({ label: t("manageReg.limit"), placeholder: t("manageReg.noLimit") }),
    closesAt: z
      .string()
      .meta({ label: t("manageReg.stops") })
      .describe(t("manageReg.stopsHelp")),
  });

const linkOptions = (t: T) =>
  appFormOptions.strictSchema({
    defaultValues: { label: "", autoApprove: false, capacity: Number.NaN, closesAt: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(linkSchema(t))],
  });

function linkState(link: InviteLink, t: T): { open: boolean; reason: string } {
  if (link.disabled_at) return { open: false, reason: t("manageReg.turnedOff") };
  if (link.closes_at && new Date(link.closes_at) <= new Date())
    return { open: false, reason: t("manageReg.expired") };
  if (link.capacity !== null && link.used >= link.capacity) {
    return { open: false, reason: t("agenda.full") };
  }
  return { open: true, reason: t("manageReg.open") };
}

const newInviteLink = createDialogHandle<undefined>();

function InviteLinks() {
  const t = useT();
  const base = useMemo(() => linkOptions(t), [t]);
  const time = useTimeFormat();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: links } = useSuspenseQuery(eventInviteLinksQueryOptions(event.id));
  const [copied, setCopied] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: eventInviteLinksQueryOptions(event.id).queryKey });

  const toggle = useMutation({
    mutationFn: async (change: { id: string; disabled: boolean }) =>
      unwrap(await setInviteLinkDisabledFn({ data: change })),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await deleteInviteLinkFn({ data: id })),
    onSettled: refresh,
  });

  const form = useAppForm({
    ...base,
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await createInviteLinkFn({
        data: {
          eventId: event.id,
          label: value.label,
          autoApprove: value.autoApprove,
          capacity: Number.isNaN(value.capacity) ? null : value.capacity,
          closesAt: wallTimeToIso(value.closesAt, event.timezone),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      newInviteLink.close();
      await refresh();
      return undefined;
    },
  });

  const copy = (token: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/join/${token}`).then(() => {
      setCopied(token);
      setTimeout(() => setCopied((current) => (current === token ? null : current)), 2000);
    });
  };

  return (
    <Screen.Section
      id="invite-links"
      title={t("manageReg.links")}
      description={t("manageReg.linksHelp")}
      actions={
        <DialogTrigger handle={newInviteLink} render={<Button size="sm" variant="outline" />}>
          <IconPlus />
          {t("manageReg.newLink")}
        </DialogTrigger>
      }
    >
      <Dialog handle={newInviteLink}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("manageReg.newLinkTitle")}</DialogTitle>
            <DialogDescription>
              {t("manageReg.newLinkHelp", { event: event.name })}
            </DialogDescription>
          </DialogHeader>
          <form.AppForm>
            <form.Form unsaved="draft">
              <FieldGroup>
                <form.Field name="label">{(field) => <field.TextField required />}</form.Field>
                <form.Field name="autoApprove">
                  {(field) => (
                    <field.SwitchField
                      description={
                        field.value === true
                          ? t("manageReg.autoOn", { event: event.name })
                          : t("manageReg.autoOff")
                      }
                    />
                  )}
                </form.Field>
                <form.Field name="capacity">{(field) => <field.NumberField min={1} />}</form.Field>
                <form.Field name="closesAt">{(field) => <field.DateTimeField />}</form.Field>
                <form.FormAlert title={t("manageReg.createFailed")} />
                <form.Submit pending={t("teamForm.creating")}>
                  {t("manageReg.createLink")}
                </form.Submit>
              </FieldGroup>
            </form.Form>
          </form.AppForm>
        </DialogContent>
      </Dialog>

      <ErrorAlert error={toggle.error ?? remove.error} title={t("manageReg.changeFailed")} />

      {links.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manageReg.noLinks")}</p>
      ) : (
        <DisclosureList>
          {links.map((link) => {
            const state = linkState(link, t);
            return (
              <DisclosureRow
                key={link.id}
                leading={<StatusDot tone={state.open ? "done" : "idle"} label={state.reason} />}
                title={
                  (link.label || t("manageReg.link")) +
                  (link.auto_approve
                    ? ` (${t("manageReg.auto")})`
                    : ` (${t("manageReg.reviewed")})`)
                }
                meta={[
                  `${state.reason}${
                    link.closes_at
                      ? ` ${t("manageReg.until", { when: formatDateTime(link.closes_at, time) })}`
                      : ""
                  }`,
                  link.capacity !== null
                    ? t("manageReg.usedOf", { used: link.used, capacity: link.capacity })
                    : t("manageReg.used", { used: link.used }),
                ]
                  .filter(Boolean)
                  .join(", ")}
                actions={
                  state.open && (
                    <Button size="sm" variant="ghost" onClick={() => copy(link.token)}>
                      <IconCopy />
                      {copied === link.token ? t("common.copied") : t("manageReg.copyLink")}
                    </Button>
                  )
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pl-5">
                  <code className="rounded-md bg-muted px-2 py-1 text-xs break-all select-all">
                    /join/{link.token}
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    {link.disabled_at ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: link.id, disabled: false })}
                      >
                        {t("manageReg.turnBackOn")}
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={toggle.isPending}
                        confirm={{
                          title: t("manageReg.turnOffTitle", {
                            name: link.label || t("manageReg.thisLink"),
                          }),
                          description: (
                            <>
                              {t("manageReg.turnOffBefore")}{" "}
                              <Link
                                to="/events/$slug/manage/people"
                                params={{ slug: event.slug }}
                                search={{ link: link.id }}
                              >
                                {t("manageReg.turnOffPeople")}
                              </Link>
                              . {t("manageReg.turnOffAfter")}
                            </>
                          ),
                          label: t("calendar.offLabel"),
                        }}
                        onClick={() => toggle.mutate({ id: link.id, disabled: true })}
                      >
                        {t("calendar.offButton")}
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={remove.isPending}
                      confirm={{
                        title: t("manageReg.removeTitle", {
                          name: link.label || t("manageReg.thisLink"),
                        }),
                        description: t("manageReg.removeBody"),
                        label: t("twoFactor.remove"),
                      }}
                      onClick={() => remove.mutate(link.id)}
                    >
                      {t("twoFactor.removeButton")}
                    </Button>
                  </div>
                </div>
              </DisclosureRow>
            );
          })}
        </DisclosureList>
      )}
    </Screen.Section>
  );
}
