#!/usr/bin/env bash
set -euo pipefail

readonly scanner_image="aquasec/trivy:0.58.1"
readonly cache_dir="${HOME}/.cache/trivy"
readonly output_dir="artifacts/container-sbom"
readonly images=("sentinelai-api:ci" "sentinelai-web:ci")

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to scan the locally built container images." >&2
  exit 1
}

for image in "${images[@]}"; do
  docker image inspect "$image" >/dev/null
done

mkdir -p "$cache_dir" "$output_dir"

# Generate both SBOMs before applying the vulnerability gate so the artifact
# upload step can still publish inventory when a scan finds a vulnerability.
for image in "${images[@]}"; do
  artifact_name="${image//[:\/]/-}"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$PWD:/work" \
    -v "$cache_dir:/root/.cache/" \
    "$scanner_image" image \
    --format cyclonedx \
    --output "/work/$output_dir/$artifact_name.cdx.json" \
    "$image"
done

for image in "${images[@]}"; do
  echo "Scanning $image for fixable HIGH and CRITICAL vulnerabilities..."
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$cache_dir:/root/.cache/" \
    "$scanner_image" image \
    --scanners vuln \
    --severity HIGH,CRITICAL \
    --ignore-unfixed \
    --exit-code 1 \
    "$image"
done
