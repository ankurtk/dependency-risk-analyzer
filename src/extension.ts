import * as vscode from 'vscode';
import { DependencyViewProvider } from './DependencyViewProvider';

export function activate(context: vscode.ExtensionContext) {

  const provider = new DependencyViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "dependencyListView",
      provider
    )
  );
}

export function deactivate() {}