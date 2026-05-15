import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const packageJsonPath = path.resolve('package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const allowPlaceholderPublisher = process.argv.includes('--allow-placeholder-publisher');
const publisher = process.env.MARKETPLACE_PUBLISHER?.trim();
const repositoryUrl = process.env.MARKETPLACE_REPOSITORY_URL?.trim();
const explicitVersion = process.env.MARKETPLACE_VERSION?.trim();
const versionStrategy = process.env.MARKETPLACE_VERSION_STRATEGY?.trim();

if (publisher) {
  packageJson.publisher = publisher;
} else if (!packageJson.publisher) {
  if (!allowPlaceholderPublisher) {
    throw new Error('MARKETPLACE_PUBLISHER is required to publish this extension.');
  }

  packageJson.publisher = 'local-ci-publisher';
}

if (repositoryUrl) {
  const normalizedRepositoryUrl = repositoryUrl.replace(/^git\+/, '').replace(/\.git$/, '');

  packageJson.repository = {
    type: 'git',
    url: repositoryUrl,
  };
  packageJson.homepage ??= `${normalizedRepositoryUrl}#readme`;
  packageJson.bugs ??= {
    url: `${normalizedRepositoryUrl}/issues`,
  };
}

if (explicitVersion) {
  packageJson.version = explicitVersion;
} else if (versionStrategy === 'run-number') {
  const runNumber = process.env.GITHUB_RUN_NUMBER?.trim();
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(packageJson.version);

  if (!versionMatch) {
    throw new Error(`Unsupported package.json version: ${packageJson.version}`);
  }

  if (!runNumber) {
    throw new Error('GITHUB_RUN_NUMBER is required when MARKETPLACE_VERSION_STRATEGY=run-number.');
  }

  const [, major, minor] = versionMatch;
  packageJson.version = `${major}.${minor}.${Number(runNumber)}`;
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(
  `Prepared marketplace manifest for ${packageJson.name}@${packageJson.version} with publisher ${packageJson.publisher}.`,
);
