#!/usr/bin/env bash
# Runs the unit checks with the Node that ships inside VS Code, so no Node install is needed.
set -euo pipefail
cd "$(dirname "$0")/.."
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" test/care.test.js
