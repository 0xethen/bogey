import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { sessionQueryOptions } from "@bogey/db/auth";
import { inviteLinkViewQueryOptions } from "@bogey/db/queries/invites";
import { myRegistrationQueryOptions, registerFn } from "@bogey/db/queries/registration";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { OnboardingForm } from "#/components/event/team/onboarding-form.tsx";
import { PublicBar } from "#/components/navigation/header/PublicBar.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/join/$token")({
  staticData: { title: msg("join.title") },
  loader: async ({ context, params }) => {
    const [link] = await Promise.all([
      context.query.ensureQueryData(inviteLinkViewQueryOptions(params.token)),
      context.query.ensureQueryData(sessionQueryOptions()),
    ]);
    return { title: link?.eventName ?? "" };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { token } = Route.useParams();
  const { data: link } = useSuspenseQuery(inviteLinkViewQueryOptions(token));
  const { data: session } = useSuspenseQuery(sessionQueryOptions());
  const signedIn = session.status === "authenticated";

  if (!link) {
    return (
      <>
        <PublicBar floating />
        <Screen.Auth title={t("join.broken")} description={t("join.brokenHelp")} />
      </>
    );
  }

  return (
    <>
      <PublicBar orgName={link.orgName} floating signIn={false} />
      <Screen.Auth
        wide={signedIn && link.isOpen && link.form.length > 0}
        title={link.isOpen ? t("join.invited", { event: link.eventName }) : link.eventName}
        description={link.isOpen ? t("join.hostedBy", { org: link.orgName }) : t("join.closed")}
      >
        {link.isOpen &&
          (signedIn ? (
            <SignedInJoin token={token} eventId={link.eventId} eventSlug={link.eventSlug} />
          ) : (
            <div className="flex flex-col gap-3 text-center">
              <Button
                className="w-full"
                nativeButton={false}
                render={
                  <Link to="/auth/login" search={{ redirect: `/join/${token}`, invite: token }} />
                }
              >
                {t("join.signIn")}
              </Button>
              <p className="text-sm text-muted-fg">{t("join.newHere")}</p>
            </div>
          ))}
      </Screen.Auth>
    </>
  );
}

function SignedInJoin({
  token,
  eventId,
  eventSlug,
}: {
  token: string;
  eventId: string;
  eventSlug: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: link } = useSuspenseQuery(inviteLinkViewQueryOptions(token));
  const mine = useQuery(myRegistrationQueryOptions(eventId));
  const status = mine.data?.registration?.status;

  if (mine.isPending) return null;

  if (status === "approved") {
    return (
      <div className="flex flex-col gap-3 text-center">
        <p className="text-sm">{t("join.registered")}</p>
        <Button
          className="w-full"
          nativeButton={false}
          render={<Link to="/events/$slug" params={{ slug: eventSlug }} />}
        >
          {t("welcome.goToEvent")}
        </Button>
      </div>
    );
  }
  if (status === "pending") {
    return <p className="text-center text-sm text-muted-fg">{t("join.pending")}</p>;
  }
  if (status === "waitlisted") {
    return <p className="text-center text-sm text-muted-fg">{t("join.waitlisted")}</p>;
  }
  if (status === "rejected") {
    return <p className="text-center text-sm text-muted-fg">{t("join.rejected")}</p>;
  }

  return (
    <OnboardingForm
      eventId={eventId}
      startsOn={link?.startsOn ?? null}
      questions={link?.form ?? []}
      previous={mine.data?.registration?.answers}
      onSubmit={(answers) => registerFn({ data: { eventId, answers, token } })}
      onDone={() =>
        queryClient.invalidateQueries({ queryKey: myRegistrationQueryOptions(eventId).queryKey })
      }
    />
  );
}
