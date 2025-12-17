#!/usr/bin/env bash
# Generate Mender artifact with bundled Docker images for blah2 stack
set -euo pipefail

# Usage info
usage() {
  cat <<EOF
Usage: $0 <version> [previous_version]

Generate a Mender artifact for the blah2 stack with bundled Docker images.

Arguments:
  version           Stack version (e.g., v1.2.3, dev) - REQUIRED
  previous_version  Previous version for delta updates - OPTIONAL

Environment variables:
  DEVICE_TYPE       Target device type (default: pi5-v3-arm64)
  PLATFORM          Target platform (default: linux/arm64/v8)
  ARTIFACT_NAME     Artifact name (default: blah2-stack)
  TEMPLATE_FILE     Path to docker-compose template (default: deploy/docker-compose.template.yml)

Examples:
  $0 v1.0.0
  $0 v1.0.1 v1.0.0  # with delta
EOF
  exit 1
}

# Parse arguments
VERSION=${1:-""}
PREV_VERSION=${2:-""}

if [ -z "$VERSION" ]; then
  usage
fi

# Configuration
DEVICE_TYPE=${DEVICE_TYPE:-pi5-v3-arm64}
PLATFORM=${PLATFORM:-linux/arm64/v8}
ARTIFACT_NAME=${ARTIFACT_NAME:-blah2-stack}
TEMPLATE_FILE=${TEMPLATE_FILE:-deploy/docker-compose.template.yml}

MANIFEST_DIR="manifests/${VERSION}"
ARTIFACT_OUT="artifacts/${ARTIFACT_NAME}-${VERSION}.mender"
METADATA_OUT="artifacts/${ARTIFACT_NAME}-${VERSION}.json"

# Check prerequisites
command -v app-gen &>/dev/null || { echo "Error: app-gen not found"; exit 1; }
command -v mender-artifact &>/dev/null || { echo "Error: mender-artifact not found"; exit 1; }
command -v docker &>/dev/null || { echo "Error: docker not found"; exit 1; }
[ -f "$TEMPLATE_FILE" ] || { echo "Error: Template not found: $TEMPLATE_FILE"; exit 1; }

echo "Building blah2-stack ${VERSION}"
[ -n "$PREV_VERSION" ] && echo "  Delta from ${PREV_VERSION}"

# Create output directories
mkdir -p "${MANIFEST_DIR}" artifacts

# Generate versioned compose manifest
sed "s/__VERSION__/${VERSION}/g" "${TEMPLATE_FILE}" > "${MANIFEST_DIR}/docker-compose.yaml"

# Validate compose
docker compose -f "${MANIFEST_DIR}/docker-compose.yaml" config >/dev/null 2>&1 || {
  echo "Error: Invalid docker-compose.yaml"
  exit 1
}

# Build app-gen arguments
APP_GEN_ARGS=(
  --artifact-name "${ARTIFACT_NAME}-${VERSION}"
  --device-type "${DEVICE_TYPE}"
  --platform "${PLATFORM}"
  --application-name "${ARTIFACT_NAME}"
  --orchestrator docker-compose
  --manifests-dir "${MANIFEST_DIR}"
  --output-path "${ARTIFACT_OUT}"
)

SOFTWARE_ARGS=(
  --software-name "${ARTIFACT_NAME}"
  --software-version "${VERSION}"
)

# Configure images for delta or full artifact
if [ -n "$PREV_VERSION" ]; then
  APP_GEN_ARGS+=(
    --deep-delta
    --image "ghcr.io/offworldlabs/blah2:${PREV_VERSION},ghcr.io/offworldlabs/blah2:${VERSION}"
    --image "ghcr.io/offworldlabs/blah2-web:${PREV_VERSION},ghcr.io/offworldlabs/blah2-web:${VERSION}"
    --image "ghcr.io/offworldlabs/blah2-api:${PREV_VERSION},ghcr.io/offworldlabs/blah2-api:${VERSION}"
    --image "ghcr.io/offworldlabs/blah2-host:${PREV_VERSION},ghcr.io/offworldlabs/blah2-host:${VERSION}"
  )
else
  APP_GEN_ARGS+=(
    --image "ghcr.io/offworldlabs/blah2:${VERSION}"
    --image "ghcr.io/offworldlabs/blah2-web:${VERSION}"
    --image "ghcr.io/offworldlabs/blah2-api:${VERSION}"
    --image "ghcr.io/offworldlabs/blah2-host:${VERSION}"
  )
fi

# Run app-gen
app-gen "${APP_GEN_ARGS[@]}" -- "${SOFTWARE_ARGS[@]}"

# Validate artifact
mender-artifact validate "${ARTIFACT_OUT}" || {
  echo "Error: Artifact validation failed"
  exit 1
}

# Check size
SIZE=$(stat -c%s "${ARTIFACT_OUT}" 2>/dev/null || stat -f%z "${ARTIFACT_OUT}")
SIZE_MB=$((SIZE / 1024 / 1024))

[ "$SIZE" -gt 2147483648 ] && echo "Warning: Large artifact (${SIZE_MB}MB)"

# Create metadata
cat > "${METADATA_OUT}" <<EOF
{
  "stack_version": "${VERSION}",
  "artifact_name": "${ARTIFACT_NAME}-${VERSION}",
  "previous_version": "${PREV_VERSION:-null}",
  "device_type": "${DEVICE_TYPE}",
  "platform": "${PLATFORM}",
  "artifact_size_bytes": ${SIZE},
  "artifact_size_mb": ${SIZE_MB},
  "delta_enabled": $([ -n "$PREV_VERSION" ] && echo "true" || echo "false"),
  "images": {
    "blah2": "ghcr.io/offworldlabs/blah2:${VERSION}",
    "blah2-web": "ghcr.io/offworldlabs/blah2-web:${VERSION}",
    "blah2-api": "ghcr.io/offworldlabs/blah2-api:${VERSION}",
    "blah2-host": "ghcr.io/offworldlabs/blah2-host:${VERSION}"
  },
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_sha": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "git_branch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
}
EOF

echo "Done: ${ARTIFACT_OUT} (${SIZE_MB}MB)"
