# Example: Docker

There is no official published gh-helix image yet (see
[../../docs/roadmap.md](../../docs/roadmap.md)) — this is a minimal, unofficial `Dockerfile` you
can adapt. gh-helix's design (no interactive prompts, distinct exit codes per failure class — see
[../../docs/cli-reference.md#exit-codes](../../docs/cli-reference.md#exit-codes)) makes it
container- and CI-ready as-is.

## Dockerfile

```dockerfile
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates \
    && git lfs install --system \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]
```

Build (after `npm run build` locally, so `dist/` exists):

```bash
docker build -t gh-helix .
```

## Running a backup

Mount `BACKUP_DIRECTORY` as a volume and pass configuration as environment variables (never bake
a token into the image):

```bash
docker run --rm \
  -e GITHUB_ORG=my-org \
  -e BACKUP_DIRECTORY=/backups \
  -e GITHUB_TOKEN \
  -v /host/path/to/backups:/backups \
  gh-helix backup
```

`-e GITHUB_TOKEN` (no `=value`) forwards the value from the host shell's environment — keeps the
token out of the `docker run` command line and shell history on shared hosts.

## docker-compose (scheduled via an external cron)

```yaml
# compose.yaml
services:
  gh-helix:
    build: .
    environment:
      GITHUB_ORG: my-org
      BACKUP_DIRECTORY: /backups
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    volumes:
      - ./backups:/backups
    command: ["backup"]
```

```bash
docker compose run --rm gh-helix
```

## Expected output

Identical to a native run — see [basic-backup](../basic-backup/) — container output is just the
same CLI, unbuffered to stdout.

## Best practices

- Always mount `BACKUP_DIRECTORY` as a persistent volume — a container's writable layer is
  ephemeral and mirrors must survive container restarts/removal.
- Pass secrets via environment variables injected by your orchestrator's secret mechanism, not
  baked into the image or committed to a `compose.yaml`.
- Pin the Node base image to the major version in `package.json`'s `engines.node` (`>=22`) — see
  [../../docs/installation.md#prerequisites](../../docs/installation.md#prerequisites).
- Exit codes propagate normally through `docker run`'s own exit code — wire your orchestrator's
  failure handling to it the same way as in [scheduled-backup](../scheduled-backup/).
