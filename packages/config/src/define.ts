import type { ThemeKey } from "./themes.gen.ts";

export interface InstanceConfig {
  brand: {
    name: string;
    shortName?: string;
    theme?: ThemeKey;
    icons?: { default: string; dark?: string };
  };
  plugins?: {
    disabled?: Tuple<string>;
  };
  security?: {
    verboseErrors?: boolean;
  };
  upstream?: string;
  repository?: string | false;
  updates?: {
    check?: boolean;
  };
}

export function defineConfig(config: InstanceConfig): InstanceConfig {
  return config;
}
