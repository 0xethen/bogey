#!/usr/bin/env node
// `themes` runs before anything loads bogey.config.ts, since the config is checked against the
// theme list it writes (a new theme set as brand.theme would otherwise fail before it's listed)
if (process.argv[2] === "themes") {
  const { runThemes } = await import("./commands/themes.ts");
  const result = runThemes(process.cwd(), process.argv.slice(3));
  if (result.exitCode === 0) console.log(result.output);
  else console.error(result.output);
  process.exitCode = result.exitCode;
} else {
  await import("./main.ts");
}
