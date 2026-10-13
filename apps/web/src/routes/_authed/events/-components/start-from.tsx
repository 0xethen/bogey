import { useNavigate } from "@tanstack/react-router";
import type { EventSummary } from "@bogey/db/queries/events";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { useT } from "#/lib/translate.tsx";

export function StartFrom({ events, value }: { events: Tuple<EventSummary>; value: string }) {
  const t = useT();
  const navigate = useNavigate();
  if (events.length === 0) return null;
  const options = [
    { value: "", label: t("newEvent.blank") },
    ...events
      .filter((event) => event.is_template)
      .map((event) => ({ value: event.id, label: t("newEvent.template", { name: event.name }) })),
    ...events
      .filter((event) => !event.is_template)
      .map((event) => ({ value: event.id, label: event.name })),
  ];
  return (
    <Field>
      <FieldLabel htmlFor="start-from">{t("newEvent.startFrom")}</FieldLabel>
      <OptSelect
        id="start-from"
        value={value}
        options={options}
        onChange={(from) => {
          if (from === value) return;
          void (from
            ? navigate({ to: "/events/copy", search: { from } })
            : navigate({ to: "/events/new" }));
        }}
      />
    </Field>
  );
}
