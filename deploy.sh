#!/usr/bin/env bash
set -euo pipefail

git reset --hard
git fetch
git pull
npm install
pm2 restart cung-tuyen-api
