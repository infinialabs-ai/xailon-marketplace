#!/usr/bin/env bash
# Publishes site/ to Cloudflare Pages. Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
# from .env (never committed). The first run creates the project, its custom domain and DNS.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${PAGES_PROJECT:-xailon-marketplace}"
DOMAIN="${PAGES_DOMAIN:-xailon-marketplace.infinialabs.ai}"
ZONE="${PAGES_ZONE:-infinialabs.ai}"

set -a
# shellcheck disable=SC1091
. ./.env
set +a
api() {
  curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"
}
base="https://api.cloudflare.com/client/v4"

npm run --silent build
node scripts/catalog.mjs check

if ! api "$base/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT" >/dev/null 2>&1; then
  npx --yes wrangler@4 pages project create "$PROJECT" --production-branch main
fi
npx --yes wrangler@4 pages deploy site --project-name "$PROJECT" --branch main --commit-dirty=true

domains="$(api "$base/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT/domains")"
if ! node -e 'process.exit(JSON.parse(process.argv[1]).result.some((d) => d.name === process.argv[2]) ? 0 : 1)' "$domains" "$DOMAIN"; then
  api -X POST "$base/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT/domains" --data "{\"name\":\"$DOMAIN\"}" >/dev/null
  echo "Added custom domain $DOMAIN"
fi

zone_id="$(api "$base/zones?name=$ZONE" | node -p 'JSON.parse(require("fs").readFileSync(0)).result[0].id')"
records="$(api "$base/zones/$zone_id/dns_records?name=$DOMAIN")"
if [ "$(node -p 'JSON.parse(process.argv[1]).result.length' "$records")" = "0" ]; then
  api -X POST "$base/zones/$zone_id/dns_records" \
    --data "{\"type\":\"CNAME\",\"name\":\"$DOMAIN\",\"content\":\"$PROJECT.pages.dev\",\"proxied\":true}" >/dev/null
  echo "Created DNS record $DOMAIN -> $PROJECT.pages.dev"
fi
echo "Published https://$DOMAIN"
