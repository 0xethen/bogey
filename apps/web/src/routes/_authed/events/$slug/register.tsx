import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { myRegistrationQueryOptions, registerFn } from "@bogey/db/queries/registration";
import { eventAccessQueryOptions } from "@bogey/db/permissions";
import { Screen } from "@bogey/ui/components/screen";
import { OnboardingForm } from "#/components/event/team/onboarding-form.tsx";
import { isoToWallTime } from "@bogey/utils/time";
import { canRegister, inEvent } from "#/lib/viewer.ts";
import { useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/register")({
  staticData: { title: "Register", command: { when: inEvent(canRegister) } },
  validateSearch: z.object({ invite: z.string().optional().catch(undefined) }),
  beforeLoad: ({ context, params }) => {
    if (context.access.role || context.access.orgAdmin) {
      throw Route.redirect({ to: "/events/$slug", params, replace: true });
    }
  },
  loader: ({ context }) =>
    context.query.ensureQueryData(myRegistrationQueryOptions(context.event.id)),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { invite } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(myRegistrationQueryOptions(event.id));

  return (
    <Screen title={t("register.title", { event: event.name })} width="narrow">
      <OnboardingForm
        eventId={event.id}
        startsOn={
          event.starts_at ? isoToWallTime(event.starts_at, event.timezone).slice(0, 10) : null
        }
        questions={data.form}
        previous={data.registration?.answers}
        onSubmit={(answers) => registerFn({ data: { eventId: event.id, answers, token: invite } })}
        onDone={async () => {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: myRegistrationQueryOptions(event.id).queryKey,
            }),
            queryClient.invalidateQueries({ queryKey: eventAccessQueryOptions(event.id).queryKey }),
          ]);
          await navigate({ to: "/events/$slug", params: { slug: event.slug } });
        }}
      />
    </Screen>
  );
}
