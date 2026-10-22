# Tables

Lists of records (people, registrations, the audit log) use `DataTable` from `@bogey/ui/components/data-table`. It is
built on TanStack Table and follows the shadcn Data Table guide: sortable headers, a search box, faceted filters, a
columns menu, checkboxes with select-all, pagination and rows gathered under headers that open and close.

## Columns

Make a column helper for your row type once, outside the component, and build the columns with it:

```tsx
const column = dataColumns<Person>();

const columns = column.columns([
  column.accessor("name", { header: t("checkin.name") }),
  column.accessor((row) => row.team ?? "", { id: "team", header: t("managePeople.teamColumn") }),
  column.display({ id: "actions", header: () => <span className="sr-only">...</span>, cell: ... }),
]);
```

- Accessor columns sort when their header is clicked (up, down, then off). Display columns don't. Pass
  `enableSorting: false` to stop one.
- A column the columns menu lists is named by its header when that's text, else by `meta: { label }`. Pass
  `enableHiding: false` for columns that should always show, like the name and the row's actions.
- Memoize `columns`. Rows only redraw when their data, the columns, the shown columns or their own checkbox change,
  so a new `columns` on every render redraws every row.

## Options

```tsx
<DataTable
  columns={columns}
  data={rows}
  getRowId={(row) => row.id}
  pageSize={50}
  selection={{ selected, onChange: setSelected, label: (row) => row.name }}
  search={{ text: (row) => `${row.name} ${row.email}`, placeholder: t("...") }}
  filters={filters}
  columnsMenu
  groups={groups}
  toolbar={<OptSelect ... />}
/>
```

- `pageSize`: rows per page to start with; the controls under the table change it. Leave it out to show every row.
  Searching, filtering and sorting go back to the first page.
- `selection`: a checkbox per row. The header box picks the rows on the page, then offers to pick every row that
  matches.
- `search`: a search box. A row matches when every word typed is in `text(row)`; it filters a moment after typing
  stops. Keep `text` stable, like a module-level function.
- `filters`: one control per entry, filtering a column by its values. A row's values are the column's
  `getUniqueValues(row)` when it defines one (handy for lists, like a person's roles), else its value. Each entry is a
  combobox of `options` with how many rows have each, picking any number. With `single: { all }` it's a select of one
  value instead, `all` labelling "no filter"; use that for short fixed lists like checked in or not.
- `columnsMenu`: a menu to show and hide columns. `hidden` lists the ones hidden to start with.
- `groups`: `by(row)` gives each row a group key and `label(key, rows)` its header. Headers show a chevron, the count
  and, with `selection`, a checkbox for the whole group. Groups are ordered by key, or by `compare`. `collapsed`
  starts them closed. Pages count headers and open rows, and a group split across pages repeats its header.
- `detail`: an arrow on each row that opens `detail(row)` beneath it.
- `toolbar`: more controls at the end of the toolbar, like a "Group rows" select.

Keep `filters` and `groups` memoized like `columns`.

## Keeping big tables fast

Pass rows that keep their identity while nothing about them changed. When a row is put together from several queries
(Manage → People joins members with check-ins and tags), reuse the previous row object when its parts are the same
(`useStableRows` in `manage/people.tsx`). Values every row shows but that change often, like "a save is in flight",
belong in a React context the cells read, not in the columns.

The file opts out of the React Compiler (`"use no memo"`) because TanStack Table changes its column and row objects in
place.
