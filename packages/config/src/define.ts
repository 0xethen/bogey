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
  events?: {
    uiDeletion?: boolean;
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
    /** Lets people sign out one of their other devices, or all of them, from Account. Off by default:
     * someone who got into an account could otherwise sign its owner out. */
    deviceSignOut?: boolean;
    /** How many passkeys one person can add (default 5, at most 9); 0 turns passkeys off. */
    maxPasskeys?: number;
    headers?: {
      frameAncestors?: Tuple<string>;
      hsts?: boolean;
      contentSecurityPolicy?: string | false;
    };
  };
  email?: {
    /** Sign-in, sign-up, invitation, email-change and reauthentication emails, by kind (`signIn`, or
     * `signIn@fr`). Only set here: in the app they could be rewritten to send sign-in codes elsewhere. */
    authTemplates?: Record<string, { subject: string; body: string }>;
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
