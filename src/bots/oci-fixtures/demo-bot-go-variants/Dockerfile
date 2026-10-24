FROM golang:1.24-alpine AS build
WORKDIR /src
COPY src/bots/oci-fixtures/demo-bot-go-variants/bot.go ./bot.go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /bot ./bot.go
FROM scratch
ARG STRATEGY=first
ENV BOT_STRATEGY=$STRATEGY
COPY --from=build /bot /bot
ENTRYPOINT ["/bot"]
