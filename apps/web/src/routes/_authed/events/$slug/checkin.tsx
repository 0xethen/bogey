import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { IconCamera, IconCameraOff, IconUserPlus, IconUsers } from "@tabler/icons-react";
import {
  checkInFn,
  checkinRosterQueryOptions,
  isCheckedIn,
  undoCheckInFn,
  venueCodeQueryOptions,
  walkInFn,
  type CheckInResult,
  type RosterEntry,
} from "@bogey/db/queries/checkin";
import { can } from "@bogey/db/permissions";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Input } from "@bogey/ui/components/input";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { QrScanner } from "#/components/event/qr-scanner.tsx";
import { inEvent, atTheDesk } from "#/lib/viewer.ts";
import { useRoleLabel } from "#/lib/roles.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/checkin")({
  staticData: { title: msg("checkin.title"), command: { when: inEvent(atTheDesk) } },
  beforeLoad: ({ context, params }) => {
    if (!can(context.access, "people.checkin")) {
      throw Route.redirect({ to: "/events/$slug", params, replace: true });
    }
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(checkinRosterQueryOptions(context.event.id)),
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["checkin"]),
      ),
    ]),
  component: RouteComponent,
});

function VenueCode({ eventId }: { eventId: string }) {
  const t = useT();
  const { data } = useQuery({ ...venueCodeQueryOptions(eventId), refetchInterval: 30_000 });
  if (!data?.code) return null;
  return (
    <Alert>
      <AlertTitle>
        {t("checkin.venueCode")}{" "}
        <span className="font-mono text-2xl tracking-widest">{data.code}</span>
      </AlertTitle>
      <AlertDescription>{t("checkin.venueCodeHelp")}</AlertDescription>
    </Alert>
  );
}

const badgeCodeSchema = (t: T) =>
  z.object({
    code: z
      .string()
      .trim()
      .min(1, t("checkin.enterCode"))
      .max(12, t("checkin.codeLength", { max: 12 }))
      .meta({ label: t("checkin.badgeCode") }),
  });

const walkInSchema = (t: T) =>
  z.object({
    email: z
      .email(t("form.validEmail"))
      .meta({ label: t("checkin.email"), placeholder: "name@example.org" }),
    name: z
      .string()
      .trim()
      .max(120, t("form.maxLength", { max: 120 }))
      .meta({ label: t("checkin.name") }),
  });

