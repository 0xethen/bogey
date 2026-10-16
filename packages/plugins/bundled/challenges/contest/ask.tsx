import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { z } from "zod";
import { IconMessageQuestion } from "@tabler/icons-react";
import { requestFailure } from "@bogey/db/errors";
import { useEventAccess } from "@bogey/db/permissions";
import {
  AUDIENCES,
  chatBlocksQueryOptions,
  eventConversationsQueryOptions,
  startConversationFn,
} from "@bogey/db/queries/messages";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { Button } from "@bogey/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";

const askSchema = z.object({
  audience: z.enum(AUDIENCES).meta({ label: "To" }),
  body: z
    .string()
    .trim()
    .min(1, "Write what you'd like to ask.")
    .max(10_000)
    .meta({ label: "Question", placeholder: "What's unclear, or what did you expect?" }),
});

const ASK_DEFAULTS: z.input<typeof askSchema> = { audience: "organizers", body: "" };

const RECIPIENTS = [
  { value: "organizers", label: "Organizers" },
  { value: "judges", label: "Judges" },
] as const;

export function AskAbout({
  eventId,
  topic,
  subject,
  label = "Ask about this...",
  size = "sm",
}: {
  eventId: string;
  topic: string;
  subject: string;
  label?: string;
  size?: "sm" | "default";
}) {
  const access = useEventAccess();
  const { data } = useQuery(settingsQueryOptions({ eventId }, ["chat"]));
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug = "" } = useParams({ strict: false });
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: ASK_DEFAULTS,
      errorVisibility,
      validators: [rewardEarlyPunishLate(askSchema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await startConversationFn({
        data: { eventId, subject, body: value.body.trim(), audience: value.audience, topic },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: eventConversationsQueryOptions(eventId).queryKey,
      });
      await navigate({
        to: "/events/$slug/messages",
        params: { slug },
        search: { c: result.data.id },
      });
      return undefined;
    },
  });

  const blocks = useQuery({
    ...chatBlocksQueryOptions(eventId),
    enabled: access?.role === "participant",
  });
  const chat = data?.chat;
  if (access?.role !== "participant" || !chat?.enabled || !chat.participants) return null;
  if (blocks.data?.length) return null;

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <IconMessageQuestion />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{subject}</DialogTitle>
            <DialogDescription>
              Your message goes to Messages, with this attached so they can see what you mean.
            </DialogDescription>
          </DialogHeader>
          <form.AppForm>
            <form.Form unsaved="draft" className="flex flex-col gap-4">
              {chat.judges && (
                <form.Field name="audience">
                  {(field) => (
                    <field.Field>
                      <field.Label />
                      <FieldSelect field={field} options={RECIPIENTS} />
                    </field.Field>
                  )}
                </form.Field>
              )}
              <form.Field name="body">
                {(field) => <field.TextAreaField required rows={5} />}
              </form.Field>
              <form.FormAlert title="Couldn't send it" />
            </form.Form>
            <DialogFooter>
              <form.Submit pending="Sending...">Send</form.Submit>
            </DialogFooter>
          </form.AppForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
