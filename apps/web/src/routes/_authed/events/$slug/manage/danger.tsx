import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { eventDeletion } from "@bogey/config";
import {
  clearEventDataFn,
  deleteEventFn,
  pruneParticipantsFn,
  PRUNE_RULES,
  type ClearKind,
  type PruneRule,
} from "@bogey/db/queries/manage";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { agendaQueryOptions } from "@bogey/db/queries/sessions";
import { MultiSelect, type SearchSelectOption } from "@bogey/ui/components/search-select";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@bogey/ui/components/field";
import { Row, RowList } from "@bogey/ui/components/row";
import { Screen } from "@bogey/ui/components/screen";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { useEvent } from "#/lib/viewer.ts";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";

const confirmSchema = (t: T, slug: string) =>
  z.object({
    confirm: z
      .string()
      .trim()
      .refine((value) => value === slug, t("danger.deleteMismatch"))
      .meta({ label: t("danger.deleteLabel", { slug }), placeholder: slug }),
  });

export const Route = createFileRoute("/_authed/events/$slug/manage/danger")({
  staticData: {
    title: msg("danger.title"),
    settings: (t) => [
      searchSection(t("danger.cleanUp"), {
        keywords: ["prune", "remove", "no-shows", "waitlist", "reset judging", "dry run"],
        id: "clean-up",
      }),
      searchSection(t("danger.delete"), { keywords: ["delete", "remove", "event"], id: "delete" }),
    ],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event, access } = Route.useRouteContext();
  return (
    <Screen title={t("danger.title")} description={t("danger.intro")} width="embedded">
      <Screen.Section
        id="clean-up"
        title={t("danger.cleanUp")}
        description={
          <Linked
            text={t("danger.cleanUpHelp", { security: LINK })}
            links={[
              <SettingLink
                key="security"
                to={`/events/${event.slug}/manage/security`}
                hash="publishing"
              >
                {t("path.security")}
              </SettingLink>,
            ]}
          />
        }
      >
        <RowList variant="boxed">
          <PruneParticipants />
          <ClearAction
            what="waiting"
            title={t("danger.waiting")}
            help={t("danger.waitingHelp")}
            body={(count) => t("danger.waitingBody", { count })}
          />
          <ClearAction
            what="judging"
            title={t("danger.judging")}
            help={t("danger.judgingHelp")}
            body={(count) => t("danger.judgingBody", { count })}
          />
          <ClearAction
            what="participants"
            title={t("danger.participants")}
            help={t("danger.participantsHelp")}
            body={(count) => t("danger.participantsBody", { count })}
          />
        </RowList>
      </Screen.Section>
      {eventDeletion && (
        <Screen.Section id="delete" title={t("danger.delete")} description={t("danger.deleteHelp")}>
          {access.orgAdmin ? (
            <DeleteEvent />
          ) : (
            <p className="text-sm text-muted-fg">{t("danger.deleteAdminsOnly")}</p>
          )}
        </Screen.Section>
      )}
    </Screen>
  );
}

/** One row of the danger zone: a title, what it does and the button that opens its dialog. */
function DangerRow({
  title,
  help,
  button,
  onOpen,
}: {
  title: string;
  help: string;
  button: string;
  onOpen: () => void;
}) {
  return (
    <Row
      title={title}
      meta={help}
      actions={
        <Button size="sm" variant="destructive" onClick={onOpen}>
          {button}
        </Button>
      }
    />
  );
}

/** A dialog that asks for the event's address before doing something that can't be undone. */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  extra,
  submit,
  pending,
  failed,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  extra?: ReactNode;
  submit: string;
  pending: string;
  failed: string;
  onConfirm: (confirm: string) => Promise<string | undefined>;
}) {
  const t = useT();
  const slug = useEvent().slug;
  const schema = useMemo(() => confirmSchema(t, slug), [t, slug]);
  const form = useAppForm({
    defaultValues: { confirm: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const problem = await onConfirm(value.confirm);
      if (problem) return createValidationError(problem);
      formApi.reset();
      return undefined;
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              {extra}
              <form.Field name="confirm">
                {(field) => <field.TextField autoComplete="off" />}
              </form.Field>
              <form.FormAlert title={failed} />
              <form.Submit variant="destructive" pending={pending}>
                {submit}
              </form.Submit>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

function useClear(what: ClearKind, open: boolean) {
  const event = useEvent();
  const queryClient = useQueryClient();
  const count = useQuery({
    queryKey: ["clear-count", event.id, what] as const,
    queryFn: async () => unwrap(await clearEventDataFn({ data: { eventId: event.id, what } })),
    enabled: open,
    staleTime: 0,
  });
  const run = async (confirm: string) => {
    const result = await clearEventDataFn({ data: { eventId: event.id, what, confirm } }).catch(
      requestFailure,
    );
    if (!result.ok) return result.error.message;
    await queryClient.invalidateQueries();
    return undefined;
  };
  return { count: count.data, run };
}

function ClearAction({
  what,
  title,
  help,
  body,
}: {
  what: ClearKind;
  title: string;
  help: string;
  body: (count: number) => string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { count, run } = useClear(what, open);
  return (
    <>
      <DangerRow
        title={title}
        help={help}
        button={t("danger.clearButton", { title })}
        onOpen={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("danger.clearTitle", { title })}
        description={count === undefined ? t("common.loading") : body(count)}
        submit={title}
        pending={t("danger.clearing")}
        failed={t("danger.clearFailed")}
        onConfirm={async (confirm) => {
          const problem = await run(confirm);
          if (!problem) setOpen(false);
          return problem;
        }}
      />
    </>
  );
}

function PruneParticipants() {
  const event = useEvent();
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const divisions = useQuery({ ...eventDivisionsQueryOptions(event.id), enabled: open });
  const agenda = useQuery({ ...agendaQueryOptions(event.id), enabled: open });
  const options: SearchSelectOption[] = [
    ...PRUNE_RULES.map((rule) => ({
      value: `rule:${rule}`,
      label: t(RULE_LABELS[rule]),
      group: t("danger.pruneConditions"),
    })),
    ...(divisions.data ?? []).map((division) => ({
      value: `division:${division.id}`,
      label: division.name,
      group: t("compose.divisions"),
    })),
    ...(agenda.data?.slots ?? [])
      .filter((slot) => slot.kind === "choose")
      .flatMap((slot) => slot.sessions)
      .map((session) => ({
        value: `session:${session.id}`,
        label: session.name,
        group: t("compose.sessions"),
      })),
  ];
  const of = (kind: string) =>
    picked.filter((key) => key.startsWith(`${kind}:`)).map((key) => key.slice(kind.length + 1));
  const selection = {
    eventId: event.id,
    rules: of("rule").flatMap((rule) => PRUNE_RULES.filter((each) => each === rule)),
    divisions: of("division"),
    sessions: of("session"),
  };
  const count = useQuery({
    queryKey: ["prune-count", selection] as const,
    queryFn: async () => unwrap(await pruneParticipantsFn({ data: selection })),
    enabled: open && picked.length > 0,
    staleTime: 0,
  });
  const title = t("danger.prune");
  return (
    <>
      <DangerRow
        title={title}
        help={t("danger.pruneHelp")}
        button={t("danger.clearButton", { title })}
        onOpen={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("danger.clearTitle", { title })}
        description={
          picked.length === 0
            ? t("danger.prunePick")
            : count.data === undefined
              ? t("common.loading")
              : t("danger.pruneBody", { count: count.data })
        }
        extra={
          <Field>
            <FieldLabel htmlFor="prune-who">{t("danger.pruneWho")}</FieldLabel>
            <MultiSelect
              id="prune-who"
              options={options}
              value={picked}
              onValueChange={setPicked}
              placeholder={t("danger.prunePlaceholder")}
            />
            <FieldDescription>{t("danger.pruneWhoHelp")}</FieldDescription>
          </Field>
        }
        submit={title}
        pending={t("danger.clearing")}
        failed={t("danger.clearFailed")}
        onConfirm={async (confirm) => {
          if (picked.length === 0) return t("danger.prunePick");
          const result = await pruneParticipantsFn({ data: { ...selection, confirm } }).catch(
            requestFailure,
          );
          if (!result.ok) return result.error.message;
          await queryClient.invalidateQueries();
          setPicked([]);
          setOpen(false);
          return undefined;
        }}
      />
    </>
  );
}

const RULE_LABELS = {
  not_checked_in: "danger.pruneNotCheckedIn",
  no_team: "danger.pruneNoTeam",
  no_submission: "danger.pruneNoSubmission",
} as const satisfies Record<PruneRule, string>;

function DeleteEvent() {
  const event = useEvent();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          {t("danger.deleteButton")}
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("danger.deleteTitle", { name: event.name })}
        description={
          <>
            {t("danger.deleteBody1")}{" "}
            <a href={`/api/events/${event.slug}/archive`} download className="link">
              {t("danger.deleteBodyLink")}
            </a>{" "}
            {t("danger.deleteBody2")}
          </>
        }
        submit={t("danger.deleteConfirm")}
        pending={t("danger.deleting")}
        failed={t("danger.deleteFailed")}
        onConfirm={async (confirm) => {
          const result = await deleteEventFn({ data: { eventId: event.id, confirm } }).catch(
            requestFailure,
          );
          if (!result.ok) return result.error.message;
          await navigate({ to: "/events", replace: true });
          queryClient.removeQueries({ queryKey: ["event"] });
          await queryClient.invalidateQueries({ queryKey: ["events"] });
          return undefined;
        }}
      />
    </>
  );
}
