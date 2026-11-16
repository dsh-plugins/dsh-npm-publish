import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelease, publishedResult, publishFlags } from './release.mjs';

const push = { mode: 'push', event: 'push', refType: 'branch', refName: 'main', runId: '123' };
test('main pushes publish unique next versions', () => {
  assert.deepEqual(resolveRelease('1.2.3', push), { version: '1.2.3-dev.123', tag: 'next' });
});
test('tags publish the exact manifest version as latest', () => {
  assert.deepEqual(resolveRelease('1.2.3', { ...push, refType: 'tag', refName: 'v1.2.3' }),
    { version: '1.2.3', tag: 'latest' });
  assert.throws(() => resolveRelease('1.2.3', { ...push, refType: 'tag', refName: 'v1.2.4' }));
});
test('rejects unsupported branches, events and manifest versions', () => {
  for (const version of ['1.2.3-dev.1', '01.2.3', 'invalid']) assert.throws(() => resolveRelease(version, push));
  assert.throws(() => resolveRelease('1.2.3', { ...push, refName: 'feature' }));
  assert.throws(() => resolveRelease('1.2.3', { ...push, event: 'pull_request' }));
});
test('release/manual mode retains stable releases', () => {
  for (const event of ['release', 'workflow_dispatch']) {
    assert.deepEqual(resolveRelease('1.2.3', { ...push, mode: 'release', event }), { version: '1.2.3', tag: 'latest' });
  }
  assert.throws(() => resolveRelease('1.2.3', { ...push, mode: 'release' }));
});
test('only npm 404 means an unpublished version', () => {
  assert.equal(publishedResult({ status: 1, stdout: '', stderr: 'npm error E404' }), false);
  assert.throws(() => publishedResult({ status: 1, stdout: '', stderr: 'E403' }));
  assert.throws(() => publishedResult({ error: new Error('spawn failed') }));
  assert.equal(publishedResult({ status: 0, stdout: 'abc\n' }, 'abc'), true);
  assert.throws(() => publishedResult({ status: 0, stdout: 'other' }, 'abc'));
});
test('preserves supported publish flags without allowing command injection', () => {
  assert.deepEqual(publishFlags('--access public --provenance --ignore-scripts'),
    ['--access', 'public', '--provenance', '--ignore-scripts']);
  assert.throws(() => publishFlags('--tag latest; echo bad'));
});
