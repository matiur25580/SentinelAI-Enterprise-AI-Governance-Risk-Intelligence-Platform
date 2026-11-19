# Prometheus and Alertmanager Deployment Template

This guide connects the existing protected API metrics endpoint, starter alert
rules, and Grafana dashboard. It is a configuration template, not a deployed
monitoring stack.

## 1. Configure the API

1. Generate a unique random `METRICS_BEARER_TOKEN` with at least 32
   non-whitespace characters.
2. Store it in the API hosting secret manager and restart/redeploy the API.
3. Keep the metrics endpoint on a private network. Do not expose it publicly.
4. Confirm that the API returns metrics only when a valid bearer token is
   supplied. The endpoint intentionally returns 404 when the token is unset.

## 2. Configure Prometheus

1. Copy `ops/prometheus/prometheus.example.yml` into the Prometheus
   configuration directory as `prometheus.yml`.
2. Replace `api.example.internal` with the private HTTPS DNS name/address of
   the API reachable from Prometheus.
3. Provision the same API metrics token into
   `/etc/prometheus/secrets/sentinelai-metrics-token` using the platform's
   secret manager. The file must be readable by the Prometheus process only.
   Store the token value alone, without a `Bearer ` prefix.
4. Mount `ops/prometheus/alerts.yml` at
   `/etc/prometheus/rules/alerts.yml`.
5. Install the issuing CA in the Prometheus trust store if a private CA is
   used. Keep TLS verification enabled; never set
   `insecure_skip_verify: true` for production.
6. Validate the configuration with `promtool check config prometheus.yml`
   and validate the rules with
   `promtool check rules /etc/prometheus/rules/alerts.yml`.
7. Reload/restart Prometheus using the deployment platform's approved
   procedure, then inspect the Targets and Rules pages. Confirm
   `sentinelai-api` is UP and all three starter rules are loaded.

The example uses a single static target. For autoscaled or multi-replica API
deployments, use your platform's service discovery or file-based discovery and
ensure every target has a unique address. The API metrics are process-local;
Prometheus should scrape each replica independently. Avoid placing bearer
tokens in command-line arguments, Git, dashboard JSON, or scrape target URLs.

## 3. Configure Alertmanager delivery

1. Copy `ops/prometheus/alertmanager.example.yml` into the Alertmanager
   configuration directory.
2. Replace the `operator-not-configured` placeholder receiver with an
   approved receiver (email, chat, or paging provider).
3. Provision receiver credentials using the secret mechanism supported by
   your Alertmanager version and hosting platform. Do not commit credentials.
4. Configure ownership, escalation, quiet hours, and notification deduplication
   according to the team's incident policy.
5. Validate with `amtool check-config alertmanager.yml`, reload Alertmanager,
   and send a controlled test alert to verify end-to-end delivery.

The placeholder receiver intentionally sends no notifications. For a generic
HTTPS webhook integration, use
`ops/prometheus/alertmanager.webhook.example.yml` as a starting point. Replace
the example URL with an approved endpoint that accepts Alertmanager webhook
payloads. If the endpoint requires authentication, configure the supported
Alertmanager `http_config` authentication mechanism for the pinned version and
mount credentials from the secret manager; never put tokens in Git or the URL.
The generic webhook template is validated in CI but does not prove the endpoint
exists or accepts deliveries.

Alert rules being visible in Prometheus does not prove that a human is being
notified. Do not claim paging coverage until a real receiver has been
configured and tested by an authorized operator.

## 4. Connect Grafana

Import `ops/grafana/sentinelai-api-overview.json` and select the Prometheus
data source that scrapes the API. Confirm request rate, 5xx percentage, p95
latency, and per-route request rate against live traffic. Keep dashboard access
restricted to authorized operators. Never add the metrics bearer token to
Grafana variables or dashboard JSON.

## 5. CI validation

Pull requests run `bash scripts/validate-monitoring-config.sh`. The script
uses pinned Prometheus and Alertmanager container versions to validate the
scrape configuration, alert rules, and Alertmanager configurations (including the optional webhook receiver template) with
`promtool` and `amtool`. The alert rules are mounted at the absolute path
referenced by the Prometheus example, so CI validates the same file layout
documented for deployment. It creates a temporary dummy token file solely for
syntax validation; no production credential is used. Docker is required to run
this check locally.

## 6. Production verification checklist

- [ ] API token is unique, secret-managed, and rotated under an approved process.
- [ ] Prometheus reaches the API only over a private network and verifies TLS.
- [ ] Prometheus configuration and alert rules pass `promtool` validation.
- [ ] Every production API replica is discovered and scraped.
- [ ] Prometheus shows the expected target as UP and the rules as loaded.
- [ ] Alertmanager receiver is configured with secret-managed credentials.
- [ ] A controlled test alert reaches the intended on-call destination.
- [ ] Grafana panels display plausible values and access is restricted.
- [ ] Token rotation, receiver failure, and Prometheus restart procedures are documented.

No Prometheus or Alertmanager service, credentials, scrape target, notification
receiver, or Grafana instance is provisioned by these checked-in examples.
