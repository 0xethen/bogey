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
  const tsconfig = join(target, "tsconfig.json");
  const written = recordedTsconfigHash(join(modules, MARKER));
  const ownTsconfig =
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

  let count = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = join(source, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      mkdirSync(join(modules, entry.name));
      for (const child of readdirSync(from)) {
        symlink(realpathSync(join(from, child)), join(modules, entry.name, child));
        count++;
      }
    } else {
      symlink(realpathSync(from), join(modules, entry.name));
      count++;
    }
  }
  mkdirSync(join(modules, "@bogey"), { recursive: true });
  const self = join(modules, "@bogey", "plugins");
  if (!isLink(self)) symlink(realpathSync(pluginsPackage), self);

  return {
    ok: true,
    lines: [
      `packages/plugins/installed -> ${relative(root, holder) || "."}`,
      `${relative(root, modules)}: ${count + 1} links to the plugins package's dependencies`,
      ownTsconfig
        ? `${relative(root, tsconfig)}: type-checks the plugins like Bogey does`
        : `${relative(root, tsconfig)}: yours, left alone`,
    ],
  };
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
