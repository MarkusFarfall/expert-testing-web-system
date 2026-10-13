#!/usr/bin/env bash
# Развёртывание API (Supabase Edge Function «portal») и секрета с доступом к базе.
set -euo pipefail
REF="ijbixganpfkrmqyaykjf"
cd "$(dirname "$0")/.."  # корень проекта
DB_URL="postgresql://postgres.${REF}:$(cat /home/user/.supabase/db-pass.txt)@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
/home/user/tools/vprefix/bin/supabase secrets set "DB_URL=$DB_URL" --project-ref "$REF"
/home/user/tools/vprefix/bin/supabase functions deploy portal --project-ref "$REF" --no-verify-jwt
echo "✓ Функция развёрнута: https://${REF}.supabase.co/functions/v1/portal"
