import { createFileRoute, Link } from "@tanstack/react-router";
import { IconCertificate } from "@tabler/icons-react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { Screen } from "@bogey/ui/components/screen";
import { Row, RowList } from "@bogey/ui/components/row";
import { msg, sayOr, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/certificates")({
  staticData: { title: msg("certificates.title") },
  loader: ({ context }) =>
    context.query.ensureQueryData(myCertificatesQueryOptions(context.event.id)),
  component: RouteComponent,
});

function CertificateRow({ option, eventId }: { option: CertificateOption; eventId: string }) {
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
    <Row
      render={<li />}
      title={title}
      actions={
        option.code ? (
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/certificates/$code" params={{ code: option.code }} />}
            nativeButton={false}
          >
            {t("certificates.open")}...
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={claim.isPending}
            onClick={() => claim.mutate()}
          >
            {t("certificates.get")}
          </Button>
        )
      }
    >
      {claim.error && <ErrorAlert error={claim.error} />}
      {option.code && <span className="sr-only">{verificationPath(option.code)}</span>}
    </Row>
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
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconCertificate />
            </EmptyMedia>
            <EmptyTitle>{t("certificates.noneTitle")}</EmptyTitle>
            <EmptyDescription>{t("certificates.none")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <RowList render={<ul />}>
          {options.map((option) => (
            <CertificateRow
              key={`${option.kind}:${option.awardId ?? ""}`}
              option={option}
              eventId={event.id}
            />
          ))}
        </RowList>
      )}
    </Screen>
  );
}
