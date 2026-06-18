#!/bin/bash

# Run script with a crontab to automatically restart on error.
# Checks the API to see if data is still being pushed through.

COMPOSE_FILE=/data/mender-docker-compose/current/manifests/docker-compose.yaml
PROJECT=retina-node
MODE_FILE=/data/retina-gui/mode.txt
GRACE_PERIOD_SECONDS=60

# Don't interfere when spectrum mode is active - blah2 is intentionally stopped
if [ -f "$MODE_FILE" ] && [ "$(cat $MODE_FILE)" = "spectrum" ]; then
  exit 0
fi

# Don't race a restart already in flight - a GUI config Apply (or another
# instance of this script) may already be running `docker compose down`/`up`
# against the same project; piling another one on top can corrupt both.
if pgrep -f "docker compose -p $PROJECT" > /dev/null; then
  exit 0
fi

# Give blah2 a grace period after a (re)start before judging it stale - it
# needs time to re-acquire the RSPduo and start producing fresh map data,
# whether the restart just came from this script or a GUI config Apply.
CONTAINER_STARTED=$(docker inspect -f '{{.State.StartedAt}}' blah2 2>/dev/null)
if [ -n "$CONTAINER_STARTED" ]; then
  STARTED_EPOCH=$(date -d "$CONTAINER_STARTED" +%s 2>/dev/null)
  NOW_EPOCH=$(date +%s)
  if [ -n "$STARTED_EPOCH" ] && [ $((NOW_EPOCH - STARTED_EPOCH)) -lt $GRACE_PERIOD_SECONDS ]; then
    exit 0
  fi
fi

FIRST_CHAR=$(curl -s 127.0.0.1:3000/api/map | head -c1)
TIMESTAMP=$(curl -s 127.0.0.1:3000/api/map | head -c23 | tail -c10)
CURR_TIMESTAMP=$(date +%s)
DIFF_TIMESTAMP=$(($CURR_TIMESTAMP-$TIMESTAMP))

if [[ "$FIRST_CHAR" != "{" ]] || [[ $DIFF_TIMESTAMP -gt 60 ]]; then
  docker compose -p $PROJECT -f $COMPOSE_FILE down
  kill -9 $(pgrep -f "sdrplay_apiService") 2>/dev/null || true
  systemctl restart sdrplay.service
  docker compose -p $PROJECT -f $COMPOSE_FILE up -d
  echo "Successfully restarted blah2"
fi
