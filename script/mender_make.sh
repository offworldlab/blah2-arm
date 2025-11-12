#!/usr/bin/env bash
# Generate a compose-only Mender artifact for the blah2 stack (manual tag version)
set -euo pipefail

DEVICE_TYPE=${DEVICE_TYPE:-pi5-v3-arm64}
PLATFORM=${PLATFORM:-linux/arm64/v8}
ARTIFACT_NAME=${ARTIFACT_NAME:-blah2-stack}
SOFTWARE_VERSION=${SOFTWARE_VERSION:-v1}
COMPOSE_SRC=${COMPOSE_SRC:-deploy/docker-compose.prod.yml}
OUT_DIR=${OUT_DIR:-artifacts}

RENDER_DIR="manifests/${SOFTWARE_VERSION}"
COMPOSE_OUT="${RENDER_DIR}/docker-compose.yaml"
ARTIFACT_OUT="${OUT_DIR}/${ARTIFACT_NAME}-${SOFTWARE_VERSION}.mender"

mkdir -p "${RENDER_DIR}" "${OUT_DIR}"
cp "${COMPOSE_SRC}" "${COMPOSE_OUT}"

app-gen \
  --artifact-name "${ARTIFACT_NAME}" \
  --device-type "${DEVICE_TYPE}" \
  --platform "${PLATFORM}" \
  --application-name "${ARTIFACT_NAME}" \
  --orchestrator docker-compose \
  --manifests-dir "${RENDER_DIR}" \
  --output-path "${ARTIFACT_OUT}" \
  -- \
  --software-name "${ARTIFACT_NAME}" \
  --software-version "${SOFTWARE_VERSION}"

echo "Created ${ARTIFACT_OUT}"
