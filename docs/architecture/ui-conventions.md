# UI conventions

Which `@bogey/ui` primitive to reach for, and how loud it should be. When a screen needs something these don't cover, add a variant to the primitive rather than a one-off class string in the app.

## Rows

Most lists in Bogey are rows in a divided list, from `@bogey/ui/components/row`:

| Primitive       | Use it for                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RowList`       | The list itself. `divided` (default) rules it above and below, `flush` drops the outer rules (inside a panel or under a small heading), `boxed` puts it in a bordered box among other controls. |
| `Row`           | A row with a `title`, a `meta` line, `actions` at the end and optional `children` under it (errors, details). Pass `id` to make it a jump target.                                               |
| `LinkRow`       | A row that goes somewhere. The whole row is the link and ends in a chevron.                                                                                                                     |
| `DisclosureRow` | A row that opens in place to show more. Without children it's a plain row with a title and actions.                                                                                             |

Pass `render={<ul />}` to `RowList` and `render={<li />}` to `Row` when the list needs list semantics.

- Records with columns, sorting or filters are a `DataTable` instead (see [Tables](tables.md)).
- A single standalone row (a call-out like "Open the kiosk") is an `Item variant="outline"`.
- A group of controls with a heading is a `Panel`. Don't hand-roll `rounded-2xl border p-4` boxes.
- Don't stack bordered cards to make a list; use a `RowList`. Cards are for things people drag, compare side by side or pick from (sessions on the agenda, gallery projects).

## Fields

Every labelled control is drawn by one frame, `FieldFrame` in `@bogey/ui/components/field`. Its `layout` is one of three:

| Layout   | Use it for                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stack`  | Wide controls: text, Markdown, lists, multi-selects. The control sits under the label and the description under the control.                                                                                                                       |
| `row`    | Short controls: numbers, selects, a slug, a date. Once the field is wide (36rem, measured on the field itself) the label and description sit left and the control at the right edge; narrower, it stacks. A number in a row is at most 11rem wide. |
| `switch` | A switch beside its label and description.                                                                                                                                                                                                         |

Three things build on it, and nothing else should hand-roll `Field` + `FieldLabel` + `FieldDescription`:

- **Forms** use the `@bogey/ui/lib/form` kit (`field.TextField`, `field.NumberField`, `field.SwitchField`, ...), which picks the layout per control and adds the error and anchor.
- **Settings** use `SettingRow` from `apps/web/src/components/settings/fields/setting-fields.tsx`: the label with reset and lock buttons, and a note on where the value comes from ("From the organization", "Locked by the instance"). `SettingFields` renders registry settings with it, plugin settings use it in `plugin-settings.tsx`, and pages with their own settings (Account → Preferences, Accessibility) use it directly.
- **Bare controls** (a table cell, a toolbar) use the control alone: `NumberInput`, `OptSelect`, `Switch`, `Input`.

`NumberInput` is the only number control. `scrub` adds a drag handle before the field. For a number where 0 means "no limit" or "off", pass `emptyLabel` (a registry setting sets `empty: "noLimit" | "off"`, a plugin setting `emptyLabel`): a 0 shows as an empty field reading the label once you leave it, and leaving the field empty saves 0. Don't explain the 0 in the description.

## Buttons

| Variant             | When                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` (primary) | The one main action of a screen, form or dialog: Save, Create, Submit, Next. At most one per group, and not repeated on every row of a list.                |
| `secondary`         | The main action of a smaller part when the page already has its own primary (a panel's Save, "Set up" in a row), or a weighty action on its own (Sign out). |
| `outline`           | Ordinary actions beside content: row actions, toolbar actions, Back next to Next, Copy, Export, Open.                                                       |
| `ghost`             | Quiet actions: icon buttons, Cancel and Reset beside a primary, toggles in a toolbar.                                                                       |
| `ghost-destructive` | A quiet destructive action: a trash icon on a row, Remove beside other row actions.                                                                         |
| `destructive`       | A destructive action that should stand out, and the confirm button in a destructive dialog.                                                                 |
| `link`              | An action inside a sentence.                                                                                                                                |

Destructive actions go behind `confirm`. Don't recolor a button with `className="text-..."`; pick the variant.

## Pickers and menus

| Primitive                        | Use it for                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OptSelect` / `FieldSelect`      | Choosing one value from a short, fixed list (up to about ten): roles, sizes, modes.                                                                 |
| `SearchSelect` / `FieldCombobox` | Choosing one value from a long or growing list that people search: timezones, people, events, tags.                                                 |
| `MultiSelect`                    | Choosing several values from a list.                                                                                                                |
| `DropdownMenu`                   | Actions, not values: a "..." menu, an account menu, "New ..." with kinds. Radio items only for a view setting that applies at once (sort, density). |
| `NavigationMenu`                 | Moving between pages in the header.                                                                                                                 |
| `Command` (⌘K)                   | Searching and jumping anywhere in the app.                                                                                                          |

`NativeSelect` is for surfaces that avoid popups (the operator console); the web app uses `OptSelect`.

## Color

- **Primary** marks the main action and things that are on: the default button, checked checkboxes, radios and switches, progress and steppers, counts on badges, the live dot. Text links, hovers, icons in chips, selected tiles and drop targets are not primary.
- **Accent** (`bg-accent`) is a faint wash for "this one": a hovered or selected tile, a drop target, the highlighted row in a ranking, and the flash when a `#id` link lands on a setting or section. It's lighter than `muted` and carries only a hint of the brand hue.
- **Muted** (`bg-muted`, `text-muted-fg`) is for secondary surfaces and text: icon chips, meta lines, empty states.
- Tones (`warning`, `destructive`, emerald for success, sky for info) carry meaning; use them only for that meaning.
