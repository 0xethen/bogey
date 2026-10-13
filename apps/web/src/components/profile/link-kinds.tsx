import type { ComponentType } from "react";
import {
  IconBrandGithub,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandX,
  IconBrandYoutube,
  IconCode,
  IconWorld,
  type IconProps,
} from "@tabler/icons-react";
import type { SelectOption } from "@bogey/ui/components/opt-select";
import { PROFILE_LINK_KINDS, type ProfileLinkKind } from "@bogey/utils/profile-links";
import type { T } from "#/lib/translate.tsx";

const BRANDS: Record<Exclude<ProfileLinkKind, "website">, string> = {
  github: "GitHub",
  devpost: "Devpost",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
};

const ICONS: Record<ProfileLinkKind, ComponentType<IconProps>> = {
  website: IconWorld,
  github: IconBrandGithub,
  devpost: IconCode,
  linkedin: IconBrandLinkedin,
  instagram: IconBrandInstagram,
  youtube: IconBrandYoutube,
  x: IconBrandX,
};

export function profileLinkLabel(kind: ProfileLinkKind, t: T): string {
  return kind === "website" ? t("profile.linkWebsite") : BRANDS[kind];
}

export function profileLinkOptions(t: T): Array<SelectOption<ProfileLinkKind>> {
  return PROFILE_LINK_KINDS.map((kind) => ({ value: kind, label: profileLinkLabel(kind, t) }));
}

export function ProfileLinkIcon({ kind, ...props }: IconProps & { kind: ProfileLinkKind }) {
  const Icon = ICONS[kind];
  return <Icon aria-hidden {...props} />;
}
