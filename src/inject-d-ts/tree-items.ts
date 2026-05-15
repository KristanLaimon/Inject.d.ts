import * as path from 'path';
import * as vscode from 'vscode';

import type { TypePackage } from './types';

export class TypePackageItem extends vscode.TreeItem {
	constructor(readonly pkg: TypePackage) {
		super(pkg.name, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${pkg.version}${pkg.bundled ? ' bundled' : ''}`;
		this.tooltip = pkg.location;
		this.contextValue = pkg.bundled ? 'bundledTypePackage' : 'managedTypePackage';
		this.iconPath = new vscode.ThemeIcon(pkg.bundled ? 'package' : 'archive');
	}
}

export class TypeFileItem extends vscode.TreeItem {
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
