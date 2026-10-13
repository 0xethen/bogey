export const SIGN_IN_PROVIDERS = [
  { key: "google", label: "Google", oauth: "google" },
  { key: "github", label: "GitHub", oauth: "github" },
  { key: "azure", label: "Microsoft", oauth: "azure" },
  { key: "gitlab", label: "GitLab", oauth: "gitlab" },
  { key: "discord", label: "Discord", oauth: "discord" },
  { key: "keycloak", label: "Keycloak", oauth: "keycloak" },
  { key: "sso", label: "Single sign-on", oauth: null },
] as const;

export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number]["key"];

export type OAuthProvider = Extract<(typeof SIGN_IN_PROVIDERS)[number], { oauth: string }>["oauth"];

export const SIGN_IN_PROVIDER_KEYS = SIGN_IN_PROVIDERS.map((provider) => provider.key) as [
  SignInProvider,
  ...SignInProvider[],
];

export function isSignInProvider(value: unknown): value is SignInProvider {
  return SIGN_IN_PROVIDERS.some((provider) => provider.key === value);
}

export function providerLabel(key: SignInProvider): string {
  return SIGN_IN_PROVIDERS.find((provider) => provider.key === key)?.label ?? key;
}

export function effectiveProviders(
  instance: Tuple<SignInProvider> | undefined,
  org: Tuple<SignInProvider> | undefined,
): Tuple<SignInProvider> {
  const allowed = instance ?? [];
  return org ? allowed.filter((key) => org.includes(key)) : allowed;
}
