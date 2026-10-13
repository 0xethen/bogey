import { useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WEBHOOK_KINDS,
  createWebhookFn,
  deleteWebhookFn,
  resendWebhookDeliveryFn,
  rotateWebhookSecretFn,
  updateWebhookFn,
  webhookDeliveriesQueryOptions,
  webhookFormat,
  webhooksQueryOptions,
  type Webhook,
} from "@bogey/db/queries/webhooks";
import { IconCopy, IconEye, IconEyeOff } from "@tabler/icons-react";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldSet } from "@bogey/ui/components/field";
import { Panel } from "@bogey/ui/components/panel";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bogey/ui/components/table";
import { toast } from "@bogey/ui/components/toast";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { sayOr, useT, type T } from "#/lib/translate.tsx";

interface Scope {
  orgId: string;
  eventId?: string;
}

const kindLabel = (t: T, key: string): string =>
  sayOr(t, `webhookKind.${key}`, WEBHOOK_KINDS.find((kind) => kind.key === key)?.label ?? key);

function KindPicker({
  value,
  onChange,
  onBlur,
  legend,
}: {
  value: readonly string[];
  onChange: (kinds: string[]) => void;
  onBlur: () => void;
  legend: ReactNode;
}) {
  const t = useT();
  return (
    <FieldSet className="gap-2" onBlur={onBlur}>
      {legend}
      {WEBHOOK_KINDS.map((kind) => (
        <label key={kind.key} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.includes(kind.key)}
            onCheckedChange={(checked) =>
              onChange(checked ? [...value, kind.key] : value.filter((each) => each !== kind.key))
            }
          />
          {kindLabel(t, kind.key)}
        </label>
      ))}
    </FieldSet>
  );
}

const webhookSchema = (t: T) =>
  z.object({
    url: z
      .string()
      .trim()
      .min(1, t("webhooks.needAddress"))
      .refine(
        (value) => value.startsWith("https://") && URL.canParse(value),
        t("webhooks.needHttps"),
      )
      .meta({ label: t("webhooks.address"), placeholder: "https://example.com/bogey" }),
    events: z
      .array(z.string())
      .min(1, t("webhooks.needOne"))
      .meta({ label: t("webhooks.sendMe") })
      .describe(t("webhooks.sendMeHelp")),
  });

function copy(text: string, t: T) {
  void navigator.clipboard.writeText(text).then(() => toast.add({ title: t("common.copied") }));
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function SecretNotice({ secret, onDone }: { secret: string; onDone: () => void }) {
  const t = useT();
  return (
    <Screen.Section title={t("webhooks.copySecret")} description={t("webhooks.secretHelp")}>
      <code className="rounded-xl bg-muted p-2 text-xs break-all">{secret}</code>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onDone}>
          {t("webhooks.savedIt")}
        </Button>
        <Button size="sm" onClick={() => copy(secret, t)}>
          {t("common.copy")}
        </Button>
        <Button size="sm" onClick={() => download("bogey-webhook-secret.txt", `${secret}\n`)}>
          {t("webhooks.downloadSecret")}
        </Button>
      </span>
    </Screen.Section>
  );
}

// Chat webhook addresses carry their own secret, so the path stays hidden until asked for.
function WebhookAddress({ url }: { url: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const host = URL.canParse(url) ? new URL(url).host : url;
  const toggle = shown ? t("webhooks.hideAddress") : t("webhooks.showAddress");
  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="min-w-0 text-sm break-all">{shown ? url : `https://${host}/••••••`}</code>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={toggle}
        title={toggle}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? <IconEyeOff /> : <IconEye />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("webhooks.copyAddress")}
        title={t("webhooks.copyAddress")}
        onClick={() => copy(url, t)}
      >
        <IconCopy />
      </Button>
    </span>
  );
}

const FORMAT_NAMES = { discord: "Discord", slack: "Slack" } as const;

