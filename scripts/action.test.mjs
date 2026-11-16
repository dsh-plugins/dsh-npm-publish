import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./release.mjs', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'shared-npm-release-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const pkg = { name: '@test/plugin', version: '1.2.3' };
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ version: pkg.version, packages: { '': pkg } }));
  const output = join(cwd, 'output');
  writeFileSync(output, '');
  return {
    run: (env = {}) => spawnSync(process.execPath, [script], {
      cwd, encoding: 'utf8', env: {
        ...process.env, GITHUB_WORKSPACE: cwd, PACKAGE_DIR: '.', RELEASE_TASK: 'resolve', RELEASE_MODE: 'push',
        GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main', GITHUB_RUN_ID: '123',
        DEFAULT_BRANCH: 'main', GITHUB_OUTPUT: output, DRY_RUN: 'false', SKIP_WITHOUT_TOKEN: 'false', ...env,
      },
    }),
    outputs: () => Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('='))),
    read: (file) => JSON.parse(readFileSync(join(cwd, file), 'utf8')),
  };
}

test('composite task emits outputs and optionally synchronizes prerelease lockfiles', (t) => {
  const f = fixture(t);
  const run = f.run({ SYNC_LOCKFILE: 'true' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(f.outputs(), { enabled: 'true', name: '@test/plugin', version: '1.2.3-dev.123', tag: 'next' });
  assert.equal(f.read('package.json').version, '1.2.3-dev.123');
  assert.equal(f.read('package-lock.json').packages[''].version, '1.2.3-dev.123');
});

test('missing optional token skips both version mutation and publication', (t) => {
  const f = fixture(t);
  assert.equal(f.run({ SKIP_WITHOUT_TOKEN: 'true', NODE_AUTH_TOKEN: '' }).status, 0);
  assert.deepEqual(f.outputs(), { enabled: 'false' });
  assert.equal(f.read('package.json').version, '1.2.3');
});

test('dry-run works from PR refs without requesting publication credentials', (t) => {
  const f = fixture(t);
  assert.equal(f.run({ DRY_RUN: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: '1/merge' }).status, 0);
  assert.equal(f.outputs().tag, 'next');
});

test('tag mismatch fails before changing files or exposing outputs', (t) => {
  const f = fixture(t);
  assert.notEqual(f.run({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.4' }).status, 0);
  assert.equal(f.read('package.json').version, '1.2.3');
});
