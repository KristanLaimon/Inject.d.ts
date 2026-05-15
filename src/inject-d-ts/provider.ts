import * as vscode from 'vscode';

import type { TypePackageManager } from './type-package-manager';
import { TypeFileItem, TypePackageItem } from './tree-items';

export class TypePackagesProvider implements vscode.TreeDataProvider<TypePackageItem | TypeFileItem> {
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
			return [
				...element.pkg.dependencies.map((dependency) => new TypePackageItem(dependency)),
				...element.pkg.typeFiles.map((file) => new TypeFileItem(element.pkg, file)),
			];
		}

		if (element instanceof TypeFileItem) {
			return [];
		}

		const packages = await this.manager.listPackages();
		return packages.map((pkg) => new TypePackageItem(pkg));
	}
}
