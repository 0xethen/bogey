import { useCallback, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadedPluginSlots, readPluginSettings, type LoadedSlots } from "@bogey/plugins";
import { PluginBoundary } from "#/components/plugins/plugin-boundary.tsx";
import { ownPluginSettingsQueryOptions } from "#/lib/plugins.ts";

export interface AuthCaptcha {
  widget: ReactNode;
  token: () => string | undefined;
  reset: () => void;
}

// The first plugin with an `authCaptcha` slot supplies the token; Supabase Auth decides whether it's needed.
export function useAuthCaptcha(): AuthCaptcha {
  const provider = loadedPluginSlots().find((loaded) => loaded.slots.authCaptcha);
  const token = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onToken = useCallback((value: string | null) => {
    token.current = value;
  }, []);
  const reset = useCallback(() => {
    token.current = null;
    setAttempt((count) => count + 1);
  }, []);

  return {
    widget: provider ? (
      <PluginBoundary name={provider.manifest.name}>
        <Widget key={attempt} provider={provider} onToken={onToken} />
      </PluginBoundary>
    ) : null,
    token: () => token.current ?? undefined,
    reset,
  };
}

function Widget({
  provider,
  onToken,
}: {
  provider: LoadedSlots;
  onToken: (token: string | null) => void;
}) {
  const Captcha = provider.slots.authCaptcha;
  const stored = useQuery(ownPluginSettingsQueryOptions({ scope: "instance" }, provider.key));
  if (!Captcha || !stored.isSuccess) return null;
  return (
    <Captcha settings={readPluginSettings(provider.manifest, stored.data)} onToken={onToken} />
  );
}
