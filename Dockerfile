# syntax=docker/dockerfile:1

FROM ghcr.io/voidzero-dev/vite-plus:1.0.0-rc.1 AS build
WORKDIR /app
COPY --chown=vp:vp . .
RUN vp install --frozen-lockfile
RUN if [ -L packages/plugins/installed ]; then rm packages/plugins/installed && mkdir packages/plugins/installed; fi
RUN node tools/cli/src/bin.ts plugins install
RUN cd apps/web && vp build
RUN cd tools/cli && vp pack

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.output ./
COPY --from=build --chown=node:node /app/bogey.config.ts ./bogey.config.ts
RUN mkdir -p node_modules/@bogey/config \
  && printf '{"name":"@bogey/config","type":"module","exports":{"./define":"./define.js"}}' > node_modules/@bogey/config/package.json \
  && printf 'export const defineConfig = (config) => config;\n' > node_modules/@bogey/config/define.js

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/tools/cli/dist /opt/bogey/cli
COPY --from=build --chown=node:node /app/supabase/migrations ./supabase/migrations
COPY --from=build --chown=node:node /app/supabase/schemas ./supabase/schemas
COPY --from=build --chown=node:node /app/packages/plugins/bundled ./packages/plugins/bundled
COPY --from=build --chown=node:node /app/packages/plugins/installed ./packages/plugins/installed
COPY --from=build --chown=node:node /app/bogey.plugins.loc[k] ./
COPY --from=build --chown=node:node /app/deploy/all-in-one/.env.example ./deploy/all-in-one/.env.example
RUN printf '#!/bin/sh\nexec node /opt/bogey/cli/bin.mjs "$@"\n' > /usr/local/bin/bogey \
  && chmod +x /usr/local/bin/bogey
ENV BOGEY_HOME=/app BOGEY_CONFIG=/app/bogey.config.ts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/index.mjs"]
