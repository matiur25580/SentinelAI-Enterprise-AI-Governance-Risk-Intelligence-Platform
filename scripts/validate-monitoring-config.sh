#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to validate the monitoring configuration." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

mkdir -p "$temp_dir/rules" "$temp_dir/secrets"
printf 'ci-only-placeholder-token-not-a-secret\n' > "$temp_dir/secrets/sentinelai-metrics-token"
cp "$repo_root/ops/prometheus/alerts.yml" "$temp_dir/rules/alerts.yml"

echo "Validating Prometheus scrape configuration and alert rules..."
docker run --rm --pull=missing \
  --entrypoint promtool \
  -v "$repo_root:/workspace:ro" \
  -v "$temp_dir/rules:/etc/prometheus/rules:ro" \
  -v "$temp_dir/secrets:/etc/prometheus/secrets:ro" \
  prom/prometheus:v3.5.0 \
  check config /workspace/ops/prometheus/prometheus.example.yml

docker run --rm --pull=missing \
  --entrypoint promtool \
  -v "$temp_dir/rules:/etc/prometheus/rules:ro" \
  prom/prometheus:v3.5.0 \
  check rules /etc/prometheus/rules/alerts.yml

echo "Validating Alertmanager configuration..."
docker run --rm --pull=missing \
  --entrypoint amtool \
  -v "$repo_root/ops/prometheus/alertmanager.example.yml:/etc/alertmanager/alertmanager.yml:ro" \
  prom/alertmanager:v0.28.1 \
  check-config /etc/alertmanager/alertmanager.yml

echo "Monitoring configuration validation passed."
