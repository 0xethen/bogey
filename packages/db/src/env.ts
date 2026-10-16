import { createIsomorphicFn } from "@tanstack/react-start";

export interface PublicEnv {
  supabaseUrl: string;
  supabaseKey: string;
  // the host passkeys belong to (GoTrue's WebAuthn RP ID); unset hides passkeys
  passkeyHost?: string;
}

declare global {
  interface Window {
    __BOGEY_ENV__?: PublicEnv;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in .env at the repo root or the container's environment (see docs/self-hosting/supabase.md).`,
    );
  }
  return value;
}

export const getPublicEnv = createIsomorphicFn()
  .server((): PublicEnv => ({
    supabaseUrl: required("SUPABASE_URL"),
    supabaseKey: required("SUPABASE_PUBLISHABLE_KEY"),
    ...(process.env.BOGEY_PASSKEY_HOST ? { passkeyHost: process.env.BOGEY_PASSKEY_HOST } : {}),
  }))
  .client((): PublicEnv => {
    const env = window.__BOGEY_ENV__;
    if (!env) throw new Error("The page is missing its Supabase settings.");
    return env;
  });

export function publicEnvScript(env: PublicEnv): string {
  const json = JSON.stringify(env).replace(/</g, "\\u003c");
  return `window.__BOGEY_ENV__=${json};`;
}

export function serviceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}
