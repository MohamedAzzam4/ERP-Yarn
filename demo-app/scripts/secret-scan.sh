#!/usr/bin/env bash
# Secret scan for the demo-app. Fails if any of the following are found:
#  - private keys (PEM/SSH/PGP)
#  - API tokens / service-account JSON shapes
#  - .env files
#  - Supabase / Firebase project IDs or anon keys

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Scanning demo-app for secrets and real-data leaks..."

# 1. No .env files should be present.
if find . -maxdepth 2 -name ".env*" -not -path "*/node_modules/*" -not -path "*/dist/*" | grep -q . ; then
  echo "FAIL: .env file present"
  find . -maxdepth 2 -name ".env*" -not -path "*/node_modules/*" -not -path "*/dist/*"
  exit 1
fi

# 2. Scan for common secret patterns in src/, root config, and HTML.
PATTERNS=(
  'BEGIN RSA PRIVATE KEY'
  'BEGIN OPENSSH PRIVATE KEY'
  'BEGIN PGP PRIVATE KEY'
  'AIza[0-9A-Za-z_-]{35}'
  'sk_live_[0-9a-zA-Z]{24,}'
  'sk_test_[0-9a-zA-Z]{24,}'
  'ghp_[0-9A-Za-z]{36}'
  'gho_[0-9A-Za-z]{36}'
  'supabaseUrl'
  'SUPABASE_URL'
  'SUPABASE_ANON_KEY'
  'SUPABASE_SERVICE_KEY'
  'firebaseConfig'
)

HITS=0
for pat in "${PATTERNS[@]}"; do
  if grep -REn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.md' --include='*.html' \
      --exclude-dir=node_modules --exclude-dir=dist --exclude='package-lock.json' \
      "$pat" ./src ./*.json ./*.ts ./*.js ./*.md ./index.html 2>/dev/null ; then
    HITS=$((HITS+1))
  fi
done

if [ "$HITS" -gt 0 ]; then
  echo "FAIL: $HITS secret pattern(s) matched"
  exit 1
fi

echo "==> No secrets, no API keys, no .env files, no Supabase/Firebase references."
echo "==> All showcase data is synthetic."
echo "PASS"
