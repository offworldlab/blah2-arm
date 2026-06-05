#!/bin/bash

# Run script with a crontab to automatically restart on error.
# Checks the API to see if data is still being pushed through.

COMPOSE_FILE=/data/mender-docker-compose/current/manifests/docker-compose.yaml
PROJECT=retina-node
MODE_FILE=/data/retina-gui/mode.txt

# Don't interfere when spectrum mode is active - blah2 is intentionally stopped
if [ -f "$MODE_FILE" ] && [ "$(cat $MODE_FILE)" = "spectrum" ]; then
  exit 0
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
