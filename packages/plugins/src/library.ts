import { z } from "zod";
import { PLUGIN_KEY, SEMVER } from "@bogey/utils/keys";
import { compareVersions, parseRepository } from "./api.ts";
import type { Fetcher } from "./updates.ts";

export const OFFICIAL_LIBRARY = "github:0xethen/bogeyx";

export const LIBRARIES_FILE = "bogey.libraries.json";

export const LIBRARY_INDEX_VERSION = 1;

const REPOSITORY = /^github:[\w.-]+\/[\w.-]+$/;
const DIRECTORY = /^(?!(.*\/)?\.\.?(\/|$))[a-z0-9._-]+(\/[a-z0-9._-]+)*$/;

export const LibraryPluginSchema = z
  .object({
    key: z.string().regex(PLUGIN_KEY).describe("The plugin's key, the folder name."),
    name: z.string().min(1).max(80),
    version: z.string().regex(SEMVER).describe("The latest released version."),
    description: z.string().max(500),
    api: z.number().int().positive().nullable().describe("The Bogey plugin API it is written for."),
    tag: z.string().describe("The release tag, `<key>-v<version>`."),
    directory: z
      .string()
      .regex(DIRECTORY)
      .describe("Where the plugin is in the repository, such as `plugins/discord`."),
    author: z.string().max(120).optional(),
    license: z.string().max(60).optional(),
  })
  .strict()
  .refine((plugin) => plugin.tag === `${plugin.key}-v${plugin.version}`, {
    message: "tag must be <key>-v<version>",
    path: ["tag"],
  });

export const LibraryIndexSchema = z
  .object({
    $schema: z.string().optional(),
    schema: z.literal(LIBRARY_INDEX_VERSION).describe("The index format version."),
    name: z.string().min(1).max(80).describe("What the library is called."),
    description: z.string().max(500).optional(),
    repository: z
      .string()
      .regex(REPOSITORY)
      .describe("Where its plugins are released, `github:<owner>/<repo>`."),
    plugins: z.array(LibraryPluginSchema),
  })
  .strict()
  .refine(
    (index) => new Set(index.plugins.map((plugin) => plugin.key)).size === index.plugins.length,
    {
      message: "each plugin key may appear once",
      path: ["plugins"],
    },
  );

export type LibraryPlugin = z.infer<typeof LibraryPluginSchema>;
export type LibraryIndex = z.infer<typeof LibraryIndexSchema>;

export const LibrariesFileSchema = z
  .object({
    $schema: z.string().optional(),
    libraries: z
      .array(z.string().regex(REPOSITORY))
      .describe("GitHub repositories to search for plugins, as `github:<owner>/<repo>`."),
  })
  .strict();

export type LibrariesFile = z.infer<typeof LibrariesFileSchema>;

export function librarySchemas() {
  return {
    index: z.toJSONSchema(LibraryIndexSchema, { target: "draft-7" }),
    libraries: z.toJSONSchema(LibrariesFileSchema, { target: "draft-7" }),
  };
}

export interface LibrarySource {
  owner: string;
  repo: string;
  source: string;
}

export function parseLibrarySource(text: string): LibrarySource | string {
  const parsed = REPOSITORY.test(text) ? parseRepository(text) : null;
  if (!parsed) return `"${text}" isn't github:<owner>/<repo>`;
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    source: `github:${parsed.owner}/${parsed.repo}`,
  };
}

export const libraryIndexUrl = (library: LibrarySource) =>
  `https://raw.githubusercontent.com/${library.owner}/${library.repo}/HEAD/index.json`;

export type FetchedLibrary =
  | { ok: true; source: string; index: LibraryIndex }
  | { ok: false; source: string; error: string };

export async function fetchLibrary(source: string, fetcher: Fetcher): Promise<FetchedLibrary> {
  const library = parseLibrarySource(source);
  if (typeof library === "string") return { ok: false, source, error: library };
  try {
    const response = await fetcher(libraryIndexUrl(library));
    if (!response.ok) {
      return {
        ok: false,
        source,
        error:
          response.status === 404 ? "has no index.json at its root" : `answered ${response.status}`,
      };
    }
    const parsed = LibraryIndexSchema.safeParse(await response.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        source,
        error: `index.json isn't a library index (${issue?.path.join(".") || "root"}: ${issue?.message})`,
      };
    }
    return { ok: true, source, index: parsed.data };
  } catch (error) {
    return {
      ok: false,
      source,
      error: `couldn't be reached (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

export interface Listing extends LibraryPlugin {
  library: string;
  repository: string;
}

export function listings(libraries: Tuple<FetchedLibrary>): Listing[] {
  return libraries.flatMap((library) =>
    library.ok
      ? library.index.plugins.map((plugin) => ({
          ...plugin,
          library: library.source,
          repository: library.index.repository,
        }))
      : [],
  );
}

export function searchListings(all: Tuple<Listing>, text: string): Listing[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter((plugin) => {
      const haystack = `${plugin.key} ${plugin.name} ${plugin.description}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => a.key.localeCompare(b.key) || a.library.localeCompare(b.library));
}

export function findListing(all: Tuple<Listing>, key: string, library?: string): Listing | string {
  const matches = all.filter(
    (plugin) => plugin.key === key && (library === undefined || plugin.library === library),
  );
  if (matches.length === 0) {
    return library ? `${library} has no plugin "${key}"` : `no library has a plugin "${key}"`;
  }
  if (matches.length > 1) {
    return `"${key}" is in ${matches.map((plugin) => plugin.library).join(" and ")}; name one: github:<owner>/<repo>/${key}@<version>`;
  }
  return matches[0] as Listing;
}

export const isNewer = (listing: Pick<Listing, "version">, installed: string) =>
  compareVersions(listing.version, installed) > 0;
