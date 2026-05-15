import * as vscode from 'vscode';

import { EXTENSION_ID } from './inject-d-ts/constants';
import { TypePackagesProvider } from './inject-d-ts/provider';
import { TypePackageManager } from './inject-d-ts/type-package-manager';
import { TypePackageItem } from './inject-d-ts/tree-items';

export function activate(context: vscode.ExtensionContext) {
	const manager = new TypePackageManager(context);
	const provider = new TypePackagesProvider(manager);
	const treeView = vscode.window.createTreeView('inject-d-ts.packages', {
		treeDataProvider: provider,
	});
	const withLoadingMessage = async (action: () => Promise<void>) => {
		treeView.message = 'Loading inject.d.ts types...';
		try {
			await action();
		} finally {
			treeView.message = undefined;
		}
	};

	context.subscriptions.push(
		treeView,
		vscode.commands.registerCommand('inject-d-ts.refresh', async () => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Refresh global types', async () => manager.refreshTypeManifest());
			});
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.downloadPackage', async () => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Download types package', async () => manager.downloadPackage());
			});
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.editPackage', async (item?: TypePackageItem) => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Edit types package', async () => manager.editPackage(item?.pkg));
			});
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.deletePackage', async (item?: TypePackageItem) => {
			await withLoadingMessage(async () => {
				await manager.runCommand('Delete types package', async () => manager.deletePackage(item?.pkg));
			});
			provider.refresh();
		}),
		vscode.commands.registerCommand('inject-d-ts.openStorage', async () => {
			await manager.runCommand('Open types storage', async () => manager.openStorage());
		}),
	);

	void withLoadingMessage(async () => {
		await manager.runCommand('Activate Inject.d.ts', async () => manager.activate());
		provider.refresh();
	});
}

export function deactivate() {}
