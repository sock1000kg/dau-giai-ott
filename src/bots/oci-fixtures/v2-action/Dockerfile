FROM node:22-alpine
ARG STRATEGY=first
ENV BOT_STRATEGY=$STRATEGY
COPY src/bots/oci-fixtures/v2-action/bot.mjs /app/bot.mjs
RUN printf '%s\n' "$STRATEGY" > /app/variant
ENTRYPOINT ["node", "/app/bot.mjs"]
