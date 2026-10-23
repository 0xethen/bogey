import { Blurred } from "@bogey/ui/components/blurred";
import { useMemo } from "react";
import { useQueryClient, useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { eventPeopleQueryOptions } from "@bogey/db/queries/manage";
import { eventTeamsQueryOptions } from "@bogey/db/queries/roster";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import {
  blockedAccessQueryOptions,
  networkStatusQueryOptions,
  ownSettingsQueryOptions,
  updateSettings,
} from "@bogey/db/queries/settings";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Row, RowList } from "@bogey/ui/components/row";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { NetworkListForm } from "#/components/settings/fields/network-list.tsx";
import { useT, type T } from "#/lib/translate.tsx";

const scopeSchema = (t: T) =>
  z.object({
    users: z
      .array(z.string())
      .meta({ label: t("adminTab.people"), placeholder: t("badges.everyone") }),
    teams: z
      .array(z.string())
      .meta({ label: t("facts.teams"), placeholder: t("netSection.everyTeam") }),
    divisions: z
      .array(z.string())
      .meta({ label: t("manageNav.divisions"), placeholder: t("netSection.everyDivision") }),
  });

export function prefetchNetworkSection(query: QueryClient, eventId: string) {
  return Promise.all([
    query.ensureQueryData(networkStatusQueryOptions(eventId)),
    query.ensureQueryData(blockedAccessQueryOptions(eventId)),
    query.ensureQueryData(eventPeopleQueryOptions(eventId)),
    query.ensureQueryData(eventTeamsQueryOptions(eventId)),
    query.ensureQueryData(eventDivisionsQueryOptions(eventId)),
    query.ensureQueryData(ownSettingsQueryOptions({ scope: "event", eventId }, "access")),
  ]);
}

export function NetworkSection({ eventId }: { eventId: string }) {
  const t = useT();
  const schema = useMemo(() => scopeSchema(t), [t]);
  const scope = { scope: "event", eventId } as const;
  const queryClient = useQueryClient();
  const { data: status } = useSuspenseQuery(networkStatusQueryOptions(eventId));
  const { data: own } = useSuspenseQuery(ownSettingsQueryOptions(scope, "access"));
  const { data: blocked } = useSuspenseQuery(blockedAccessQueryOptions(eventId));
  const { data: people } = useSuspenseQuery(eventPeopleQueryOptions(eventId));
  const { data: teams } = useSuspenseQuery(eventTeamsQueryOptions(eventId));
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(eventId));

  const userOptions = people.members
    .filter((member) => member.role === "participant")
    .map((member) => ({ value: member.userId, label: member.name }));
  const teamOptions = teams.teams.map((team) => ({ value: team.id, label: team.name }));
  const divisionOptions = divisions.map((division) => ({
    value: division.id,
    label: division.name,
  }));

  const known = (saved: Tuple<string> | undefined, options: Tuple<{ value: string }>) =>
    (saved ?? []).filter((id) => options.some((option) => option.value === id));

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        users: known(own.onlyUsers, userOptions),
        teams: known(own.onlyTeams, teamOptions),
        divisions: known(own.onlyDivisions, divisionOptions),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const parsed = schema.parse(value);
      const result = await updateSettings(scope, "access", {
        onlyUsers: parsed.users.length ? parsed.users : null,
        onlyTeams: parsed.teams.length ? parsed.teams : null,
        onlyDivisions: parsed.divisions.length ? parsed.divisions : null,
      });
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(parsed);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      return undefined;
    },
  });

  return (
    <Screen.Section id="network" title={t("manageReg.network")} description={t("netSection.intro")}>
      <NetworkListForm
        saved={own.allowedNetworks}
        onSave={(allowedNetworks) => updateSettings(scope, "access", { allowedNetworks })}
        label={t("netSection.allowed")}
        placeholder={"168.9.212.0/23\nAS46830"}
        description={t("netSection.allowedHelp")}
        hint={
          status.ip && (
            <>
              {t("netSection.youreOn")} <Blurred>{status.ip}</Blurred>
            </>
          )
        }
        asn
      />
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-4">
          <p>{t("netSection.scope")}</p>
          <p className="text-sm text-muted-fg">{t("netSection.scopeHelp")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <form.Field name="users">
              {(field) => (
                <field.MultiSelectField
                  options={userOptions}
                  empty={t("netSection.noParticipants")}
                />
              )}
            </form.Field>
            <form.Field name="teams">
              {(field) => (
                <field.MultiSelectField options={teamOptions} empty={t("manageTeams.none")} />
              )}
            </form.Field>
            <form.Field name="divisions">
              {(field) => (
                <field.MultiSelectField
                  options={divisionOptions}
                  empty={t("netSection.noDivisions")}
                />
              )}
            </form.Field>
          </div>
          <form.FormAlert title={t("netSection.saveFailed")} />
        </form.Form>
      </form.AppForm>
      {blocked.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("netSection.blocked")}</h3>
          <RowList variant="flush" render={<ul />}>
            {blocked.map((attempt) => (
              <Row
                key={attempt.at}
                render={<li />}
                size="sm"
                title={attempt.name ?? t("netSection.someone")}
                meta={attempt.ip && <span className="font-mono">{attempt.ip}</span>}
                actions={
                  <span className="text-sm text-muted-fg">
                    <RelativeTime value={attempt.at} />
                  </span>
                }
              />
            ))}
          </RowList>
        </div>
      )}
    </Screen.Section>
  );
}
