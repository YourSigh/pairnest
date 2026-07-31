#!/usr/bin/env bash
set -euo pipefail

exec npx expo start --dev-client "$@"
