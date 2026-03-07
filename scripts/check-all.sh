#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${ROOT_DIR}/.." && pwd)"
FAST_SCRIPT="${WORKSPACE_ROOT}/dev-services/check-fast.sh"

echo "gateway/scripts/check-all.sh is deprecated."
echo "Running ${FAST_SCRIPT} instead."

if [[ ! -x "${FAST_SCRIPT}" ]]; then
  echo "Missing executable: ${FAST_SCRIPT}"
  exit 1
fi

"${FAST_SCRIPT}"
