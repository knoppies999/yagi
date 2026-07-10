import * as vscode from "vscode";
import { YagiPanel } from "./yagiPanel";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("yagi.open", () => {
      YagiPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand("yagi.refresh", () => {
      YagiPanel.current?.refresh();
    })
  );
}

export function deactivate() {}
