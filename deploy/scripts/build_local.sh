#!/bin/bash
set -e

VERSION=${1:-"dev"}

echo "Building blah2 stack locally"
echo "Version: ${VERSION}"
echo "Platform: linux/arm64"

# Build blah2
echo ""
echo "Building blah2..."
docker buildx build \
  --platform linux/arm64 \
  --load \
  -t blah2:${VERSION} \
  .

# Build blah2-api 
echo ""
echo "Building blah2-api..."
docker buildx build \
  --platform linux/arm64 \
  --load \
  -t blah2-api:${VERSION} \
  ./api

# Build blah2-web 
echo ""
echo "Building blah2-web..."
docker buildx build \
  --platform linux/arm64 \
  --load \
  -t blah2-web:${VERSION} \
  ./web

# Build blah2-host 
echo ""
echo "Building blah2-host..."
docker buildx build \
  --platform linux/arm64 \
  --load \
  -t blah2-host:${VERSION} \
  ./host

echo ""
echo "=========================================="
echo "All images built successfully"
echo "=========================================="
echo ""
echo "Images built:"
docker images | grep -E "(blah2|${VERSION})" | head -10
echo ""
# echo "Test with: ./scripts/test-images.sh ${VERSION}"
# echo ""