function RouteComponent() {
  const t = useT();
  const roleLabel = useRoleLabel();
  const codeSchema = useMemo(() => badgeCodeSchema(t), [t]);
  const walkSchema = useMemo(() => walkInSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: roster } = useSuspenseQuery(checkinRosterQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["checkin"]),
  );
  useLiveInvalidate("checkins", checkinRosterQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState<CheckInResult | null>(null);
  const [walkNotice, setWalkNotice] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: checkinRosterQueryOptions(event.id).queryKey });
  const checkIn = useMutation({
    mutationFn: async (input: { userId?: string; code?: string; method: "desk" | "qr" }) =>
      unwrap(await checkInFn({ data: { eventId: event.id, ...input } }).catch(requestFailure)),
    onSuccess: async (result) => {
      setLast(result);
      await refresh();
    },
  });
  const undo = useMutation({
    mutationFn: async (input: { userId: string; out?: boolean }) =>
      unwrap(await undoCheckInFn({ data: { eventId: event.id, ...input } })),
    onSuccess: async () => {
      setLast(null);
      await refresh();
    },
  });
  const codeForm = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { code: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(codeSchema)],
    }),
    onSubmit: async ({ value, formApi }) => {
      const result = await checkIn
        .mutateAsync({ code: value.code, method: "qr" })
        .catch(() => undefined);
      if (result) formApi.reset();
    },
  });
  const walkInForm = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { email: "", name: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(walkSchema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      setWalkNotice(null);
      const result = await walkInFn({ data: { eventId: event.id, ...value } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      setWalkNotice(result.data.checkedIn ? t("checkin.walkInDone") : t("checkin.walkInPending"));
      formApi.reset();
      await refresh();
      return undefined;
    },
  });

  const here = roster.filter(isCheckedIn);
  const people = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return roster
      .filter((entry) => `${entry.name} ${entry.email}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [roster, query]);
  const recent = [...here]
    .sort((a, b) => (b.checkedInAt ?? "").localeCompare(a.checkedInAt ?? ""))
    .slice(0, 8);
  const byGroup = (key: (entry: RosterEntry) => string) => {
    const groups = new Map<string, { here: number; total: number }>();
    for (const entry of roster) {
      const group = groups.get(key(entry)) ?? { here: 0, total: 0 };
      group.total += 1;
      if (isCheckedIn(entry)) group.here += 1;
      groups.set(key(entry), group);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  };

  const row = (entry: RosterEntry) => (
    <DisclosureRow
      key={entry.userId}
      leading={<NameAvatar name={entry.name} />}
      title={entry.name}
      meta={[entry.email, entry.role, entry.team, entry.division].filter(Boolean).join(" · ")}
      actions={
        isCheckedIn(entry) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={undo.isPending}
            onClick={() => undo.mutate({ userId: entry.userId })}
          >
            {t("checkin.undo")}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={checkIn.isPending}
            onClick={() => checkIn.mutate({ userId: entry.userId, method: "desk" })}
          >
            {t("checkin.checkIn")}
          </Button>
        )
      }
    />
  );

  return (
    <Screen
      title={t("checkin.title")}
      description={t("checkin.present", { here: here.length, total: roster.length })}
      width="narrow"
    >
      {last && (
        <Alert>
          <AlertTitle>
            {last.already
              ? t("checkin.alreadyIn", { name: last.name })
              : t("checkin.isIn", { name: last.name })}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {settings.checkin.confirmName && `${t("checkin.checkId")} `}
            {!last.already && (
              <Button
                size="xs"
                variant="outline"
                disabled={undo.isPending}
                onClick={() => undo.mutate({ userId: last.userId })}
              >
                {t("checkin.undo")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={checkIn.error ?? undo.error} />

      <Screen.Section id="scan-or-type-a-code" title={t("checkin.scanOrType")}>
        <codeForm.AppForm>
          <codeForm.Form className="flex flex-wrap items-end gap-2">
            <codeForm.Field name="code">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <field.TextInput
                    autoComplete="off"
                    className="font-mono uppercase tracking-widest"
                    maxLength={12}
                  />
                  <field.Error />
                </field.Field>
              )}
            </codeForm.Field>
            <codeForm.Submit className="flex-1">{t("checkin.checkIn")}</codeForm.Submit>
            <Button type="button" variant="outline" onClick={() => setScanning((on) => !on)}>
              {scanning ? <IconCameraOff /> : <IconCamera />}
              {scanning ? t("checkin.stopCamera") : t("checkin.scan")}
            </Button>
          </codeForm.Form>
        </codeForm.AppForm>
        {scanning && (
          <QrScanner
            onCode={(scanned) => {
              // keep what was read in the box so a failed scan can be checked or fixed by hand
              codeForm.setFieldValue("code", scanned);
              checkIn.mutate(
                { code: scanned, method: "qr" },
                { onSuccess: () => codeForm.reset() },
              );
            }}
          />
        )}
      </Screen.Section>

      <Screen.Section id="find-someone" title={t("checkin.find")}>
        <Input
          aria-label={t("checkin.searchLabel")}
          placeholder={t("checkin.searchPlaceholder")}
          value={query}
          onChange={(changed) => setQuery(changed.target.value)}
        />
        {query.trim() && (
          <DisclosureList>
            {people.length > 0 ? (
              people.map(row)
            ) : (
              <p className="py-3 text-sm text-muted-fg">{t("checkin.noMatch")}</p>
            )}
          </DisclosureList>
        )}
      </Screen.Section>

      {settings.checkin.selfCheckIn && <VenueCode eventId={event.id} />}

      {settings.checkin.allowWalkIns && (
        <Screen.Section
          id="walk-in"
          title={t("checkin.walkIn")}
          description={t("checkin.walkInHelp")}
        >
          <walkInForm.AppForm>
            <walkInForm.Form className="flex flex-wrap items-end gap-2">
              <walkInForm.Field name="email">
                {(field) => <field.TextField type="email" required autoComplete="off" />}
              </walkInForm.Field>
              <walkInForm.Field name="name">
                {(field) => <field.TextField autoComplete="off" />}
              </walkInForm.Field>
              <walkInForm.Submit pending={t("checkin.registering")}>
                <IconUserPlus />
                {t("checkin.registerAndCheckIn")}
              </walkInForm.Submit>
            </walkInForm.Form>
            <walkInForm.FormAlert title={t("checkin.walkInFailed")} />
          </walkInForm.AppForm>
          {walkNotice && (
            <p role="status" className="text-sm text-muted-fg">
              {walkNotice}
            </p>
          )}
        </Screen.Section>
      )}

      <Screen.Section id="present" title={t("checkin.presentTitle")}>
        <StatGroup>
          {byGroup((entry) => entry.role).map(([role, counts]) => (
            <Stat
              key={role}
              icon={IconUsers}
              label={t("checkin.hereOf", {
                role: roleLabel(role).toLowerCase(),
                total: counts.total,
              })}
              value={counts.here}
            />
          ))}
        </StatGroup>
        {byGroup((entry) => entry.division ?? t("checkin.noDivision")).length > 1 && (
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-fg">
            {byGroup((entry) => entry.division ?? t("checkin.noDivision")).map(
              ([division, counts]) => (
                <li key={division}>
                  {t("checkin.divisionCount", { division, here: counts.here, total: counts.total })}
                </li>
              ),
            )}
          </ul>
        )}
      </Screen.Section>

      {recent.length > 0 && (
        <Screen.Section id="just-checked-in" title={t("checkin.recent")}>
          <DisclosureList>
            {recent.map((entry) => (
              <DisclosureRow
                key={entry.userId}
                leading={<NameAvatar name={entry.name} />}
                title={entry.name}
                meta={entry.checkedInAt ? <RelativeTime value={entry.checkedInAt} /> : undefined}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={undo.isPending}
                      onClick={() => undo.mutate({ userId: entry.userId, out: true })}
                    >
                      {t("checkin.left")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={undo.isPending}
                      onClick={() => undo.mutate({ userId: entry.userId })}
                    >
                      {t("checkin.undo")}
                    </Button>
                  </>
                }
              />
            ))}
          </DisclosureList>
        </Screen.Section>
      )}
    </Screen>
  );
}
