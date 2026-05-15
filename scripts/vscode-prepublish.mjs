import { spawnSync } from 'node:child_process';

if (process.env.INJECT_D_TS_SKIP_PREPUBLISH === '1') {
	console.log('Skipping vscode:prepublish because INJECT_D_TS_SKIP_PREPUBLISH=1.');
	process.exit(0);
}

const result = spawnSync('pnpm', ['run', 'package'], {
	stdio: 'inherit',
	shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
