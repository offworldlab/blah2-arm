#!/bin/bash
# Restart SDRplay services before starting blah2
# Requires container to run with pid:host to manage host processes

echo "Restarting SDRplay services..."

# Stop any existing instances of the application
pkill -9 -x blah2 2>/dev/null || true

# Restart the SDRplay API service
pkill -9 -x sdrplay_apiService 2>/dev/null || true

sleep 2

echo "SDRplay environment reset complete"