function AddWebhook({ scope, onSecret }: { scope: Scope; onSecret: (secret: string) => void }) {
  const t = useT();
  const schema = useMemo(() => webhookSchema(t), [t]);
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { url: "", events: [] as string[] },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await createWebhookFn({
        data: {
          orgId: scope.orgId,
          eventId: scope.eventId ?? null,
          url: value.url,
          events: value.events,
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      onSecret(result.data.secret);
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      return undefined;
    },
  });
  return (
    <Screen.Section title={t("webhooks.add")} description={t("webhooks.addHelp")}>
      <form.AppForm>
        <form.Form className="flex flex-col gap-4">
          <form.Field name="url">
            {(field) => <field.TextField type="url" autoComplete="off" />}
          </form.Field>
          <form.Field name="events">
            {(field) => (
              <field.Field>
                <KindPicker
                  value={field.value}
                  onChange={(kinds) => field.handleChange(kinds)}
                  onBlur={field.handleBlur}
                  legend={<field.Legend />}
                />
                <field.Description />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.FormAlert title={t("webhooks.addFailed")} />
          <div>
            <form.Submit pending={t("webhooks.adding")}>{t("webhooks.addButton")}</form.Submit>
          </div>
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

function WebhookRow({ hook, onSecret }: { hook: Webhook; onSecret: (secret: string) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["webhooks"] });
  const disabled = hook.disabled_at !== null;
  const format = webhookFormat(hook.url);
  const toggle = useMutation({
    mutationFn: async () =>
      unwrap(
        await updateWebhookFn({
          data: { id: hook.id, url: hook.url, events: hook.events, disabled: !disabled },
        }),
      ),
    onSuccess: refresh,
  });
  const rotate = useMutation({
    mutationFn: async () => unwrap(await rotateWebhookSecretFn({ data: hook.id })),
    onSuccess: onSecret,
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await deleteWebhookFn({ data: hook.id })),
    onSuccess: refresh,
  });
  return (
    <li className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WebhookAddress url={hook.url} />
        <span className="flex gap-1">
          {format !== "json" && <Badge variant="outline">{FORMAT_NAMES[format]}</Badge>}
          {disabled && <Badge variant="outline">{t("webhooks.off")}</Badge>}
        </span>
      </div>
      <p className="text-sm text-muted-fg">
        {hook.events.map((kind) => kindLabel(t, kind)).join(", ")}
        {hook.event_id === null ? ` · ${t("webhooks.everyEvent")}` : ""}
      </p>
      <ErrorAlert error={toggle.error ?? rotate.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {disabled ? t("webhooks.turnOn") : t("webhooks.turnOff")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          confirm={{
            title: t("webhooks.newSecretTitle"),
            description: t("webhooks.newSecretBody"),
            label: t("webhooks.newSecretLabel"),
            variant: "default",
          }}
          onClick={() => rotate.mutate()}
        >
          {t("webhooks.newSecret")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          confirm={{
            title: t("webhooks.deleteTitle"),
            description: t("webhooks.deleteBody"),
            label: t("webhooks.deleteLabel"),
          }}
          onClick={() => remove.mutate()}
        >
          {t("webhooks.delete")}
        </Button>
      </div>
    </li>
  );
}

function statusLabel(t: T, status: string): string {
  return sayOr(t, `webhookStatus.${status}`, status);
}

function Deliveries({ scope }: { scope: Scope }) {
  const t = useT();
  const queryClient = useQueryClient();
  const deliveries = useQuery(webhookDeliveriesQueryOptions(scope));
  const resend = useMutation({
    mutationFn: async (id: string) => unwrap(await resendWebhookDeliveryFn({ data: id })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhook-deliveries"] }),
  });
  if (!deliveries.data || deliveries.data.length === 0) return null;
  return (
    <Screen.Section title={t("webhooks.recent")} description={t("webhooks.recentHelp")}>
      <ErrorAlert error={deliveries.error instanceof Error ? deliveries.error : resend.error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("webhooks.when")}</TableHead>
            <TableHead>{t("webhooks.event")}</TableHead>
            <TableHead>{t("webhooks.result")}</TableHead>
            <TableHead className="text-right">{t("webhooks.tries")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.data.map((delivery) => (
            <TableRow key={delivery.id}>
              <TableCell>
                <RelativeTime value={delivery.created_at} />
              </TableCell>
              <TableCell>{kindLabel(t, delivery.kind)}</TableCell>
              <TableCell>
                {statusLabel(t, delivery.status)}
                {delivery.response_status ? ` (${delivery.response_status})` : ""}
                {delivery.last_error && delivery.status !== "sent"
                  ? `: ${delivery.last_error}`
                  : ""}
              </TableCell>
              <TableCell className="text-right">{delivery.attempts}</TableCell>
              <TableCell className="text-right">
                {(delivery.status === "sent" || delivery.status === "failed") && (
                  <Button size="sm" variant="ghost" onClick={() => resend.mutate(delivery.id)}>
                    {t("webhooks.sendAgain")}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Screen.Section>
  );
}

export function Webhooks({ scope, title }: { scope: Scope; title: string }) {
  const t = useT();
  const hooks = useQuery(webhooksQueryOptions(scope));
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <Screen title={title} description={t("webhooks.intro")} width="embedded">
      {secret && <SecretNotice secret={secret} onDone={() => setSecret(null)} />}
      <ErrorAlert error={hooks.error instanceof Error ? hooks.error : null} />
      {hooks.data && hooks.data.length > 0 && (
        <Panel title={t("webhooks.title")}>
          <ul className="flex flex-col gap-6">
            {hooks.data.map((hook) => (
              <WebhookRow key={hook.id} hook={hook} onSecret={setSecret} />
            ))}
          </ul>
        </Panel>
      )}
      <AddWebhook scope={scope} onSecret={setSecret} />
      <Deliveries scope={scope} />
    </Screen>
  );
}
