#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
port=${E2E_PORT:-3107}
case "$port" in ''|3000|*[!0-9]*) echo "Choose a numeric test port other than 3000" >&2; exit 1;; esac
project=$(mktemp -d "${TMPDIR:-/tmp}/maps-root-e2e.XXXXXX")
trap 'rm -rf "$project"' EXIT
cp -R src public "$project/"
cp package.json next.config.js tsconfig.json next-env.d.ts postcss.config.mjs tailwind.config.ts "$project/"
ln -s "$PWD/node_modules" "$project/node_modules"
cd "$project"
# Next's supported mock hook keeps the server-side font loader offline too.
cat > fonts.cjs <<'EOF'
module.exports = new Proxy({}, {get: () => `/* latin */
@font-face {
  font-family: 'Geist';
  src: url(${require.resolve('next/dist/compiled/@vercel/og/Geist-Regular.ttf')}) format('truetype');
}`});
EOF
env NEXT_FONT_GOOGLE_MOCKED_RESPONSES="$project/fonts.cjs" \
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=e2e-fake-key NEXT_PUBLIC_GOOGLE_MAPS_ID=e2e-fake-map \
  GOOGLE_MAPS_SERVER_API_KEY=e2e-fake-key GOOGLE_ROUTES_SERVER_API_KEY=e2e-fake-key \
  OPENAI_API_KEY=e2e-fake-key LEDGER_BACKEND=file LEDGER_FILE="$project/ledger.json" \
  NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port "$port"
