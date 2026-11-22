#!/usr/bin/env bash
set -euo pipefail

if (( EUID == 0 )); then
  printf '%s\n' "Run this script as your deployment user with sudo access." >&2
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
git pull --ff-only
revision=$(git rev-parse --short HEAD)
printf 'Deploying Jetyet %s\n' "$revision"
bash deploy/install.sh
printf 'Jetyet %s deployed successfully.\n' "$revision"
