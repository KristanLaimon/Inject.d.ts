import * as fs from 'fs';

type LanguageServiceInfo = {
	config: unknown;
	languageService: unknown;
	languageServiceHost?: LanguageServiceHost;
};

type PluginConfiguration = {
	manifestPath?: string;
};

type Manifest = {
	files?: string[];
};

type LanguageServiceHost = {
	getScriptFileNames?: () => string[];
};

let configuredManifestPath: string | undefined;

function init() {
	return {
		create(info: LanguageServiceInfo) {
			configuredManifestPath = readManifestPath(info.config);
			injectManifestFiles(info.languageServiceHost);
			return info.languageService;
		},
		onConfigurationChanged(configuration: PluginConfiguration) {
			configuredManifestPath = readManifestPath(configuration);
		},
		getExternalFiles() {
			return readManifestFiles(configuredManifestPath);
		},
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
	if (!manifestPath || !fs.existsSync(manifestPath)) {
		return [];
	}

	try {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
		if (!Array.isArray(manifest.files)) {
			return [];
		}

		return manifest.files.filter((file): file is string => typeof file === 'string' && fs.existsSync(file));
	} catch {
		return [];
	}
}

function unique(files: string[]): string[] {
	return [...new Set(files)];
}

export = init;
