// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

type Disposable = {
	dispose(): any;
};

const SELECTED_CHAR = '✓';
export function activate(context: vscode.ExtensionContext) {
	const gitExt = vscode.extensions.getExtension('vscode.git');

	if (!gitExt) {
		vscode.window.showErrorMessage('Git extension not found!');
		return;
	}

	if (!gitExt.exports.getRepositories) {
		vscode.window.showErrorMessage('Git extension API incompatible');
		return;
	}

	const authoring = new CoAuthoring(gitExt.exports);
	context.subscriptions.push(authoring);
}


class Repo {
	private path: string = "";
	private previousCoAuthor: string = "";
	private inputBox: vscode.SourceControlInputBox;

	constructor(path: string, input: vscode.SourceControlInputBox) {
		this.inputBox = input;
	}

	getPath() {
		return this.path;
	}

	addCoauthorString(value: string) {
		this.inputBox.value = this.inputBox.value.replace(this.previousCoAuthor, '');
		this.previousCoAuthor = `\n\n${value}`;
		this.inputBox.value = `${this.inputBox.value}${this.previousCoAuthor}`;
	}
}
// this method is called when your extension is deactivated
export function deactivate() { }

class CoAuthoring {
	private gitApi: any;

	private disposables: Disposable[] = [];
	private pairingSet: Set<string> = new Set();
	private repos: Map<string, Repo> = new Map();
	private currentRepo: string | undefined;
	private coAuthors: string[] = [];
	private CO_AUTHOR_FILE_NAME = ".git_coauthors";
	constructor(gitApi: any) {
		this.gitApi = gitApi;
		this.readOrCreateCoAuthorFile();

		const addBuddy = vscode.commands.registerCommand('coauthor.addBuddy', this.addBuddy, this);
		const appendPairing = vscode.commands.registerCommand('coauthor.appendPairing', this.appendPairing, this);
		const stopPairing = vscode.commands.registerCommand('coauthor.stopPairing', this.stopPairing, this);
		let showCoAuthors = vscode.commands.registerCommand('coauthor.editCoAuthors', () => {
			const path = require('path');
			const os = require('os');
			const filePath = path.join(os.homedir(), this.CO_AUTHOR_FILE_NAME);

			const openPath = vscode.Uri.file(filePath);
			vscode.workspace.openTextDocument(openPath).then(doc => {
				vscode.window.showTextDocument(doc);
			});
			vscode.window.showInformationMessage('Hello World from co-author!');
		});


		this.disposables.push(showCoAuthors);
		this.disposables.push(addBuddy);
		this.disposables.push(stopPairing);
		this.disposables.push(appendPairing);
	}

	public readOrCreateCoAuthorFile() {
		const path = require('path');
		const fs = require('fs');
		const os = require('os');
		const filePath = path.join(os.homedir(), this.CO_AUTHOR_FILE_NAME);
		try {
			this.coAuthors = fs.readFileSync(filePath, 'utf8').split("\n");
		} catch (e) {
			fs.writeFileSync(filePath, 'name <name@email.com>');
			this.coAuthors = [];
		}
	}
	public async addBuddy() {
		if (this.repos.size === 0) {
			await this._getRepos();
		}
		await this.pickRepoIfRequired();

		this._getBuddies();
	}
	private async _getBuddies() {
		if (this.currentRepo === undefined) {
			return;
		}
		this.readOrCreateCoAuthorFile();
		this._pickBuddy(this.coAuthors);
	}
	public async appendPairing() {
		if (this.pairingSet.size === 0) {
			vscode.window.showErrorMessage('No pairing buddies selected.');
			return;
		}

		await this.pickRepoIfRequired();

		if (this.currentRepo !== undefined) {
			const repo = this.repos.get(this.currentRepo);
			repo && repo.addCoauthorString(this.getPairingString());
		}
	}

	private async pickRepoIfRequired() {
		if (this.currentRepo === undefined) {
			await this.pickRepo();
		}
	}

	public stopPairing() {
		this.pairingSet.clear();
		this.currentRepo = undefined;
	}

	public selectRepo() {
		if (this.repos.size > 0) {
			this.pickRepo();
		}
	}

	public toggleBuddy(partner: string) {
		if (this.pairingSet.has(partner)) {
			this.pairingSet.delete(partner);
		} else {
			this.pairingSet.add(partner);
		}
	}

	public getPairingString() {
		return [...this.pairingSet.values()]
			.map(buddy => `Co-authored-by: ${buddy}`)
			.join('\n');
	}

	public dispose() {
		this.disposables.forEach(e => e.dispose());
	}

	private async _pickBuddy(candidates: string[]) {
		if (candidates.length === 0) {
			return;
		}

		const users = candidates
			// selected one first
			.sort((a, b) => {
				if (this.pairingSet.has(a)) {
					return -1;
				}

				if (this.pairingSet.has(b)) {
					return 1;
				}

				return 0;
			})
			.map((candidate, index) => {
				if (this.pairingSet.has(candidate)) {
					return `${SELECTED_CHAR}${candidate}`;
				} else {
					return candidate;
				}
			});

		let who = await vscode.window.showQuickPick(users, {
			placeHolder: 'Add/remove pairing buddies'
		});

		if (who !== undefined) {
			if (who.indexOf(SELECTED_CHAR) === 0) {
				who = who.substr(1);
			}
			this.toggleBuddy(who);
		}
	}

	private _addRepo(path: string, input: vscode.SourceControlInputBox) {
		if (this.repos.has(path)) {
			return;
		}

		const newRepo = new Repo(path, input);
		this.repos.set(path, newRepo);
	}


	private async pickRepo() {
		await this._getRepos();
		const repos = [...this.repos.entries()];

		if (repos.length === 0) {
			return;
		}

		if (repos.length > 1) {
			this.currentRepo = await vscode.window.showQuickPick(
				repos
					.map(([value, repo]: [string, Repo]) => value),
				{
					placeHolder: 'Pick a repository / submodule'
				}
			);
		} else {
			this.currentRepo = repos[0][0];
		}
	}

	private async _getRepos() {
		const repos = await this.gitApi.getRepositories();

		if (repos.length === 0) {
			vscode.window.showErrorMessage('No repositories found.');
			return;
		}

		// Add all repos, will update collection only if not present
		repos.forEach((repo: any) => {
			this._addRepo(repo.rootUri.fsPath, repo.inputBox);
		});
	}
}
