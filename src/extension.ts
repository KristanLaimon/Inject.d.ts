import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import * as tar from 'tar';
import * as vscode from 'vscode';

const EXTENSION_ID = 'inject-d-ts';
const TSSERVER_PLUGIN_NAME = 'inject-d-ts-tsserver-plugin';

type TypePackage = {
	name: string;
	version: string;
	location: string;
	typeFiles: string[];
	bundled: boolean;
};

type Manifest = {
	version: 1;
	generatedAt: string;
	files: string[];
};

type DisabledBundledPackages = {
	version: 1;
	names: string[];
};

type PackageSpec = {
	name: string;
	selector: string;
};

type RegistryPackument = {
	'dist-tags'?: Record<string, string>;
	versions?: Record<string, RegistryManifest>;
};

type RegistryManifest = {
	name: string;
	version: string;
	dependencies?: Record<string, string>;
	dist?: {
		tarball?: string;
	};
};

export function activate(context: vscode.ExtensionContext) {
	const manager = new TypePackageManager(context);
	const provider = new TypePackagesProvider(manager);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('inject-d-ts.packages', provider),
		vscode.commands.registerCommand('inject-d-ts.refresh', async () => {
			await manager.runCommand('Refresh global types', async () => manager.refreshTypeManifest());
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.downloadPackage', async () => {
			await manager.runCommand('Download types package', async () => manager.downloadPackage());
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.editPackage', async (item?: TypePackageItem) => {
			await manager.runCommand('Edit types package', async () => manager.editPackage(item?.pkg));
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.deletePackage', async (item?: TypePackageItem) => {
			await manager.runCommand('Delete types package', async () => manager.deletePackage(item?.pkg));
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.openStorage', async () => {
			await manager.runCommand('Open types storage', async () => manager.openStorage());
		}),
	);

	void manager.runCommand('Activate Inject.d.ts', async () => manager.activate());
}

export function deactivate() {}

class TypePackageManager {
	private readonly storageRoot: string;
	private readonly packageRoot: string;
	private readonly manifestPath: string;
	private readonly disabledBundledPackagesPath: string;
	private readonly output = vscode.window.createOutputChannel('Inject.d.ts');

	constructor(private readonly context: vscode.ExtensionContext) {
		this.storageRoot = context.globalStorageUri.fsPath;
		this.packageRoot = path.join(this.storageRoot, 'type-packages');
		this.manifestPath = path.join(this.storageRoot, 'types-manifest.json');
		this.disabledBundledPackagesPath = path.join(this.storageRoot, 'disabled-bundled-packages.json');
		context.subscriptions.push(this.output);
	}

	async activate() {
		await this.ensurePackageRoot();
		await this.refreshTypeManifest();
		await this.configureTypeScriptPlugin();
	}

