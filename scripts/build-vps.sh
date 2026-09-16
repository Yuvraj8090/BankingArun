#!/usr/bin/env bash
# Build from a clean checkout in CI; package only public runtime files.
set -euo pipefail
cd "$(dirname "$0")/.."

while IFS= read -r -d '' file; do
  php -l "$file" > /dev/null
done < <(find hostinger -name '*.php' ! -name config.local.php -print0)
(
  cd frontend
  # Existing lint warnings remain visible without blocking the production build.
  CI=false REACT_APP_BACKEND_URL='' INLINE_RUNTIME_CHUNK=false npm run build
)

mkdir -p .deploy
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R frontend/build/. "$stage/"
cp hostinger/api.php hostinger/db.php hostinger/cron.php hostinger/.htaccess "$stage/"
cp -R hostinger/modules hostinger/assets "$stage/"
git rev-parse HEAD > "$stage/version.txt"

# One packaging check: the entry points exist and secrets/source data stay out.
python3 - "$stage" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
for name in ('index.html', 'api.php', 'db.php', 'cron.php', '.htaccess', 'version.txt'):
    assert (root / name).is_file(), name
for path in root.rglob('*'):
    assert path.name != 'config.local.php', path
    assert path.name != '.env' and not path.name.startswith('.env.'), path
    assert path.suffix not in ('.sql', '.log', '.pem', '.key'), path
assert list((root / 'static/js').glob('*.js')), 'Missing frontend JavaScript'
PY
tar -czf .deploy/release.tar.gz -C "$stage" .
echo 'Release package: .deploy/release.tar.gz (database and server config excluded)'
