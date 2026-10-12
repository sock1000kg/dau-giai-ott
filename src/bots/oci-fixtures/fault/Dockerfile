FROM alpine:3.21
ARG MODE
COPY src/bots/oci-fixtures/fault/bot.sh /app/bot
RUN chmod 0555 /app/bot
ENV MODE=${MODE}
ENTRYPOINT ["/app/bot"]
