#!/usr/bin/env bash
set -euo pipefail

git reset --hard
git fetch
git pull
npm install --include=optional
pm2 restart cung-tuyen-api
