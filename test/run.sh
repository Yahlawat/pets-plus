#!/usr/bin/env bash
# Runs test/e2e.js in a throwaway VS Code instance (own profile, no other extensions).
set -euo pipefail
cd "$(dirname "$0")/.."

CODE="/Applications/Visual Studio Code.app/Contents/MacOS/Code"
# Real path: /var is a symlink, and file watching can miss changes made through it.
TMP=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/user/User" "$TMP/ext" "$TMP/ws"
echo '{ "workbench.startupEditor": "none", "security.workspace.trust.enabled": false, "git.openRepositoryInParentFolders": "never" }' > "$TMP/user/User/settings.json"
printf "print('hi')\n" > "$TMP/ws/code.py"
(cd "$TMP/ws" && git init -q && git add code.py && git -c user.name=t -c user.email=t@t commit -qm first)

status=0
"$CODE" \
  --user-data-dir "$TMP/user" \
  --extensions-dir "$TMP/ext" \
  --extensionDevelopmentPath "$PWD" \
  --extensionTestsPath "$PWD/test/e2e.js" \
  "$TMP/ws" >/dev/null 2>&1 || status=$?

cat "$TMP/ws/results.txt" 2>/dev/null || echo "No results: the test didn't finish."
exit $status
