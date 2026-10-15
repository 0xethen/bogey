import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

const MARKER = ".bogey-link";
const TSCONFIG_KEY = "tsconfig.json";

const TSCONFIG = `{
  "files": ["./node_modules/@bogey/utils/src/global.d.ts"],
  "include": ["*/**/*"],
  "exclude": ["node_modules"],
  "compilerOptions": {
    "target": "es2024",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "types": ["vite/client", "node"],
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  }
}
`;

export type LinkResult = { ok: true; lines: string[] } | { ok: false; error: string };

function symlink(target: string, path: string): void {
  symlinkSync(relative(realpathSync(dirname(path)), realpathSync(target)), path);
}

export function linkPluginFolder(root: string, folder: string): LinkResult {
  const target = resolve(root, folder);
  if (!existsSync(target) || !lstatSync(target).isDirectory()) {
    return { ok: false, error: `${target} isn't a folder` };
  }
  const pluginsPackage = join(root, "packages", "plugins");
  const source = join(pluginsPackage, "node_modules");
  if (!existsSync(source)) return { ok: false, error: "Run vp install first." };
  const installed = join(pluginsPackage, "installed");

  if (existsSync(installed) || isLink(installed)) {
    const stat = lstatSync(installed);
    if (!stat.isSymbolicLink() && readdirSync(installed).length > 0) {
      return {
        ok: false,
        error: `packages/plugins/installed holds plugins already. Move them into ${target}, or empty it, then link.`,
      };
    }
    rmSync(installed, { recursive: true, force: true });
  }
  const pluginsFolder = join(target, "plugins");
  const holder =
    existsSync(pluginsFolder) && lstatSync(pluginsFolder).isDirectory() ? pluginsFolder : target;
  symlink(realpathSync(holder), installed);

  const modules = join(target, "node_modules");
  const ownDeps = packageDependencies(join(target, "package.json"));
  const tsconfig = join(target, "tsconfig.json");
  let ownTsconfig = false;
  if (ownDeps) {
    // a package installs its own tooling; only add what it doesn't depend on itself
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(modules, MARKER), "links added by `bogey plugins link`\n");
  } else {
    const written = recordedTsconfigHash(join(modules, MARKER));
    ownTsconfig =
      !existsSync(tsconfig) ||
      (written !== undefined && hash(readFileSync(tsconfig, "utf8")) === written);
    if (isLink(modules)) rmSync(modules);
    else if (existsSync(modules)) {
      if (!existsSync(join(modules, MARKER))) {
        return {
          ok: false,
          error: `${modules} isn't one this command made; move it away, then link again.`,
        };
      }
      rmSync(modules, { recursive: true });
    }
    mkdirSync(modules);
    if (ownTsconfig) writeFileSync(tsconfig, TSCONFIG);
    writeFileSync(
      join(modules, MARKER),
      `made by \`bogey plugins link\`; safe to delete\n${ownTsconfig ? `${TSCONFIG_KEY} ${hash(TSCONFIG)}\n` : ""}`,
    );
  }

  let count = 0;
  const place = (name: string, from: string) => {
    if (ownDeps?.has(name)) return;
    const path = join(modules, name);
    if (isLink(path)) rmSync(path);
    else if (existsSync(path)) return;
    symlink(realpathSync(from), path);
    count++;
  };
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = join(source, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      mkdirSync(join(modules, entry.name), { recursive: true });
      for (const child of readdirSync(from)) place(`${entry.name}/${child}`, join(from, child));
    } else {
      place(entry.name, from);
    }
  }
  mkdirSync(join(modules, "@bogey"), { recursive: true });
  const self = join(modules, "@bogey", "plugins");
  if (isLink(self)) rmSync(self);
  if (!existsSync(self)) {
    symlink(realpathSync(pluginsPackage), self);
    count++;
  }

  return {
    ok: true,
    lines: [
      `packages/plugins/installed -> ${relative(root, holder) || "."}`,
      `${relative(root, modules)}: ${count} links to the plugins package's dependencies`,
      ownDeps
        ? `${relative(root, tsconfig)}: the package's own`
        : ownTsconfig
          ? `${relative(root, tsconfig)}: type-checks the plugins like Bogey does`
          : `${relative(root, tsconfig)}: yours, left alone`,
    ],
  };
}

function packageDependencies(path: string): Set<string> | undefined {
  if (!existsSync(path)) return undefined;
  const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, string>>;
  return new Set(
    ["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
      Object.keys(pkg[field] ?? {}),
    ),
  );
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function recordedTsconfigHash(marker: string): string | undefined {
  if (!existsSync(marker)) return undefined;
  const line = readFileSync(marker, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${TSCONFIG_KEY} `));
  return line?.slice(TSCONFIG_KEY.length + 1);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
