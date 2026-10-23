FROM eclipse-temurin:21-jdk@sha256:23cc5734ff46e776f51ce66eb9ee08444fd47caabec0a95b7eb6e94be2d3696d
ARG KOTLIN_VERSION=2.1.20
ARG KOTLIN_SHA256=a118197b0de55ffab2bc8d5cd03a5e39033cfb53383d6931bc761dec0784891a
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && curl -fsSL "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" -o /tmp/kotlin.zip \
  && echo "${KOTLIN_SHA256}  /tmp/kotlin.zip" | sha256sum -c - \
  && unzip -q /tmp/kotlin.zip -d /opt \
  && rm /tmp/kotlin.zip \
  && apt-get purge -y curl unzip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/kotlinc/bin:${PATH}" HOME=/tmp
