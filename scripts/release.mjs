import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function resolveRelease(version, { mode, event, refType, refName, runId, branch = 'main' }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`package.json must have a stable X.Y.Z version; got ${version}`);
  }
  if (mode === 'release') {
    if (!['release', 'workflow_dispatch'].includes(event)) throw new Error(`Unsupported release event: ${event}`);
    return { version, tag: 'latest' };
  }
  if (event !== 'push' && process.env.DRY_RUN !== 'true') throw new Error(`Unsupported event: ${event}`);
  if (refType === 'tag') {
    if (refName !== `v${version}`) throw new Error(`Tag ${refName} must match v${version}`);
    return { version, tag: 'latest' };
  }
  if (refType !== 'branch' || refName !== branch || !/^\d+$/.test(runId)) throw new Error('Unsupported branch or run ID');
  return { version: `${version}-dev.${runId}`, tag: 'next' };
}

export function publishFlags(value = '') {
  const flags = value.trim().split(/\s+/).filter(Boolean);
  const allowed = new Set(['--access', 'public', '--provenance', '--ignore-scripts']);
  if (flags.some((flag) => !allowed.has(flag))) throw new Error('Unsupported npm publish flag');
  return flags;
}

export function publishedResult(result, expectedSha) {
  if (result.error) throw result.error;
  if (result.status === 0) {
    if (expectedSha && result.stdout.trim() !== expectedSha) throw new Error('Published gitHead does not match this commit');
    return true;
  }
  if (`${result.stdout}\n${result.stderr}`.includes('E404')) return false;
  throw new Error(`npm view failed: ${result.stdout}\n${result.stderr}`);
}

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const output = (values) => {
  for (const [key, value] of Object.entries(values)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
const npm = (args) => spawnSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32' });
const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });

async function main(task) {
  process.chdir(resolve(process.env.GITHUB_WORKSPACE || process.cwd(), process.env.PACKAGE_DIR || '.'));
  if (task === 'resolve') {
    if (process.env.SKIP_WITHOUT_TOKEN === 'true' && !process.env.NODE_AUTH_TOKEN) {
      output({ enabled: 'false' });
      console.log('NPM_TOKEN is not configured; skipping publication and version writeback.');
      return;
    }
    const pkg = json('package.json');
    const dryRun = process.env.DRY_RUN === 'true';
    const release = resolveRelease(pkg.version, {
      mode: dryRun ? 'push' : process.env.RELEASE_MODE, event: dryRun ? 'push' : process.env.GITHUB_EVENT_NAME,
      refType: dryRun ? 'branch' : process.env.GITHUB_REF_TYPE,
      refName: dryRun ? process.env.DEFAULT_BRANCH : process.env.GITHUB_REF_NAME,
      runId: process.env.GITHUB_RUN_ID, branch: process.env.DEFAULT_BRANCH,
    });
    if (pkg.version !== release.version) {
      pkg.version = release.version;
      writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
      if (process.env.SYNC_LOCKFILE === 'true') {
        for (const path of ['package-lock.json', 'npm-shrinkwrap.json']) {
          if (!existsSync(path)) continue;
          const lock = json(path);
          lock.version = release.version;
          if (lock.packages?.['']) lock.packages[''].version = release.version;
          writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
        }
      }
    }
    output({ enabled: 'true', name: pkg.name, version: release.version, tag: release.tag });
  } else if (task === 'check') {
    const pkg = json('package.json');
    const verify = process.env.VERIFY_GIT_HEAD === 'true';
    const result = npm(['view', `${pkg.name}@${pkg.version}`, verify ? 'gitHead' : 'version',
      `--registry=${process.env.NPM_REGISTRY}`]);
    output({ exists: String(publishedResult(result, verify ? process.env.GITHUB_SHA : undefined)) });
  } else if (task === 'publish') {
    const result = npm(['publish', '--tag', process.env.DIST_TAG,
      `--registry=${process.env.NPM_REGISTRY}`, ...publishFlags(process.env.PUBLISH_FLAGS)]);
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm publish exited with ${result.status}`);
  } else if (task === 'writeback') {
    execFileSync(process.execPath, [fileURLToPath(new URL('./dump-npm-latest.mjs', import.meta.url))], { stdio: 'inherit' });
    execFileSync(process.execPath, [fileURLToPath(new URL('./bump-next-patch.mjs', import.meta.url))], { stdio: 'inherit' });
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    const files = ['npm-latest.json', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json'].filter(existsSync);
    git('add', '--', ...files);
    const diff = spawnSync('git', ['diff', '--cached', '--quiet']);
    if (diff.status === 0) return;
    if (diff.status !== 1) throw new Error('Cannot inspect staged release changes');
    git('commit', '-m', 'chore(release): 更新正式版元数据并递增 patch [skip ci]');
    git('push', 'origin', `HEAD:${process.env.DEFAULT_BRANCH || 'main'}`);
  } else {
    throw new Error(`Unsupported release task: ${task}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.env.RELEASE_TASK);
}
