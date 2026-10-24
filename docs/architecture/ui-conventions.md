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
- Rows have a minimum height (`min-h-14`, `min-h-11` for `sm`), so a row with actions and one without line up. Every row kind puts `leading` in the same slot (icons without a size class become `size-5`), so icons line up down the list. Table cells are a fixed `h-11` whether they hold text, a badge or a small button.
- In a `DataTable`, set `meta: { align: "end" }` on number columns; an `actions` column is end-aligned and shrinks to its content by default.

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

## Passing data down

A component reads what it needs where it is, instead of taking it as a prop only to hand it to a child. Pick the tool by where the data comes from:

| Data                                                                  | How a component gets it                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The event being shown                                                 | `useEvent()` from `#/lib/viewer.ts`. Anything under `/events/$slug` can call it.                                                                                                                                                       |
| Other route data (params, search, loader data, `beforeLoad` context)  | In the route's own file, `Route.useParams()`, `Route.useSearch()`, `Route.useLoaderData()`, `Route.useRouteContext({ select })`. In `-components/` and `components/`, `getRouteApi("/_authed/events/$slug")` and the same hooks on it. |
| What the viewer may do                                                | `useEventViewer()` (respects "View as"), `useCan(...)`.                                                                                                                                                                                |
| Server data                                                           | The leaf calls `useSuspenseQuery` / `useQuery` with the shared query options (`eventPrizesQueryOptions(eventId)` and so on). The cache dedupes, so two components reading the same query cost one request.                             |
| State a whole subtree shares (an editor's draft, a plugin's settings) | A small typed context next to that subtree, like `withChallenges` / `useChallenges()` in the challenges plugin. One per feature, never one app-wide context.                                                                           |

- Props are still right for what the parent decides: which row this is, open/closed, callbacks, and values the parent computed.
- Components that work in more than one place keep their props: `@bogey/ui` primitives, settings sections that take a `scope` (org, event or instance), and plugin slots, whose props are the plugin API.
- A component used outside the event routes (the join page's `OnboardingForm`) takes `eventId` as a prop, since there's no event route to read.

## Motion

Motion lives in `packages/ui/src/styles/motion.css`: duration and easing tokens (`--motion-hover`, `--motion-enter`, `--motion-exit`, `--motion-expand`, `ease-emphasized`) and a utility per kind of movement. Use the utility, not ad-hoc `duration-*`/`animate-in` classes.

| Utility           | Use it for                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `motion-hover`    | Color, background, border and shadow changes on hover, focus and press (buttons, rows, links, menu items, tabs).                                     |
| `motion-popup`    | Floating popups (menus, selects, comboboxes, popovers, tooltips). Fades and grows from the trigger, sliding a few pixels away from the trigger side. |
| `motion-dialog`   | Centered dialogs. Fades and grows, no slide.                                                                                                         |
| `motion-fade`     | Backdrops and anything that only fades.                                                                                                              |
| `motion-collapse` | Collapsible panels, which open to their measured height.                                                                                             |

- Enter is short (150ms, ease-out); exit is shorter (100ms, ease-in). Hover is 120ms. Expanding and chevron turns are 200ms.
- Animate only opacity, transform (scale, translate, rotate) and colors. Never animate width, padding or margin; the one exception is a collapsible's height, which is the point of it.
- Things that appear because of what people do (popups, dialogs, panels, toasts) animate. Things that are just there on load (pages, lists, table rows) don't.
- Reduced motion (the device setting, or Account > Accessibility) turns every transition and animation to an instant change, except spinners.

## Draggable lists

Reorderable lists use `EditableList` and `EditableListItem` from `@bogey/ui/components/editable-list`; don't style rows in the caller. Every row has the same grip at the start, its preview (or fields while editing), and icon actions at the end (`actions` for extra buttons before the built-in edit, duplicate and remove). A row's preview starts at `text-sm`; give titles `font-medium` and details `text-muted-fg`, not headings.

- While dragging, the row lifts (shadow and ring) and a dashed slot or a drop line shows where it lands. Under reduced motion (system or the account's setting, `useReducedMotion`) rows move without animating.
- Alt with an arrow key on the grip moves a row one place, keeps focus on it and announces the new position. Space on the grip also picks it up (dnd-kit's keyboard sensor).
- Items with a large preview, like homepage blocks, pass `title` and `icon`: the header names the item and the preview sits below it, still shown while editing so changes are live.

## Homepage editor

Customize on the event homepage follows Framer and Notion: the page is the canvas, a side panel (from `xl`) edits the selected block or, with nothing selected, shows a searchable block picker you can click or drag from. Each column also has an "Add a block..." popover, like Notion's insert menu. Hiding keeps a block's place and settings (`hidden` on the block). Below `xl` a selected block opens for editing in place.
