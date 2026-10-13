FROM eclipse-temurin:21-jdk
ARG KOTLIN_VERSION=2.1.20
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && curl -fsSL "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" -o /tmp/kotlin.zip \
  && unzip -q /tmp/kotlin.zip -d /opt \
  && rm /tmp/kotlin.zip \
  && apt-get purge -y curl unzip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/kotlinc/bin:${PATH}" HOME=/tmp
