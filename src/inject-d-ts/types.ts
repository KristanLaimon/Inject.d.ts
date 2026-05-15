export type TypePackage = {
	name: string;
	version: string;
	location: string;
	typeFiles: string[];
	dependencies: TypePackage[];
	bundled: boolean;
	dependency: boolean;
};

export type Manifest = {
	version: 1;
	generatedAt: string;
	files: string[];
	typeRoots: string[];
	types: string[];
};

export type DisabledBundledPackages = {
	version: 1;
	names: string[];
};

export type PackageSpec = {
	name: string;
	selector: string;
};

export type RegistryPackument = {
	'dist-tags'?: Record<string, string>;
	versions?: Record<string, RegistryManifest>;
};

export type RegistryManifest = {
	name: string;
	version: string;
	dependencies?: Record<string, string>;
	dist?: {
		tarball?: string;
	};
};
