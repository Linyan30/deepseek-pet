'use strict';

/**
 * 跨平台的测试入口。
 *
 * 直接用 `node test/xxx.test.js` 逐个执行，而不是 `node --test`：
 * - 免去 Windows 上的 shell 通配符问题；
 * - 不依赖测试运行器再 fork 子进程，在受限环境（比如沙箱）里也能跑；
 * - 每个文件仍在独立的 Node 进程里运行，互不影响。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

const files = fs
  .readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error('没有找到测试文件');
  process.exit(1);
}

let failed = 0;

for (const name of files) {
  const file = path.join(TEST_DIR, name);
  const started = Date.now();
  const result = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  const elapsed = Date.now() - started;

  if (result.status === 0) {
    console.log(`\n✓ ${name} (${elapsed}ms)\n`);
  } else {
    failed += 1;
    console.error(`\n✗ ${name} 失败 (exit ${result.status})\n`);
  }
}

console.log('─'.repeat(48));
if (failed === 0) {
  console.log(`全部 ${files.length} 个测试文件通过`);
  process.exit(0);
}

console.error(`${failed}/${files.length} 个测试文件失败`);
process.exit(1);
