import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { useTable, type ColumnFiltersState } from "@tanstack/react-table";
import {
  DataTable,
  dataColumns,
  dataTableFeatures,
  searchFilter,
} from "../src/components/data-table.tsx";

interface Person {
  id: string;
  name: string;
  team: string;
  roles: string[];
}

const people: Person[] = [
  { id: "1", name: "Ann Lee", team: "Owls", roles: ["participant"] },
  { id: "2", name: "Bo Diaz", team: "Owls", roles: ["participant", "mentor"] },
  { id: "3", name: "Cy Ng", team: "", roles: ["judge"] },
];

const column = dataColumns<Person>();
const columns = column.columns([
  column.accessor("name", { header: "Name" }),
  column.accessor("team", { header: "Team" }),
  column.accessor((row) => row.roles.join(", "), {
    id: "roles",
    header: "Roles",
    getUniqueValues: (row) => row.roles,
  }),
]);

const search = searchFilter<Person>((row) => `${row.name} ${row.team}`);

function Probe({ filters, query }: { filters: ColumnFiltersState; query: string }) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: people,
    getRowId: (row) => row.id,
    defaultColumn: { filterFn: "oneOf" },
    state: { columnFilters: filters, globalFilter: query },
    globalFilterFn: search,
    getColumnCanGlobalFilter: () => true,
  });
  const ids = table.getRowModel().rows.map((row) => row.id);
  const counts = Object.fromEntries(table.getColumn("roles")?.getFacetedUniqueValues() ?? []);
  return <pre>{JSON.stringify({ ids, counts })}</pre>;
}

function probe(filters: ColumnFiltersState, query = "") {
  const html = renderToStaticMarkup(<Probe filters={filters} query={query} />);
  const json = html.replace(/^<pre>|<\/pre>$/g, "").replaceAll("&quot;", '"');
  const parsed: { ids: string[]; counts: Record<string, number> } = JSON.parse(json);
  return parsed;
}

test("a faceted filter keeps rows with any picked value, from getUniqueValues", () => {
  expect(probe([{ id: "roles", value: ["mentor", "judge"] }]).ids).toEqual(["2", "3"]);
});

test("facet counts leave out the column's own filter but not the search", () => {
  expect(probe([{ id: "roles", value: ["judge"] }]).counts).toEqual({
    participant: 2,
    mentor: 1,
    judge: 1,
  });
  expect(probe([], "owls").counts).toEqual({ participant: 2, mentor: 1 });
});

test("search needs every word, in any order", () => {
  expect(probe([], "owls bo").ids).toEqual(["2"]);
  expect(probe([], "ng").ids).toEqual(["3"]);
  expect(probe([], "ann zed").ids).toEqual([]);
});

test("groups show a header with a count before their rows", () => {
  const html = renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={people}
      getRowId={(row) => row.id}
      groups={{
        by: (row) => row.team,
        label: (key) => key || "No team",
        compare: (a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)),
      }}
    />,
  );
  const owls = html.indexOf("Owls");
  const none = html.indexOf("No team");
  expect(owls).toBeGreaterThan(-1);
  expect(none).toBeGreaterThan(owls);
  expect(html.indexOf("Ann Lee")).toBeGreaterThan(owls);
  expect(html.indexOf("Cy Ng")).toBeGreaterThan(none);
});

test("a page repeats the header of a group it starts inside", () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    name: `Person ${String(index).padStart(2, "0")}`,
    team: "Owls",
    roles: [],
  }));
  const html = renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={many}
      getRowId={(row) => row.id}
      pageSize={25}
      groups={{ by: (row) => row.team, label: (key) => `Team ${key}` }}
    />,
  );
  // a header plus 24 rows fill the first page
  expect(html).toContain("Person 23");
  expect(html).not.toContain("Person 24");
});
