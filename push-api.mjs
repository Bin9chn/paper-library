#!/usr/bin/env node
/**
 * 通过 GitHub Git Data API 推送本地 HEAD 到远程仓库。
 *
 * 为什么不用 git push：这台机器上 github.com:443 连不上（超时），
 * 但 api.github.com 正常。所以走 API：
 *   1. `git ls-tree -r HEAD` 拿到本地所有文件路径 + git blob sha
 *   2. 拉远程 tree 同样映射，sha 相同的不重传
 *   3. 只上传变化的 blob，然后一次性建 tree / commit / 更新 ref
 *
 * 用法：node push-api.mjs ["提交说明"]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(fileURLToPath(import.meta.url));
const OWNER = 'Bin9chn';
const NAME = 'paper-library';
const BRANCH = 'main';

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const ghCandidates = [process.env.GH_PATH, 'C:/Program Files/GitHub CLI/gh.exe', 'gh'].filter(Boolean);
  for (const gh of ghCandidates) {
    try {
      const out = execFileSync(gh, ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (out) return out;
    } catch { /* 试下一个 */ }
  }
  return '';
}

const token = getToken();
if (!token) {
  console.error('[x] 没有可用的 GitHub Token（gh auth token 或环境变量 GITHUB_TOKEN）');
  process.exit(1);
}

async function api(endpoint, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${endpoint}: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const localHead = git(['rev-parse', 'HEAD']);
const message = process.argv[2] || git(['log', '-1', '--pretty=%B']) || 'sync';

// 本地文件清单
const localFiles = new Map();
for (const line of git(['ls-tree', '-r', 'HEAD']).split('\n')) {
  const m = line.match(/^(\d{6}) blob ([0-9a-f]{40})\t(.+)$/);
  if (m) localFiles.set(m[3], { mode: m[1], sha: m[2] });
}

// 远程状态（空仓库时 ref 不存在）
let remoteSha = null;
try {
  const ref = await api(`/repos/${OWNER}/${NAME}/git/ref/heads/${BRANCH}`);
  remoteSha = ref.object.sha;
} catch (err) {
  if (![404, 409].includes(err.status)) throw err;
}

/* 空仓库不能用 Git Data API 建 blob（409 Git Repository is empty），
   先用 Contents API 落一个初始提交，把分支养出来。 */
if (!remoteSha) {
  const seedPath = localFiles.has('README.md') ? 'README.md' : '.gitkeep';
  const seed = localFiles.has(seedPath) ? readFileSync(`${REPO}/${seedPath}`) : Buffer.from('');
  const put = await api(`/repos/${OWNER}/${NAME}/contents/${encodeURIComponent(seedPath)}`, {
    method: 'PUT',
    body: {
      message: 'init',
      content: seed.toString('base64'),
      branch: BRANCH,
    },
  });
  remoteSha = put.commit.sha;
  console.log(`[i] 仓库为空，已用 ${seedPath} 建立初始提交 ${remoteSha.slice(0, 7)}`);
}

const remoteFiles = new Map();
if (remoteSha) {
  const commit = await api(`/repos/${OWNER}/${NAME}/git/commits/${remoteSha}`);
  const tree = await api(`/repos/${OWNER}/${NAME}/git/trees/${commit.tree.sha}?recursive=1`);
  for (const node of tree.tree || []) {
    if (node.type === 'blob') remoteFiles.set(node.path, node.sha);
  }
}

// 只上传新增/变化的 blob
const entries = [];
let uploaded = 0;
for (const [path, info] of localFiles) {
  let sha = info.sha;
  if (remoteFiles.get(path) !== info.sha) {
    const buf = readFileSync(`${REPO}/${path}`);
    const blob = await api(`/repos/${OWNER}/${NAME}/git/blobs`, {
      method: 'POST',
      body: { content: buf.toString('base64'), encoding: 'base64' },
    });
    sha = blob.sha;
    uploaded += 1;
    console.log(`  上传 ${path} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  entries.push({ path, mode: info.mode, type: 'blob', sha });
}

const removed = [...remoteFiles.keys()].filter((p) => !localFiles.has(p));
if (uploaded === 0 && removed.length === 0) {
  console.log('[=] 远程已是最新，无需推送');
  process.exit(0);
}
for (const p of removed) console.log(`  删除 ${p}`);

const tree = await api(`/repos/${OWNER}/${NAME}/git/trees`, {
  method: 'POST',
  body: { tree: entries },
});
const commit = await api(`/repos/${OWNER}/${NAME}/git/commits`, {
  method: 'POST',
  body: { message, tree: tree.sha, parents: remoteSha ? [remoteSha] : [] },
});

if (remoteSha) {
  await api(`/repos/${OWNER}/${NAME}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
} else {
  await api(`/repos/${OWNER}/${NAME}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${BRANCH}`, sha: commit.sha } });
}

console.log(`[✓] 已推送 ${commit.sha.slice(0, 7)}（本地 HEAD ${localHead.slice(0, 7)}）→ github.com/${OWNER}/${NAME}`);
