#!/usr/bin/env bash
# Merge gate: validate the catalog, check generated files are current, and, when
# xailon is on PATH, install every item from a scratch marketplace in a throwaway root.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci --silent
node scripts/catalog.mjs check

if ! command -v xailon >/dev/null; then
  echo "xailon not on PATH; skipping install smoke test"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- . "$work/repo/"
git -C "$work/repo" init -q
git -C "$work/repo" add -A
git -C "$work/repo" -c user.name=ci -c user.email=ci@localhost commit -qm ci

export XAILON_PATH_ROOT="$work/root"
xailon plugin marketplace add "file://$work/repo" >/dev/null
name="$(node -p 'require("./.xailon-plugin/marketplace.json").name')"
for plugin in $(node -p 'require("./.xailon-plugin/marketplace.json").plugins.map(p => p.name).join(" ")'); do
  xailon plugin install "$plugin@$name" --yes >/dev/null
  echo "installed $plugin"
done
if xailon plugin list | grep -q refused; then
  xailon plugin list
  echo "a plugin was refused" >&2
  exit 1
fi
echo "All items install"
