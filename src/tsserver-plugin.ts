import * as fs from 'fs';
import * as path from 'path';

type LanguageServiceInfo = {
	config: unknown;
	languageService: unknown;
	languageServiceHost?: LanguageServiceHost;
	project?: {
		refreshDiagnostics?: () => void;
		projectService?: {
			applyChangesInOpenFiles?: (
				openFiles: unknown[],
				changedFiles: unknown[],
				closedFiles: unknown[],
			) => void;
		};
	};
};

type PluginConfiguration = {
	manifestPath?: string;
};

type Manifest = {
	files?: string[];
	typeRoots?: string[];
	types?: string[];
};

type LanguageServiceHost = {
	getCompilationSettings?: () => CompilerOptions;
	getCurrentDirectory?: () => string;
	getScriptFileNames?: () => string[];
};

let configuredManifestPath: string | undefined;

type CompilerOptions = {
	typeRoots?: string[];
	types?: string[];
	[key: string]: unknown;
};

function init() {
	let project: LanguageServiceInfo['project'];

	return {
		create(info: LanguageServiceInfo) {
			project = info.project;
			configuredManifestPath = readManifestPath(info.config);
			injectCompilationSettings(info.languageServiceHost);
			injectManifestFiles(info.languageServiceHost);
			return info.languageService;
		},
		onConfigurationChanged(configuration: PluginConfiguration) {
			configuredManifestPath = readManifestPath(configuration);
			project?.projectService?.applyChangesInOpenFiles?.([], [], []);
			project?.refreshDiagnostics?.();
		},
		getExternalFiles() {
			return readManifestFiles(configuredManifestPath);
		},
	};
}

function injectCompilationSettings(host: LanguageServiceHost | undefined) {
	if (!host?.getCompilationSettings) {
		return;
	}

	const getCompilationSettings = host.getCompilationSettings.bind(host);
	host.getCompilationSettings = () => {
		const settings = getCompilationSettings();
		const manifest = readManifest(configuredManifestPath);
		const manifestTypeRoots = filterExistingDirectories(manifest.typeRoots);
		const manifestTypes = filterStrings(manifest.types);
		if (manifestTypeRoots.length === 0 && manifestTypes.length === 0) {
			return settings;
		}

		const nextSettings = { ...settings };
		if (manifestTypeRoots.length > 0) {
			const existingTypeRoots = settings.typeRoots ?? defaultTypeRoots(host.getCurrentDirectory?.());
			nextSettings.typeRoots = unique([...existingTypeRoots, ...manifestTypeRoots]);
		}
		if (manifestTypes.length > 0) {
			nextSettings.types = unique([...(settings.types ?? []), ...manifestTypes]);
		}

		return nextSettings;
	};
}

function injectManifestFiles(host: LanguageServiceHost | undefined) {
	if (!host?.getScriptFileNames) {
		return;
	}

	const getScriptFileNames = host.getScriptFileNames.bind(host);
	host.getScriptFileNames = () => unique([...getScriptFileNames(), ...readManifestFiles(configuredManifestPath)]);
}

function readManifestPath(configuration: unknown): string | undefined {
	if (!configuration || typeof configuration !== 'object') {
		return undefined;
	}

	const manifestPath = (configuration as PluginConfiguration).manifestPath;
	return typeof manifestPath === 'string' && manifestPath.length > 0 ? manifestPath : undefined;
}

function readManifestFiles(manifestPath: string | undefined): string[] {
	return filterExistingFiles(readManifest(manifestPath).files);
}

function readManifest(manifestPath: string | undefined): Manifest {
	if (!manifestPath || !fs.existsSync(manifestPath)) {
		return {};
	}

	try {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
		return manifest && typeof manifest === 'object' ? manifest : {};
	} catch {
		return {};
	}
}

function filterExistingFiles(files: unknown): string[] {
	return filterStrings(files).filter((file) => fs.existsSync(file));
}

function filterExistingDirectories(directories: unknown): string[] {
	return filterStrings(directories).filter((directory) => fs.existsSync(directory) && fs.statSync(directory).isDirectory());
}

function filterStrings(values: unknown): string[] {
	return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
}

function defaultTypeRoots(currentDirectory: string | undefined): string[] {
	if (!currentDirectory) {
		return [];
	}

	const roots: string[] = [];
	let directory = currentDirectory;
	while (true) {
		const typeRoot = path.join(directory, 'node_modules', '@types');
		if (fs.existsSync(typeRoot) && fs.statSync(typeRoot).isDirectory()) {
			roots.push(typeRoot);
		}

		const parent = path.dirname(directory);
		if (parent === directory) {
			break;
		}
		directory = parent;
	}

	return roots;
}

function unique(files: string[]): string[] {
	return [...new Set(files)];
}

export = init;