	async runCommand(label: string, action: () => Promise<void>) {
		try {
			await action();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`${label} failed: ${message}`);
			vscode.window.showErrorMessage(`${label} failed: ${message}`);
		}
	}

	async listPackages(): Promise<TypePackage[]> {
		const disabledBundledPackageNames = await this.readDisabledBundledPackageNames();
		const bundledPackages = (await this.discoverBundledDefaultPackages()).filter(
			(pkg) => !disabledBundledPackageNames.has(pkg.name.toLowerCase()),
		);
		const managedPackages = await this.discoverManagedPackages();
		const seen = new Set<string>();
		const packages: TypePackage[] = [];

		for (const pkg of [...managedPackages, ...bundledPackages]) {
			const key = pkg.name.toLowerCase();
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			packages.push(pkg);
		}

		return packages.sort((a, b) => a.name.localeCompare(b.name));
	}

	async refreshTypeManifest() {
		await this.ensurePackageRoot();
		const packages = await this.listPackages();
		const manifest: Manifest = {
			version: 1,
			generatedAt: new Date().toISOString(),
			files: packages.flatMap((pkg) => pkg.typeFiles),
		};

		await fs.promises.mkdir(path.dirname(this.manifestPath), { recursive: true });
		await fs.promises.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
		await this.configureTypeScriptPlugin();
	}

	async downloadPackage() {
		const packageSpec = await vscode.window.showInputBox({
			title: 'Download types package',
			prompt: 'Package name or spec from npm, for example @types/node, bun-types, @types/lodash@latest',
			placeHolder: '@types/node',
			validateInput: (value) => this.validatePackageSpec(value),
		});

		if (!packageSpec) {
			return;
		}

		await this.ensurePackageRoot();
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Downloading ${packageSpec}`,
				cancellable: false,
			},
			async () => {
				await this.installPackageFromRegistry(packageSpec.trim(), new Set());
			},
		);

		await this.refreshTypeManifest();
		await this.restartTypeScriptServer();
		vscode.window.showInformationMessage(`Downloaded ${packageSpec}.`);
	}

	async editPackage(pkg?: TypePackage) {
		const selected = pkg ?? await this.pickPackage('Change types package version');
		if (!selected) {
			return;
		}

		const packageSpec = await vscode.window.showInputBox({
			title: 'Change types package version',
			prompt: 'Enter a package version spec from npm, for example @types/node@latest, @types/node@22, or @types/node@20.11.30',
			placeHolder: `${selected.name}@latest`,
			value: `${selected.name}@${selected.version}`,
			validateInput: (value) => this.validatePackageSpec(value, selected.name),
		});

		if (!packageSpec) {
			return;
		}

		const spec = this.parsePackageSpec(packageSpec);
		await this.ensurePackageRoot();
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Installing ${packageSpec}`,
				cancellable: false,
			},
			async () => {
				await this.installPackageFromRegistry(packageSpec.trim(), new Set(), {
					replaceExistingRoot: true,
				});
				await this.enableBundledPackage(spec.name);
			},
		);

		await this.refreshTypeManifest();
		await this.restartTypeScriptServer();
		vscode.window.showInformationMessage(`Installed ${packageSpec}.`);
	}

	async deletePackage(pkg?: TypePackage) {
		const selected = pkg ?? await this.pickPackage('Delete types package');
		if (!selected) {
			return;
		}

		const answer = await vscode.window.showWarningMessage(
			`Delete ${selected.name} from global Inject.d.ts types?`,
			{ modal: true },
			'Delete',
		);

		if (answer !== 'Delete') {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Deleting ${selected.name}`,
				cancellable: false,
			},
			async () => {
				if (selected.bundled) {
					await this.disableBundledPackage(selected.name);
				} else {
					await fs.promises.rm(selected.location, { recursive: true, force: true });
					await this.removeStoredDependency(selected.name);
				}
			},
		);

		await this.refreshTypeManifest();
		await this.restartTypeScriptServer();
		vscode.window.showInformationMessage(`Deleted ${selected.name}.`);
	}

	async openStorage() {
		await this.ensurePackageRoot();
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(this.packageRoot), {
			forceNewWindow: true,
		});
	}

	private async configureTypeScriptPlugin() {
		const configuration = {
			manifestPath: this.manifestPath,
		};

		try {
			await vscode.commands.executeCommand('_typescript.configurePlugin', TSSERVER_PLUGIN_NAME, configuration);
		} catch {
			// The built-in TypeScript extension may not be active yet. The contributed plugin
			// still loads, and activation will configure it again when this extension reloads.
		}
	}

	private async restartTypeScriptServer() {
		try {
			await vscode.commands.executeCommand('typescript.restartTsServer');
		} catch {
			// No active TS server yet.
		}
	}

	private async ensurePackageRoot() {
		await fs.promises.mkdir(this.packageRoot, { recursive: true });

		const packageJsonPath = path.join(this.packageRoot, 'package.json');
		if (!fs.existsSync(packageJsonPath)) {
			await fs.promises.writeFile(
				packageJsonPath,
				JSON.stringify(
					{
						name: 'inject-d-ts-global-types',
						private: true,
						version: '0.0.0',
						dependencies: {},
					},
					null,
					2,
				),
				'utf8',
			);
		}
	}

	private async pickPackage(title: string): Promise<TypePackage | undefined> {
		const packages = await this.listPackages();
		const picked = await vscode.window.showQuickPick(
			packages.map((pkg) => ({
				label: pkg.name,
				description: `${pkg.version}${pkg.bundled ? ' - bundled' : ''}`,
				detail: pkg.location,
				pkg,
			})),
			{ title },
		);

		return picked?.pkg;
	}

	private validatePackageSpec(value: string, expectedPackageName?: string): string | undefined {
		const trimmed = value.trim();
		if (!trimmed) {
			return 'Enter an npm package name.';
		}

		try {
			const spec = this.parsePackageSpec(trimmed);
			if (expectedPackageName && spec.name.toLowerCase() !== expectedPackageName.toLowerCase()) {
				return `Enter a version spec for ${expectedPackageName}.`;
			}
		} catch {
			return 'Use an npm package name or version spec, for example @types/node@latest.';
		}

		return undefined;
	}

	private async discoverBundledDefaultPackages(): Promise<TypePackage[]> {
		const candidates = [
			...await this.findBundledPackageLocations('@types/node'),
			...await this.findBundledPackageLocations('bun-types'),
			...await this.findBundledPackageLocations('@types/deno'),
		];

		return this.packageInfosFromLocations(candidates, true);
	}

	private async findBundledPackageLocations(packageName: string): Promise<string[]> {
		const extensionRoot = this.context.extensionUri.fsPath;
		const normalLocation = path.join(extensionRoot, 'node_modules', ...packageName.split('/'));
		const locations = fs.existsSync(normalLocation) ? [normalLocation] : [];
		const pnpmRoot = path.join(extensionRoot, 'node_modules', '.pnpm');

		if (!fs.existsSync(pnpmRoot)) {
			return locations;
		}

		const packageFolderPattern = packageName.replace('/', '+');
		for (const entry of await fs.promises.readdir(pnpmRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() || !entry.name.startsWith(`${packageFolderPattern}@`)) {
				continue;
			}

			const pnpmLocation = path.join(pnpmRoot, entry.name, 'node_modules', ...packageName.split('/'));
			if (fs.existsSync(pnpmLocation)) {
				locations.push(pnpmLocation);
			}
		}

		return locations;
	}

	private async discoverManagedPackages(): Promise<TypePackage[]> {
		const nodeModules = path.join(this.packageRoot, 'node_modules');
		const locations: string[] = [];

		if (!fs.existsSync(nodeModules)) {
			return [];
		}

		for (const entry of await fs.promises.readdir(nodeModules, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) {
				continue;
			}

			if (entry.name.startsWith('@')) {
				const scopePath = path.join(nodeModules, entry.name);
				for (const scopedEntry of await fs.promises.readdir(scopePath, { withFileTypes: true })) {
					if (scopedEntry.isDirectory()) {
						locations.push(path.join(scopePath, scopedEntry.name));
					}
				}
			} else {
				locations.push(path.join(nodeModules, entry.name));
			}
		}

		return this.packageInfosFromLocations(locations, false);
	}

	private async packageInfosFromLocations(locations: string[], bundled: boolean): Promise<TypePackage[]> {
		const packages: TypePackage[] = [];

		for (const location of locations) {
			const packageJsonPath = path.join(location, 'package.json');
			if (!fs.existsSync(packageJsonPath)) {
				continue;
			}

			try {
				const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8')) as {
					name?: string;
					version?: string;
				};
				const typeFiles = await this.findTypeFiles(location);
				if (packageJson.name && typeFiles.length > 0) {
					packages.push({
						name: packageJson.name,
						version: packageJson.version ?? 'unknown',
						location,
						typeFiles,
						bundled,
					});
				}
			} catch (error) {
				this.output.appendLine(`Failed to inspect ${location}: ${String(error)}`);
			}
		}

		return packages;
	}

	private async findTypeFiles(root: string): Promise<string[]> {
		const files: string[] = [];
		const ignoredDirectories = new Set(['.git', '.pnpm', 'node_modules']);

		const visit = async (directory: string) => {
			for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
				const entryPath = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					if (!ignoredDirectories.has(entry.name)) {
						await visit(entryPath);
					}
					continue;
				}

				if (entry.isFile() && entry.name.endsWith('.d.ts')) {
					files.push(entryPath);
				}
			}
		};

		await visit(root);
		return files.sort((a, b) => a.localeCompare(b));
	}

	private async installPackageFromRegistry(
		packageSpec: string,
		visited: Set<string>,
		options: { replaceExistingRoot?: boolean } = {},
	): Promise<void> {
		await this.ensurePackageRoot();
		const spec = this.parsePackageSpec(packageSpec);
		const manifest = await this.resolveRegistryManifest(spec);
		const key = `${manifest.name}@${manifest.version}`;

		if (visited.has(key)) {
			return;
		}
		visited.add(key);

		const destination = this.packageInstallLocation(manifest.name);
		const replacingExistingPackage = fs.existsSync(destination);
		if (replacingExistingPackage) {
			if (!options.replaceExistingRoot) {
				this.output.appendLine(`${manifest.name} is already installed. Use Change Types Package Version to install another version.`);
				return;
			}
		}

		const tarball = manifest.dist?.tarball;
		if (!tarball) {
			throw new Error(`${manifest.name}@${manifest.version} has no npm tarball.`);
		}

		this.output.appendLine(`Downloading ${manifest.name}@${manifest.version}`);
		await fs.promises.mkdir(path.dirname(destination), { recursive: true });
		const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'inject-d-ts-'));
		const tarballPath = path.join(tempRoot, 'package.tgz');
		const extractPath = path.join(tempRoot, 'package');

		try {
			await this.downloadFile(tarball, tarballPath);
			await fs.promises.mkdir(extractPath, { recursive: true });
			await tar.x({ file: tarballPath, cwd: extractPath, strip: 1 });
			if (replacingExistingPackage) {
				await fs.promises.rm(destination, { recursive: true, force: true });
			}
			await fs.promises.rename(extractPath, destination);
			await this.recordStoredDependency(manifest.name, manifest.version);
		} finally {
			await fs.promises.rm(tempRoot, { recursive: true, force: true });
		}

		for (const [dependencyName, dependencyRange] of Object.entries(manifest.dependencies ?? {})) {
			await this.installPackageFromRegistry(`${dependencyName}@${dependencyRange}`, visited);
		}
	}

	private async readDisabledBundledPackageNames(): Promise<Set<string>> {
		try {
			const disabled = JSON.parse(await fs.promises.readFile(this.disabledBundledPackagesPath, 'utf8')) as DisabledBundledPackages;
			return new Set((disabled.names ?? []).map((name) => name.toLowerCase()));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				this.output.appendLine(`Failed to read disabled bundled packages: ${String(error)}`);
			}
			return new Set();
		}
	}

	private async writeDisabledBundledPackageNames(names: Set<string>) {
		await fs.promises.mkdir(path.dirname(this.disabledBundledPackagesPath), { recursive: true });
		const disabled: DisabledBundledPackages = {
			version: 1,
			names: [...names].sort((a, b) => a.localeCompare(b)),
		};
		await fs.promises.writeFile(this.disabledBundledPackagesPath, JSON.stringify(disabled, null, 2), 'utf8');
	}

	private async disableBundledPackage(packageName: string) {
		const names = await this.readDisabledBundledPackageNames();
		names.add(packageName.toLowerCase());
		await this.writeDisabledBundledPackageNames(names);
	}

	private async enableBundledPackage(packageName: string) {
		const names = await this.readDisabledBundledPackageNames();
		names.delete(packageName.toLowerCase());
		await this.writeDisabledBundledPackageNames(names);
	}

	private parsePackageSpec(packageSpec: string): PackageSpec {
		const trimmed = packageSpec.trim();
		const match = /^(?:(@[a-z0-9_.-]+\/[a-z0-9_.-]+)|([a-z0-9_.-]+))(?:@(.+))?$/i.exec(trimmed);
		if (!match) {
			throw new Error(`Invalid npm package spec: ${packageSpec}`);
		}

		return {
			name: match[1] ?? match[2],
			selector: match[3] ?? 'latest',
		};
	}

	private async resolveRegistryManifest(spec: PackageSpec): Promise<RegistryManifest> {
		const packument = await this.fetchJson<RegistryPackument>(`https://registry.npmjs.org/${encodeURIComponent(spec.name)}`);
		const versions = packument.versions ?? {};
		const distTags = packument['dist-tags'] ?? {};
		const version = distTags[spec.selector] ?? spec.selector;

		if (versions[version]) {
			return versions[version];
		}

		const maxSatisfying = semver.maxSatisfying(Object.keys(versions), spec.selector);
		if (maxSatisfying && versions[maxSatisfying]) {
			return versions[maxSatisfying];
		}

		throw new Error(`Could not resolve ${spec.name}@${spec.selector} from npm.`);
	}

	private packageInstallLocation(packageName: string): string {
		const parts = packageName.split('/');
		return path.join(this.packageRoot, 'node_modules', ...parts);
	}

	private async recordStoredDependency(packageName: string, version: string) {
		const packageJsonPath = path.join(this.packageRoot, 'package.json');
		const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		packageJson.dependencies = {
			...(packageJson.dependencies ?? {}),
			[packageName]: version,
		};
		await fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
	}

	private async removeStoredDependency(packageName: string) {
		const packageJsonPath = path.join(this.packageRoot, 'package.json');
		const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		if (packageJson.dependencies) {
			delete packageJson.dependencies[packageName];
		}
		await fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
	}

	private fetchJson<T>(url: string): Promise<T> {
		return new Promise((resolve, reject) => {
			https.get(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } }, (response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => {
					if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
						reject(new Error(`npm registry returned ${response.statusCode ?? 'no status'} for ${url}`));
						return;
					}

					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
					} catch (error) {
						reject(error);
					}
				});
			}).on('error', reject);
		});
	}

	private downloadFile(url: string, destination: string, redirects = 0): Promise<void> {
		return new Promise((resolve, reject) => {
			https.get(url, (response) => {
				if (
					response.statusCode &&
					response.statusCode >= 300 &&
					response.statusCode < 400 &&
					response.headers.location &&
					redirects < 5
				) {
					response.resume();
					this.downloadFile(response.headers.location, destination, redirects + 1).then(resolve, reject);
					return;
				}

				if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
					response.resume();
					reject(new Error(`Download returned ${response.statusCode ?? 'no status'} for ${url}`));
					return;
				}

				const file = fs.createWriteStream(destination);
				response.pipe(file);
				file.on('finish', () => {
					file.close((error) => error ? reject(error) : resolve());
				});
				file.on('error', reject);
			}).on('error', reject);
		});
	}
}

