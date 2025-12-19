#!/bin/bash
echo "Restarting SDRplay services..."

# Stop any existing instances of blah2
killall -9 blah2 >/dev/null 2>&1 || true

# NOTE: Do NOT restart sdrplay_apiService from inside the container.
# The SDRplay API service is managed by the HOST via:
#   - systemd (sdrplay.service)
#   - crontab running script/blah2_rspduo_restart.bash
#
# If the RSPDuo stops working, the host's crontab script will detect
# stale data and restart everything properly.

sleep 1
echo "SDRplay environment reset complete"
