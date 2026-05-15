import * as vscode from 'vscode';

import { EXTENSION_ID } from './inject-d-ts/constants';
import { TypePackagesProvider } from './inject-d-ts/provider';
import { TypePackageManager } from './inject-d-ts/type-package-manager';
import { TypePackageItem } from './inject-d-ts/tree-items';

let activeExtension: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
	if (activeExtension) {
		context.subscriptions.push(activeExtension);
		return;
	}

	const disposables: vscode.Disposable[] = [];
	activeExtension = new vscode.Disposable(() => {
		while (disposables.length > 0) {
			disposables.pop()?.dispose();
		}
	});
	context.subscriptions.push(activeExtension);

	const manager = new TypePackageManager(context);
	const provider = new TypePackagesProvider(manager);
	const treeView = createTreeView('inject-d-ts.packages', {
		treeDataProvider: provider,
	});
	if (treeView) {
		disposables.push(treeView);
	}
	const withLoadingMessage = async (action: () => Promise<void>) => {
		if (treeView) {
			treeView.message = 'Loading inject.d.ts types...';
		}
		try {
			await action();
		} finally {
			if (treeView) {
				treeView.message = undefined;
			}
		}
	};

	disposables.push(
		registerCommand('inject-d-ts.refresh', async () => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Refresh global types', async () => manager.refreshTypeManifest({ restartTsServer: true }));
			});
			provider.refresh();
		}),
		registerCommand('inject-d-ts.downloadPackage', async () => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Download types package', async () => manager.downloadPackage());
			});
			provider.refresh();
		}),
		registerCommand('inject-d-ts.editPackage', async (item?: TypePackageItem) => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Edit types package', async () => manager.editPackage(item?.pkg));
			});
			provider.refresh();
		}),
		registerCommand('inject-d-ts.deletePackage', async (item?: TypePackageItem) => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Delete types package', async () => manager.deletePackage(item?.pkg));
			});
			provider.refresh();
		}),
		registerCommand('inject-d-ts.openStorage', async () => {
			await manager.runCommand('Open types storage', async () => manager.openStorage());
		}),
	);

	void withLoadingMessage(async () => {
		await manager.runCommand('Activate Inject.d.ts', async () => manager.activate());
		provider.refresh();
	});
}

export function deactivate() {
	activeExtension?.dispose();
	activeExtension = undefined;
}

function createTreeView<T>(viewId: string, options: vscode.TreeViewOptions<T>): vscode.TreeView<T> | undefined {
	try {
		return vscode.window.createTreeView(viewId, options);
	} catch (error) {
		if (String(error).includes('Cannot register multiple views with same id')) {
			return undefined;
		}
		throw error;
	}
}

function registerCommand(command: string, callback: (...args: never[]) => unknown): vscode.Disposable {
	try {
		return vscode.commands.registerCommand(command, callback);
	} catch (error) {
		if (String(error).includes(`command '${command}' already exists`)) {
			return new vscode.Disposable(() => {});
		}
		throw error;
	}
}
