#!/bin/bash

# Script to open SSH tunnel using localhost.run
# This exposes the local SSH server (port 2222) on a public URL

echo "Opening SSH tunnel with localhost.run..."
echo "This will expose port 2222 (SSH server) on a public URL"
echo "Press Ctrl+C to stop the tunnel"

ssh -R 80:localhost:2222 localhost.run