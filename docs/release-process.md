# Release Process

## Versioning

gh-helix follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **MAJOR** — breaking changes to the CLI surface (flag removal/renaming, exit code semantics,
  config key changes) or to `.metadata/*.json` schemas in a way that isn't handled by the
  automatic migration path (see [Installation: Upgrading](installation.md#upgrading)).
- **MINOR** — new commands, new flags, new optional config keys, backward-compatible additions to
  manifest/cache schemas.
- **PATCH** — bug fixes, documentation, dependency bumps with no behavior change.

The current version lives in [`package.json`](../package.json) (`version` field) — this is the
single source of truth; it is not duplicated elsewhere in the repository.

## Before cutting a release

1. Confirm CI is green on `main` for the commit being released — see
   [.github/workflows/ci.yml](../.github/workflows/ci.yml) (typecheck, lint, format check, test,
   build, across Windows and Linux).
2. Update [CHANGELOG.md](../CHANGELOG.md) — move the relevant `Unreleased` entries under a new
   version heading with today's date, following [Keep a Changelog](https://keepachangelog.com/)
   format (Added / Changed / Fixed / Removed / Security).
3. Bump `version` in `package.json` (`npm version <major|minor|patch> --no-git-tag-version` is a
   reasonable way to do this consistently).
4. Run the full local check locally as a final gate:
   ```bash
   npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
   ```

## Tagging and publishing

1. Commit the version bump and changelog update.
2. Tag the commit: `git tag vX.Y.Z`.
3. Push the tag: `git push origin vX.Y.Z`.
4. Push to `main` (or merge the release PR).
5. Create a GitHub Release from the tag, using the corresponding `CHANGELOG.md` section as the
   release notes body.

The [`release` workflow](../.github/workflows/release.yml) runs on tag push (`v*`) and builds +
attaches release artifacts; it does not currently publish to the npm registry (gh-helix is
install-from-source only — see [Roadmap](roadmap.md#known-gaps-not-yet-on-a-committed-timeline)).
If/when npm publishing is added, `prepublishOnly` (already wired to `npm run build` in
`package.json`) ensures `dist/` is always rebuilt before any `npm publish`.

## Post-release

- Confirm the tagged CI run and release workflow both succeeded.
- Announce in whatever channels are relevant to your deployment (internal changelog, Slack, etc.)
  — this is left to the maintainer/organization using gh-helix, not automated.

## Hotfixes

For a fix that can't wait for the next planned release: branch from the released tag, apply the
minimal fix, bump the PATCH version, and follow the same tag/release steps above rather than
releasing directly off an unreleased `main`.

## See also

- [CHANGELOG.md](../CHANGELOG.md)
- [SUPPORTED_VERSIONS.md](../SUPPORTED_VERSIONS.md)
- [Testing](testing.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
