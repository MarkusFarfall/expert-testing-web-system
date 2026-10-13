#!/usr/bin/env bash
# Развёртывание API (Supabase Edge Function «portal») и секрета с доступом к базе.
#
# С 2026-10-13 база приложения — собственный Supabase на VDS (212.193.5.193, роль portal).
# Адрес базы хранится вне репозитория: /home/user/.supabase/vds-db-url.txt
#
# Откат на облачную базу: положить в /home/user/.supabase/vds-db-url.txt строку
#   postgresql://postgres.ijbixganpfkrmqyaykjf:<пароль из db-pass.txt>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres
# и выполнить этот же скрипт.
set -euo pipefail
REF="ijbixganpfkrmqyaykjf"
cd "$(dirname "$0")/.."  # корень проекта
DB_URL="$(cat /home/user/.supabase/vds-db-url.txt)"
/home/user/tools/vprefix/bin/supabase secrets set "DB_URL=$DB_URL" --project-ref "$REF"
/home/user/tools/vprefix/bin/supabase functions deploy portal --project-ref "$REF" --no-verify-jwt
echo "✓ Функция развёрнута: https://${REF}.supabase.co/functions/v1/portal"
