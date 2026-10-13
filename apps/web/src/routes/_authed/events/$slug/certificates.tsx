import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  claimCertificateFn,
  myCertificatesQueryOptions,
  type CertificateOption,
} from "@bogey/db/queries/certificates";
import { unwrap } from "@bogey/db/errors";
import { CERTIFICATE_LABELS, verificationPath } from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { msg, sayOr, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/certificates")({
  staticData: { title: msg("certificates.title") },
  loader: ({ context }) =>
    context.query.ensureQueryData(myCertificatesQueryOptions(context.event.id)),
  component: RouteComponent,
});

function Row({ option, eventId }: { option: CertificateOption; eventId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const claim = useMutation({
    mutationFn: async () =>
      unwrap(
        await claimCertificateFn({ data: { eventId, kind: option.kind, awardId: option.awardId } }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: myCertificatesQueryOptions(eventId).queryKey }),
  });
  const kind = sayOr(t, `certKind.${option.kind}`, CERTIFICATE_LABELS[option.kind]);
  const title = option.label ? t("certificates.kindLabel", { kind, label: option.label }) : kind;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span>{title}</span>
      {option.code ? (
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/certificates/$code" params={{ code: option.code }} />}
        >
          {t("certificates.open")}
        </Button>
      ) : (
        <span className="flex items-center gap-2">
          <ErrorAlert error={claim.error} />
          <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate()}>
            {t("certificates.get")}
          </Button>
        </span>
      )}
      <span className="sr-only">{option.code ? verificationPath(option.code) : ""}</span>
    </li>
  );
}

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: options } = useSuspenseQuery(myCertificatesQueryOptions(event.id));
  return (
    <Screen
      title={t("certificates.title")}
      description={t("certificates.intro", { event: event.name })}
      width="narrow"
    >
      {options.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("certificates.none")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {options.map((option) => (
            <Row
              key={`${option.kind}:${option.awardId ?? ""}`}
              option={option}
              eventId={event.id}
            />
          ))}
        </ul>
      )}
    </Screen>
  );
}
