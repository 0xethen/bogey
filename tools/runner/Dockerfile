# The runner image: the runner (node src/main.ts) and the Docker socket proxy (node src/proxy.ts).
# Base images are pinned by digest; see docs/self-hosting/runner-security.md for updating them.
FROM docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS docker

FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
ENV BOGEY_RUNNER_WORK_DIR=/var/lib/bogey-runner
USER node
CMD ["node", "src/main.ts"]
