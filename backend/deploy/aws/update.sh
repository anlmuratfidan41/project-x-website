#!/usr/bin/env bash
# Deploy the latest code: pull, install, test, build, restart. Run as user projectx in /opt/projectx/app.
set -euo pipefail
cd /opt/projectx/app

git pull --ff-only
npm ci
npm test
npm run build
sudo systemctl restart projectx
sleep 3
curl -fsS http://127.0.0.1:4000/api/health && echo " — deployed and healthy"
