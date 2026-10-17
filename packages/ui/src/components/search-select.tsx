import { useUiText } from "../lib/ui-text.ts";
import {
  Combobox,
  ComboboxInput,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "./combobox.tsx";

export interface SearchSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface OptionGroup {
  value: string;
  items: string[];
}

function groupOptions(options: Tuple<SearchSelectOption>): OptionGroup[] {
  const groups = new Map<string, string[]>();
  for (const option of options) {
    const key = option.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), option.value]);
  }
  return [...groups].map(([value, items]) => ({ value, items }));
}

export function MultiSelect({
  id,
  options,
  value,
  onValueChange,
  placeholder,
  empty,
  always = [],
  disabled,
}: {
  id?: string;
  options: Tuple<SearchSelectOption>;
  value: Tuple<string>;
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  empty?: string;
  /** Values that stay picked: their chips have no remove button. */
  always?: Tuple<string>;
  disabled?: boolean;
}) {
  const t = useUiText();
  const anchor = useComboboxAnchor();
  const labels = new Map(options.map((option) => [option.value, option.label]));
  const label = (key: string) => labels.get(key) ?? key;
  const grouped = options.some((option) => option.group);
  const item = (key: string) => (
    <ComboboxItem key={key} value={key}>
      {label(key)}
    </ComboboxItem>
  );

  return (
    <Combobox
      items={grouped ? groupOptions(options) : options.map((option) => option.value)}
      multiple
      value={[...new Set([...always, ...value])]}
      onValueChange={(next: string[]) => onValueChange([...new Set([...always, ...next])])}
      itemToStringLabel={label}
      disabled={disabled}
    >
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(selected: string[]) =>
            selected.map((key) => (
              <ComboboxChip key={key} showRemove={!always.includes(key)}>
                {label(key)}
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput id={id} placeholder={value.length ? undefined : placeholder} />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>{empty ?? t("cmd.empty")}</ComboboxEmpty>
        <ComboboxList>
          {grouped
            ? (group: OptionGroup) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  {group.value && <ComboboxLabel>{group.value}</ComboboxLabel>}
                  <ComboboxCollection>{item}</ComboboxCollection>
                </ComboboxGroup>
              )
            : item}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function SearchSelect({
  id,
  options,
  value,
  onValueChange,
  placeholder,
  empty,
  className,
}: {
  id?: string;
  options: Tuple<SearchSelectOption>;
  value: string | undefined;
  onValueChange: (value: string | undefined) => void;
  placeholder?: string;
  empty?: string;
  className?: string;
}) {
  const t = useUiText();
  const labels = new Map(options.map((option) => [option.value, option.label]));
  const label = (key: string) => labels.get(key) ?? key;

  return (
    <Combobox
      items={options.map((option) => option.value)}
      value={value ?? null}
      onValueChange={(next: string | null) => onValueChange(next ?? undefined)}
      itemToStringLabel={label}
    >
      <ComboboxInput id={id} placeholder={placeholder} showClear={!!value} className={className} />
      <ComboboxContent>
        <ComboboxEmpty>{empty ?? t("cmd.empty")}</ComboboxEmpty>
        <ComboboxList>
          {(key: string) => (
            <ComboboxItem key={key} value={key}>
              {label(key)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
