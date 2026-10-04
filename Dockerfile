# Builds the hosted server: the same single binary, with the web UI embedded.
# Used by Render (see render.yaml); anything that runs a container will do.

FROM node:22-alpine AS web
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY client/ ./
RUN npm run build

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# The web bundle replaces the placeholder that is committed so a fresh clone
# compiles; this is the step build.sh does by hand.
COPY --from=web /src/client/dist ./internal/web/dist
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=server" -o /nib .

# Alpine rather than scratch: the server makes TLS connections to the database
# and needs the system's certificate authorities to trust them.
FROM alpine:3.21
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 nib
USER nib
COPY --from=build /nib /usr/local/bin/nib
ENTRYPOINT ["nib", "serve"]
