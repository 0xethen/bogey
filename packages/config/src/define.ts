import type { ThemeKey } from "./themes.gen.ts";
import type { SettingsValue } from "./settings.ts";

export interface InstanceConfig {
  brand: {
    name: string;
    shortName?: string;
    theme?: ThemeKey;
    icons?: { default: string; dark?: string };
  };
  appUrl?: string;
  plugins?: {
    disabled?: Tuple<string>;
  };
  network?: {
    trustProxy?: boolean;
    clientIpHeader?: NonNullable<SettingsValue<"network">["clientIpHeader"]>;
    trustedHops?: number;
    trustedProxies?: Tuple<string>;
  };
  security?: {
    verboseErrors?: boolean;
    requireAdminMfa?: boolean;
    headers?: {
      frameAncestors?: Tuple<string>;
      hsts?: boolean;
      contentSecurityPolicy?: string | false;
    };
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
