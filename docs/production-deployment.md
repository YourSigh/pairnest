# PairNest production deployment

[简体中文](production-deployment.zh-CN.md)

This guide deploys PairNest on a fresh Linux cloud server with HTTPS and WSS.
The server needs Docker Engine, Docker Compose, Nginx, and a certificate tool;
it does not need Node.js, Java, the Android SDK, or Prisma.

## Deployment modes

- Source deployment: clone the repository and use the root `compose.yaml`.
- Registry deployment: build the API image locally or in CI, push it to a
  registry, and run `deploy/compose.registry.yaml` on the server.
- Existing database: run `deploy/compose.external-db.yaml` when MySQL is
  already available on an external Docker network.

Give PairNest its own image repository and immutable version or commit tags:

```bash
PAIRNEST_API_IMAGE=registry.example.com/namespace/pairnest-api:0.1.0 \
  make publish-api
```

The image does not contain `.env`, database credentials, JWT secrets, or AI
keys.

## Fresh server checklist

1. Point an API hostname such as `pairnest.example.com` to the server.
2. Allow inbound TCP 22, 80, and 443. Do not publicly expose 3306 or 4000.
3. Install Docker Engine and its Compose plugin from Docker's official
   documentation. Install host Nginx and use Certbot's Nginx integration for
   the certificate. Node.js is not required on the server.
4. Copy `deploy/compose.registry.yaml` to `/opt/pairnest/compose.yaml` and copy
   `deploy/.env.registry.example` to `/opt/pairnest/.env`.
5. Generate independent hexadecimal values for the database user password,
   MySQL root password, and token secret with `openssl rand -hex`.
6. Log in to a private registry, validate Compose, and start the stack:

```bash
cd /opt/pairnest
docker login registry.example.com
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

The one-shot `migrate` service should finish with exit code zero. Database and
uploads remain in the `pairnest_db-data` and `pairnest_uploads` named volumes.

Copy `deploy/nginx/pairnest.conf.example` into the Nginx site directory,
replace the example hostname, test and reload Nginx, and then obtain a
certificate using Certbot's official Nginx instructions. Verify `/health`,
`/v1/ping`, media upload, and `/ws` through HTTPS before building the app.

Set the build-machine-only public default URL:

```dotenv
EXPO_PUBLIC_PAIRNEST_DEFAULT_API_URL=https://pairnest.example.com
```

For an EAS cloud build, also configure the same public value in the EAS
`production` environment as described in [App builds](app-build.md); do not
assume that the cloud builder can read a local `.env`. Every `EXPO_PUBLIC_*`
value is embedded in the app and must never contain a secret.

## Existing MySQL

Create a separate `pairnest` database and least-privilege user. Put both the
database container and PairNest on the same Docker network. Copy
`deploy/.env.external-db.example` to `.env` and use a container DNS name and
internal port, for example:

```dotenv
PAIRNEST_DOCKER_NETWORK=existing-network
PAIRNEST_DATABASE_URL=mysql://pairnest:password@mysql-container:3306/pairnest
```

Start only migration and API:

```bash
docker compose -f compose.external-db.yaml config --quiet
docker compose -f compose.external-db.yaml pull
docker compose -f compose.external-db.yaml up -d
```

This Compose file never creates, restarts, or stops the existing database.

Official references: [Docker Engine for Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Docker Compose plugin](https://docs.docker.com/compose/install/linux/), and
[Certbot instructions](https://certbot.eff.org/instructions).
