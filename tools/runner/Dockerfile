FROM docker:27-cli AS docker

FROM node:24-slim
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
ENV BOGEY_RUNNER_WORK_DIR=/var/lib/bogey-runner
USER node
CMD ["node", "src/main.ts"]
