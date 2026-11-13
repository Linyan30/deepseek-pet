'use strict';

/**
 * 语法体检：对仓库里所有 .js 文件跑一遍 `node --check`。
 * 用 stdio: 'ignore'，所以也适用于受限沙箱环境。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'release', 'dist', 'out', '.git', '.chrome-profile']);

function walk(dir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

if (!fs.existsSync(ROOT)) {
  console.error(`目录不存在：${ROOT}`);
  process.exit(1);
}

const files = walk(ROOT, []);
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'ignore' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`✗ 语法错误：${path.relative(ROOT, file)}`);
  }
}

console.log(`语法检查：${files.length - failed}/${files.length} 个文件通过`);
process.exit(failed === 0 ? 0 : 1);
