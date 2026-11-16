# DSH npm Publish

Shared npm publishing workflow for the dsh-plugins organization. Projects keep their
quality checks and call this workflow after they pass. Release logic and regression
tests are maintained here once.

```yaml
jobs:
  publish:
    needs: quality
    if: github.event_name == 'push'
    permissions:
      contents: write
      id-token: write
    uses: dsh-plugins/dsh-npm-publish/.github/workflows/npm-publish.yml@main
    with:
      install-command: npm ci
      prepare-command: |
        npm run build
        npm test
        npm pack --dry-run
      publish-flags: --access public
```

Keep the caller named `.github/workflows/npm-publish.yml`. npm Trusted Publisher
validates the **calling repository and workflow**, so existing OIDC registrations
continue to refer to each plugin repository. Both caller and callee grant
`id-token: write`. Token-based callers explicitly pass `NPM_TOKEN` using `secrets`.
See [npm's documentation](https://docs.npmjs.com/trusted-publishers/).

Main pushes publish `X.Y.Z-dev.<run_id>` with the `next` dist-tag. Tags must exactly
match `vX.Y.Z` and publish to `latest`. Existing versions are skipped; registry
errors other than E404 fail the run. Stable releases update `npm-latest.json` and
bump the patch only if main still has the released version. npm lockfiles are
updated together. Writeback commits contain `[skip ci]`, and concurrent writebacks
are serialized. A concurrent change to main causes a safe push rejection; rerun
the failed job to recompute against current main.

`release-mode: release` supports repositories that publish on GitHub Release or
manual dispatch. `skip-without-token: true` skips publish/writeback when no token
is configured. `dry-run: true` never publishes or writes back to Git.

The workflow inputs document package manager, Node version, commands, publish
flags, lockfile synchronization, gitHead verification, and optional sibling
Loader workspace support. Caller-level environment variables are not inherited;
use the explicit inputs. Release jobs do not restore package-manager caches.

Callers follow `main` to receive shared fixes. The internal composite action uses
the same branch and runs from GitHub's action cache, outside the package contents.
Do not change the workflow interface incompatibly without migrating its callers.

Validation: `node --test scripts/*.test.mjs` and `actionlint`. CI also exercises
the reusable workflow with a package fixture and `dry-run: true`.
