# Contributing

[`AGENTS.md`](AGENTS.md) is the working guide for humans and AI agents alike: the commands, the
guardrails, the conventions, the documentation map and the Definition of done.

1. Branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Make the change with its tests, and run the Definition of done locally.
3. Open a pull request into `develop`, titled in [Conventional Commits](https://www.conventionalcommits.org/) form. It's squash-merged once CI is green.

Releases are pull requests from `develop` into `main` titled `release: vX.Y.Z` and merged with a merge commit. Report security issues privately, as [`SECURITY.md`](SECURITY.md) describes.

## Supply-chain hardening

pnpm is pinned in `package.json`'s `packageManager` to an exact `11.x` version. `pnpm-workspace.yaml`
holds the settings pnpm 11 reads instead of `.npmrc`:

- `minimumReleaseAge: 4320`: no package version (transitive ones included) published less than 3
  days ago installs, so a compromised release has a window to be caught and pulled.
- `minimumReleaseAgeExclude: []`: nothing is exempt from the age gate.
- `trustPolicy: no-downgrade`: an install fails if a package's trust evidence (provenance, trusted
  publishing) regresses from an earlier release.
- `blockExoticSubdeps: true`: only a direct dependency may resolve from a git or tarball URL.
- `strictDepBuilds: true` with `dangerouslyAllowAllBuilds: false`: a dependency's install script
  fails the install unless `allowBuilds` approves it.
- `engineStrict: true`: a dependency whose `engines` excludes this repo's Node fails the install.
- `allowBuilds` lists only packages a real install proved need their build script, each with a
  reason: `@parcel/watcher` and `unrs-resolver` (Jest's native watcher and resolver).

`pnpm check:supply-chain` (`scripts/check-supply-chain.ts`) fails if `pnpm-workspace.yaml` loses
`trustPolicy: no-downgrade` or `minimumReleaseAge`, or gains a `trustPolicyExclude`.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`), run
the gate, and commit both files together. A lockfile change must always come from a local
`pnpm install` or `pnpm update` with these settings on, never a hand-edited or externally generated
lockfile. When `minimumReleaseAge` refuses a version, wait it out or pin an older compatible one.
Packages with native code go through `pnpm expo install <package>`.

**`eslint-config-expo` is deliberately not used.** It pulls in `eslint-import-resolver-typescript`,
whose only SDK-58-compatible version had a trust-evidence regression this repo's `trustPolicy`
caught. `eslint.config.ts` composes `typescript-eslint`'s `strictTypeChecked`,
`eslint-plugin-security`'s `recommended` and `eslint-plugin-react-hooks`' `recommended-latest`
directly instead.

**`pnpm check:expo` (`expo install --check`) is informational.** It compares every package against
the newest release on npm, with no awareness of `minimumReleaseAge`, so it flags any package whose
newer release is still too young to install. Run it (or `pnpm expo install --fix`) during a
deliberate Expo SDK upgrade, once the versions have cleared the 3-day gate.
