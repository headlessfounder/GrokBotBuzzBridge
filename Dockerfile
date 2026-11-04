# GrokBotBuzzBridge container image.
#
# Stage 1 builds Block's `buzz` command-line tool and `buzz-acp` agent runner
# from source at an exact commit. Keep BUZZ_COMMIT equal to the commit of the
# relay your community runs (relay-v0.2.1 = 6e5c462a…). The relay image does
# not ship these two tools, so they are built here.
#
# Stage 2 is the bridge itself: Node 24 running TypeScript directly.

ARG RUST_VERSION=1.95
ARG NODE_IMAGE=node:24-bookworm-slim

FROM rust:${RUST_VERSION}-bookworm AS buzz-tools
ARG BUZZ_REPO=https://github.com/block/buzz
ARG BUZZ_COMMIT=6e5c462ac524de60d7edb46c66130fd779cc9006
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q . && git remote add origin "${BUZZ_REPO}" \
    && git fetch -q --depth 1 origin "${BUZZ_COMMIT}" \
    && git checkout -q FETCH_HEAD
ENV CARGO_PROFILE_RELEASE_DEBUG=false
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p buzz-cli --bin buzz -p buzz-acp --bin buzz-acp \
    && mkdir -p /out \
    && cp target/release/buzz target/release/buzz-acp /out/ \
    && strip /out/buzz /out/buzz-acp

FROM ${NODE_IMAGE} AS runtime
ARG BUZZ_COMMIT=6e5c462ac524de60d7edb46c66130fd779cc9006
LABEL org.opencontainers.image.title="GrokBotBuzzBridge" \
      org.opencontainers.image.description="Puts a Grok Bot into a Buzz community" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.buzz.tools.commit="${BUZZ_COMMIT}"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=buzz-tools /out/buzz /out/buzz-acp /usr/local/bin/
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY grokbot ./grokbot
RUN printf '#!/bin/sh\nexec node --no-warnings=ExperimentalWarning /app/src/main.ts "$@"\n' > /usr/local/bin/gbb \
    && chmod 0755 /usr/local/bin/gbb \
    && useradd --system --uid 10001 --home /data --shell /usr/sbin/nologin bridge \
    && mkdir -p /data && chown bridge:bridge /data
ENV BRIDGE_DATA_DIR=/data NODE_ENV=production
USER bridge
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.BRIDGE_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "gbb"]
CMD ["start"]
