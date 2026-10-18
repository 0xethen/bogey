import { repository, upstream } from "@bogey/config";

// bogey.config.ts's repository ("github:owner/repo", checked when it loads), or the upstream it
// defaults to when it's turned off with `false`
export const REPOSITORY_SLUG = (repository ?? upstream).slice("github:".length);
export const REPOSITORY_URL = `https://github.com/${REPOSITORY_SLUG}`;
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

// where `bogey upgrade` merges releases from
export const UPSTREAM_URL = `https://github.com/${upstream.slice("github:".length)}`;
