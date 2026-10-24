import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { z } from "zod";
import {
  createTeamFn,
  joinTeamFn,
  myTeamQueryOptions,
  teamNameTakenFn,
  teamPreviewFn,
  type TeamPreview,
} from "@bogey/db/queries/teams";
import { requestFailure, unwrap } from "@bogey/db/errors";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@bogey/ui/components/alert-dialog";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import {
  errorVisibility,
  remoteCheck,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";
import { useEvent } from "#/lib/viewer.ts";

export const teamNameSchema = (t: T) =>
  z
    .string()
    .trim()
    .min(1, t("teamForm.nameRequired"))
    .max(60, t("form.maxLength", { max: 60 }));

const inviteCodeSchema = (t: T) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{10}$/, t("teamForm.codeRule"));

export function teamNameCheck(eventId: string, t: T, exceptTeamId?: string) {
  return {
    ...remoteCheck,
    run: async ({ value, signal }: { value: string; signal: AbortSignal }) => {
      const result = await teamNameTakenFn({
        data: { eventId, name: value.trim(), exceptTeamId },
        signal,
      });
      return result.ok && result.data ? t("teamForm.nameTaken") : undefined;
    },
  };
}

export function StartOrJoinTeam({ onDone }: { onDone?: () => Promise<void> | void }) {
  const t = useT();
  const eventId = useEvent().id;
  const nameSchema = useMemo(
    () => z.object({ name: teamNameSchema(t).meta({ label: t("teamForm.name") }) }),
    [t],
  );
  const codeSchema = useMemo(
    () => z.object({ code: inviteCodeSchema(t).meta({ label: t("teamForm.code") }) }),
    [t],
  );
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQueryOptions({ eventId }, ["teams"]));
  const organizersStart = settings?.teams.creation === "organizers";
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: myTeamQueryOptions(eventId).queryKey });
    await onDone?.();
  };

  const create = useAppForm({
    defaultValues: { name: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(nameSchema)],
    onSubmit: async ({ value, createValidationError }) => {
      const result = await createTeamFn({ data: { eventId, name: value.name } }).catch(
        requestFailure,
      );
      if (!result.ok) {
        return result.error.code === "conflict"
          ? createValidationError({ fields: { name: result.error.message } })
          : createValidationError(result.error.message);
      }
      await refresh();
      return undefined;
    },
  });

  const [pending, setPending] = useState<{ code: string; team: TeamPreview } | null>(null);

  const join = useAppForm({
    defaultValues: { code: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(codeSchema)],
    onSubmit: async ({ validatorOutputs: [parsed], createValidationError }) => {
      const result = await teamPreviewFn({ data: parsed.code }).catch(requestFailure);
      if (!result.ok) return createValidationError({ fields: { code: result.error.message } });
      setPending({ code: parsed.code, team: result.data });
      return undefined;
    },
  });

  const confirmJoin = useMutation({
    mutationFn: async (code: string) => unwrap(await joinTeamFn({ data: code })),
    onSuccess: async () => {
      setPending(null);
      await refresh();
    },
  });

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <Screen.Section
        id="start-a-team"
        title={t("teamForm.startTitle")}
        description={organizersStart ? t("teamForm.organizersStart") : t("teamForm.startHelp")}
      >
        {!organizersStart && (
          <create.AppForm>
            <create.Form className="flex flex-col gap-3">
              <create.Field name="name" validators={[teamNameCheck(eventId, t)]}>
                {(field) => <field.TextField required />}
              </create.Field>
              <create.FormAlert title={t("teamForm.createFailed")} />
              <div>
                <create.Submit pending={`${t("teamForm.creating")}...`}>
                  {t("teamForm.create")}
                </create.Submit>
              </div>
            </create.Form>
          </create.AppForm>
        )}
      </Screen.Section>

      <Screen.Section
        id="join-a-team"
        title={t("teamForm.joinTitle")}
        description={t("teamForm.joinHelp")}
      >
        <join.AppForm>
          <join.Form className="flex flex-col gap-3">
            <join.Field name="code">
              {(field) => (
                <field.Field>
                  <field.Label required />
                  <field.TextInput autoComplete="off" spellCheck={false} className="font-mono" />
                  <field.Error />
                </field.Field>
              )}
            </join.Field>
            <join.FormAlert title={t("teamForm.joinFailed")} />
            <div>
              <join.Submit variant="outline" pending={`${t("teamForm.finding")}...`}>
                {t("teamForm.joinButton")}...
              </join.Submit>
            </div>
          </join.Form>
        </join.AppForm>
      </Screen.Section>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPending(null);
          confirmJoin.reset();
        }}
      >
        <AlertDialogContent>
          {pending && (
            <JoinConfirmation
              team={pending.team}
              joining={confirmJoin.isPending}
              error={confirmJoin.error}
              onJoin={() => confirmJoin.mutate(pending.code)}
            />
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function JoinConfirmation({
  team,
  joining,
  error,
  onJoin,
}: {
  team: TeamPreview;
  joining: boolean;
  error: Error | null;
  onJoin: () => void;
}) {
  const t = useT();
  const full = team.sizeMax !== null && team.members.length >= team.sizeMax;
  const blocked = team.locked ? t("teamForm.locked") : full ? t("teamForm.full") : null;
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("teamForm.joinConfirm", { team: team.name })}</AlertDialogTitle>
        <AlertDialogDescription>
          {blocked ??
            (team.sizeMax !== null
              ? t("teamForm.membersOf", { count: team.members.length, max: team.sizeMax })
              : t("teamForm.members", { count: team.members.length }))}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {team.members.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {team.members.map((name, index) => (
            <li key={`${name}-${index}`}>
              {name}
              {index === 0 && <span className="text-muted-fg"> ({t("teamForm.captain")})</span>}
            </li>
          ))}
        </ul>
      )}
      <ErrorAlert error={error} title={t("teamForm.joinFailed")} />
      <AlertDialogFooter>
        <AlertDialogCancel>{blocked ? t("common.close") : t("common.cancel")}</AlertDialogCancel>
        {!blocked && (
          <Button type="button" disabled={joining} onClick={onJoin}>
            {joining ? `${t("teamForm.joining")}...` : t("teamForm.join")}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}
