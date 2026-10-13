#!/usr/bin/env bash
# Сборка статической версии и публикация на GitHub Pages (ветка gh-pages).
set -euo pipefail
cd "$(dirname "$0")/.."

API_BASE="${API_BASE:-https://212-193-5-193.sslip.io/portal}"
BASE_PATH="${BASE_PATH:-/expert-testing-web-system}"

echo "▶ Сборка статики (API: $API_BASE)"
NEXT_PUBLIC_API_BASE="$API_BASE" NEXT_PUBLIC_BASE_PATH="$BASE_PATH" npm run build

touch out/.nojekyll
echo "▶ Публикация ветки gh-pages"
cd out
TMP="$(mktemp -d)"
git init -q "$TMP"
cp -r . "$TMP/"
cd "$TMP"
git add -A
git -c user.name=MarkusFarfall -c user.email="56957361+MarkusFarfall@users.noreply.github.com" commit -qm "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
PUSH_URL="https://github.com/MarkusFarfall/expert-testing-web-system.git"
[ -n "${GH_TOKEN:-}" ] && PUSH_URL="https://x-access-token:${GH_TOKEN}@github.com/MarkusFarfall/expert-testing-web-system.git"
git push -f "$PUSH_URL" HEAD:gh-pages
echo "✓ Готово: https://markusfarfall.github.io/expert-testing-web-system/"
