#!/usr/bin/env sh
# Cut a release: bump every manifest to one version, verify, tag, push, publish the GitHub release.
#   tools/release.sh 1.2.0            full release
#   tools/release.sh 1.2.0 --dry-run  bump and verify only, no commit
# The engine package (skills/inkline/engine/package.json + lock) keeps its own version on purpose:
# users only re-run `inkline setup` when its dependencies change, not on every release.
set -e
cd "$(dirname "$0")/.."
NEW="$1"
DRY="$2"
case "$NEW" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "usage: tools/release.sh <major.minor.patch> [--dry-run]" >&2; exit 1 ;;
esac
if [ "$DRY" != "--dry-run" ] && [ -n "$(git status --porcelain)" ]; then
  echo "release: working tree is not clean; commit or stash first" >&2; exit 1
fi
if git rev-parse "v$NEW" >/dev/null 2>&1; then
  echo "release: tag v$NEW already exists" >&2; exit 1
fi

node - "$NEW" <<'JS'
const fs = require('fs');
const v = process.argv[2];
const json = (p, f) => { const d = JSON.parse(fs.readFileSync(p, 'utf8')); f(d); fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n'); };
json('.claude-plugin/plugin.json', (d) => (d.version = v));
json('.claude-plugin/marketplace.json', (d) => d.plugins.forEach((p) => (p.version = v)));
json('.codex-plugin/plugin.json', (d) => (d.version = v));
json('.cursor-plugin/plugin.json', (d) => (d.version = v));
json('gemini-extension.json', (d) => (d.version = v));
fs.writeFileSync('skills/inkline/VERSION', v + '\n');
const skill = 'skills/inkline/SKILL.md';
fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace(/(\n  version: )"[^"]*"/, `$1"${v}"`));
JS

echo "release: bumped to $NEW, verifying …"
(cd skills/inkline/engine && npm test >/dev/null)
claude plugin validate . >/dev/null
claude plugin validate .claude-plugin/plugin.json >/dev/null
[ "$(skills/inkline/scripts/inkline --version)" = "$NEW" ] || { echo "release: CLI reports the wrong version" >&2; exit 1; }
grep -q "version: \"$NEW\"" skills/inkline/SKILL.md || { echo "release: SKILL.md metadata not bumped" >&2; exit 1; }

if [ "$DRY" = "--dry-run" ]; then
  echo "release: dry run ok; changes left in the working tree"
  exit 0
fi
git add -A
git diff --cached --quiet || git commit -q -m "release: v$NEW"
git tag -a "v$NEW" -m "inkline $NEW"
git push -q origin HEAD "v$NEW"
gh release create "v$NEW" --title "inkline $NEW" --generate-notes
echo "release: v$NEW published"
