import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const source = path.resolve('tsserver-plugin');
const destination = path.resolve('node_modules', 'inject-d-ts-tsserver-plugin');

rmSync(destination, { recursive: true, force: true });
mkdirSync(path.dirname(destination), { recursive: true });
cpSync(source, destination, {
	recursive: true,
	force: true,
});

console.log(`Prepared ${path.relative(process.cwd(), destination)}.`);
