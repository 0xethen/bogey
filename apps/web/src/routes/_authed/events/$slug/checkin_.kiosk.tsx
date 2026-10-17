import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconCircleCheck, IconMaximize } from "@tabler/icons-react";
import { checkinRosterQueryOptions, walkInFn, type WalkInResult } from "@bogey/db/queries/checkin";
import { requestFailure } from "@bogey/db/errors";
import { can } from "@bogey/db/permissions";
import { myRegistrationQueryOptions } from "@bogey/db/queries/registration";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { isoToWallTime } from "@bogey/utils/time";
import { OnboardingForm } from "#/components/event/team/onboarding-form.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";
import { msg, useT, type T } from "#/lib/translate.tsx";

// A page staff open on a spare laptop or tablet at the door: someone who didn't register fills it
// out, and is registered, given an account and checked in. It runs as the staff member signed in.
export const Route = createFileRoute("/_authed/events/$slug/checkin_/kiosk")({
  staticData: { title: msg("kiosk.title"), command: false },
  beforeLoad: ({ context, params }) => {
    if (!can(context.access, "people.checkin")) {
      throw Route.redirect({ to: "/events/$slug", params, replace: true });
    }
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["checkin"]),
      ),
      context.query.ensureQueryData(myRegistrationQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
});

const RESET_MS = 8000;

const whoSchema = (t: T) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("kiosk.enterName"))
      .max(120, t("form.maxLength", { max: 120 }))
      .meta({ label: t("kiosk.name") }),
    email: z
      .email(t("form.validEmail"))
      .meta({ label: t("kiosk.email"), placeholder: "name@example.org" })
      .describe(t("kiosk.emailHelp")),
  });

type Who = z.infer<ReturnType<typeof whoSchema>>;

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["checkin"]),
  );
  const { data: registration } = useSuspenseQuery(myRegistrationQueryOptions(event.id));
  const queryClient = useQueryClient();
  const [who, setWho] = useState<Who | null>(null);
  const [done, setDone] = useState<WalkInResult | null>(null);
  // remounts the forms empty for the next person
  const [visitor, setVisitor] = useState(0);

  const next = () => {
    setWho(null);
    setDone(null);
    setVisitor((count) => count + 1);
  };
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(next, RESET_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const submit = async (person: Who, answers: Record<string, unknown> = {}) => {
    const result = await walkInFn({ data: { eventId: event.id, ...person, answers } }).catch(
      requestFailure,
    );
    if (result.ok) {
      setDone(result.data);
      await queryClient.invalidateQueries({
        queryKey: checkinRosterQueryOptions(event.id).queryKey,
      });
    }
    return result;
  };

  if (!settings.checkin.allowWalkIns) {
    return (
      <Screen title={t("kiosk.title")} width="narrow">
        <Alert>
          <AlertTitle>{t("kiosk.offTitle")}</AlertTitle>
          <AlertDescription>
            <Linked
              text={t("kiosk.offBody", { setting: LINK })}
              links={[
                <SettingLink
                  key="setting"
                  to={`/events/${event.slug}/manage/registration`}
                  hash="checkin.allowWalkIns"
                >
                  {t("path.walkIns")}
                </SettingLink>,
              ]}
            />
          </AlertDescription>
        </Alert>
      </Screen>
    );
  }

  return (
    <Screen
      title={t("kiosk.welcome", { event: event.name })}
      description={t("kiosk.intro")}
      width="narrow"
      actions={
        <Button
          variant="outline"
          onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
        >
          <IconMaximize />
          {t("kiosk.fullScreen")}
        </Button>
      }
    >
      {done ? (
        <div role="status" className="flex flex-col items-center gap-4 py-12 text-center">
          <IconCircleCheck className="size-16 text-primary-text" />
          <h2 className="font-heading text-2xl font-semibold">
            {done.checkedIn
              ? t("kiosk.checkedIn", { name: done.name })
              : t("kiosk.registered", { name: done.name })}
          </h2>
          <p className="max-w-md text-muted-fg">
            {done.checkedIn ? t("kiosk.checkedInHelp") : t("kiosk.registeredHelp")}
          </p>
          <Button size="lg" onClick={next}>
            {t("kiosk.next")}
          </Button>
        </div>
      ) : who === null ? (
        <WhoForm
          key={visitor}
          hasQuestions={registration.form.length > 0}
          onSubmit={async (person) => {
            if (registration.form.length > 0) {
              setWho(person);
              return null;
            }
            const result = await submit(person);
            return result.ok ? null : result.error.message;
          }}
        />
      ) : (
        <OnboardingForm
          key={visitor}
          eventId={event.id}
          startsOn={
            event.starts_at ? isoToWallTime(event.starts_at, event.timezone).slice(0, 10) : null
          }
          questions={registration.form}
          submitLabel={t("kiosk.checkIn")}
          onSubmit={(answers) => submit(who, answers)}
        />
      )}
    </Screen>
  );
}

function WhoForm({
  hasQuestions,
  onSubmit,
}: {
  hasQuestions: boolean;
  onSubmit: (person: Who) => Promise<string | null>;
}) {
  const t = useT();
  const schema = useMemo(() => whoSchema(t), [t]);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { name: "", email: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const failed = await onSubmit({ name: value.name.trim(), email: value.email.trim() });
      return failed ? createValidationError(failed) : undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
        <form.Field name="name">
          {(field) => <field.TextField required autoComplete="off" />}
        </form.Field>
        <form.Field name="email">
          {(field) => <field.TextField type="email" required autoComplete="off" />}
        </form.Field>
        <form.FormAlert title={t("checkin.walkInFailed")} />
        <form.Submit size="lg" pending={t("checkin.registering")}>
          {hasQuestions ? t("kiosk.continue") : t("kiosk.checkIn")}
        </form.Submit>
      </form.Form>
    </form.AppForm>
  );
}