class TypePackagesProvider implements vscode.TreeDataProvider<TypePackageItem | TypeFileItem> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TypePackageItem | TypeFileItem | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	constructor(private readonly manager: TypePackageManager) {}

	refresh() {
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	getTreeItem(element: TypePackageItem | TypeFileItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TypePackageItem | TypeFileItem): Promise<Array<TypePackageItem | TypeFileItem>> {
		if (element instanceof TypePackageItem) {
			return element.pkg.typeFiles.map((file) => new TypeFileItem(element.pkg, file));
		}

		if (element instanceof TypeFileItem) {
			return [];
		}

		const packages = await this.manager.listPackages();
		return packages.map((pkg) => new TypePackageItem(pkg));
	}
}

class TypePackageItem extends vscode.TreeItem {
	constructor(readonly pkg: TypePackage) {
		super(pkg.name, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${pkg.version}${pkg.bundled ? ' bundled' : ''}`;
		this.tooltip = pkg.location;
		this.contextValue = pkg.bundled ? 'bundledTypePackage' : 'managedTypePackage';
		this.iconPath = new vscode.ThemeIcon(pkg.bundled ? 'package' : 'archive');
	}
}

class TypeFileItem extends vscode.TreeItem {
	constructor(readonly pkg: TypePackage, readonly file: string) {
		super(path.basename(file), vscode.TreeItemCollapsibleState.None);
		this.description = path.dirname(path.relative(pkg.location, file));
		this.tooltip = file;
		this.contextValue = 'typeFile';
		this.iconPath = new vscode.ThemeIcon('symbol-file');
		this.command = {
			command: 'vscode.open',
			title: 'Open Declaration File',
			arguments: [vscode.Uri.file(file)],
		};
	}
}
