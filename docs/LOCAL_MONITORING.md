# Local Monitoring Stack

This optional Docker Compose overlay starts a local Prometheus, Alertmanager,
and Grafana stack for development. It is not a production deployment and does
not change the default PostgreSQL/Redis Compose services.

## Prerequisites

- Docker Engine/Desktop with Compose v2.
- The SentinelAI API running on the host at `http://localhost:4000`.
- A local `.env` file created from `.env.example`.

## 1. Configure the local metrics secret

Generate one random token and use the exact same value in both locations:

```bash
mkdir -p ops/local-monitoring/secrets
TOKEN="$(openssl rand -hex 32)"
printf '%s\n' "$TOKEN" > ops/local-monitoring/secrets/metrics-token
chmod 600 ops/local-monitoring/secrets/metrics-token
```

Add this line to your ignored root `.env` file:

```dotenv
METRICS_BEARER_TOKEN=<paste-the-generated-token>
GRAFANA_ADMIN_PASSWORD=<choose-a-unique-local-password>
```

Do not commit either secret. The token file directory is ignored by Git.
Restart the API after changing `METRICS_BEARER_TOKEN`.

## 2. Start the API and infrastructure

In one terminal, start the database and API as described in the root README.
Ensure the API is listening on port 4000 and has loaded `METRICS_BEARER_TOKEN`.

## 3. Start the monitoring overlay

From the repository root:

```bash
docker compose -f docker-compose.yml -f ops/local-monitoring/compose.monitoring.yml up -d
```

The monitoring services bind only to loopback:

| Service | Local URL | Purpose |
|---|---|---|
| Prometheus | http://localhost:9090 | Scrape targets, rules, and alerts |
| Alertmanager | http://localhost:9093 | Local alert state; no delivery configured |
| Grafana | http://localhost:3001 | Pre-provisioned API dashboard |

Sign in to Grafana with the `GRAFANA_ADMIN_USER` (default `admin`) and
`GRAFANA_ADMIN_PASSWORD` from `.env`. The Prometheus data source and
SentinelAI API Overview dashboard are provisioned automatically.

Prometheus reaches the host API through `host.docker.internal:4000`; the
Compose overlay maps that hostname to the host gateway on Linux. If your
environment uses a different host gateway or API port, update
`ops/local-monitoring/prometheus.yml` accordingly.

## 4. Verify the local stack

1. Open Prometheus **Status → Targets** and confirm `sentinelai-api` is UP.
2. Open **Alerts** and confirm the three starter rules are loaded.
3. Open Grafana → Dashboards → SentinelAI → SentinelAI API Overview.
4. Generate a few API requests and confirm request-rate and latency panels
   populate after Prometheus has scraped the API.
5. If the target is DOWN, verify the API process, port, token equality, and
   `METRICS_BEARER_TOKEN` environment loaded by the API.

The local Alertmanager receiver is intentionally a no-op. Seeing an alert in
Prometheus or Alertmanager does not mean a person is notified. Do not use this
local stack as an on-call or production paging system.

## 5. Stop the monitoring stack

```bash
docker compose -f docker-compose.yml -f ops/local-monitoring/compose.monitoring.yml down
```

To also remove local monitoring history and dashboards, add `-v`. This deletes
the Prometheus, Alertmanager, and Grafana named volumes. It does not remove the
PostgreSQL or Redis volumes declared by the base Compose file.

## Security boundaries

- Prometheus, Alertmanager, and Grafana ports are bound to `127.0.0.1`.
- Grafana anonymous access and self-signup are disabled; a password is required.
- The metrics bearer token is mounted read-only from an ignored local file.
- The local Alertmanager receiver sends no email, chat, or paging notifications.
- Use separate secret management, private networking, TLS, backups, access
  controls, and tested receivers for any production observability deployment.
