import { useUiText } from "../lib/ui-text.ts";
import { useRef } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "./button.tsx";
import { Input } from "./input.tsx";

export function OptionsInput({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  placeholder,
}: {
  id?: string;
  value: Tuple<string>;
  onChange: (next: string[]) => void;
  onBlur?: () => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const t = useUiText();
  const noun = placeholder ?? t("ui.option");
  const list = useRef<HTMLOListElement>(null);
  const focus = (index: number) =>
    requestAnimationFrame(() => list.current?.querySelectorAll("input")[index]?.focus());
  const set = (index: number, text: string) =>
    onChange(value.map((option, i) => (i === index ? text : option)));
  const add = (after: number) => {
    onChange([...value.slice(0, after + 1), "", ...value.slice(after + 1)]);
    focus(after + 1);
  };

  return (
    <div className="flex flex-col gap-2">
      <ol ref={list} className="flex flex-col gap-2">
        {value.map((option, index) => (
          <li key={index} className="flex items-center gap-2">
            <Input
              id={index === 0 ? id : undefined}
              value={option}
              placeholder={`${noun} ${index + 1}`}
              aria-label={`${noun} ${index + 1}`}
              aria-invalid={invalid || undefined}
              onBlur={onBlur}
              onChange={(event) => set(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add(index);
                }
                if (event.key === "Backspace" && !option && value.length > 1) {
                  event.preventDefault();
                  onChange(value.filter((_, i) => i !== index));
                  focus(Math.max(0, index - 1));
                }
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("ui.removeNamed", {
                name: option || `${noun.toLowerCase()} ${index + 1}`,
              })}
              disabled={value.length === 1}
              tooltip={value.length === 1 ? t("ui.keepOne") : undefined}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <IconX />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-muted border-dashed"
        onClick={() => add(value.length - 1)}
      >
        <IconPlus />
        {t("ui.addNoun", { noun: noun.toLowerCase() })}
      </Button>
    </div>
  );
}
