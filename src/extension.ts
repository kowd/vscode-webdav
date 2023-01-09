import Moment from 'moment';
import * as vscode from 'vscode';
import * as client from 'webdav';
import { FileStat } from 'webdav';

let outputChannel: vscode.OutputChannel;

function log(message: string) {
    outputChannel.appendLine(message)
}

function validationErrorsForUri(value:string):string {
    if (!value) {
        return 'Enter a WebDAV address'
    } else {
        try {
            let uri = vscode.Uri.parse(value.trim());
            if (!["http", "https", "webdav", "webdavs"].some(s => s == uri.scheme.toLowerCase())) {
                return `Unsupported protocol: ${uri.scheme}`;
            }
        } catch {
            return 'Enter a valid URI'
        }
    }
}

export async function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(
        outputChannel = vscode.window.createOutputChannel('WebDAV Workspace')
    );
    outputChannel.hide();
    log('Initializing WebDAV extension...');
    log(`Register provider for webdav scheme... `);

    try {
        for(let scheme of ['webdav', 'webdavs']) {
            context.subscriptions.push(
                vscode.workspace.registerFileSystemProvider(scheme, new WebDAVFileSystemProvider(), { isCaseSensitive: true })
            );
        }
    } catch (e) {
        log(`ERROR: ${e}`);
    }

    log(`Register extension.remote.webdav.open command... `);
    context.subscriptions.push(vscode.commands.registerCommand('extension.remote.webdav.open', async () => {
        const uriValue = await vscode.window.showInputBox({
            placeHolder: 'Enter a WebDAV address here ...',
            prompt: "Open remote WebDAV",
            validateInput: validationErrorsForUri
        });

        if(validationErrorsForUri(uriValue)) {
            return;
        }

        let webdavUri = uriValue.trim().replace(/^http/i, 'webdav',)

        let name = await vscode.window.showInputBox({
            placeHolder: 'Press ENTER to use default ...',
            prompt: "Custom name for Remote WebDAV"
        });

        vscode.workspace.updateWorkspaceFolders(
            0, 0,
            {
                uri: vscode.Uri.parse(webdavUri),
                name: name?.trim() ?? undefined,
            },
        );
    }))

    outputChannel.appendLine('Extension has been initialized.');
}

export function deactivate() { }

function normalizePath(p: string): string {
    return p.trim() || "/"
}

function toWebDAVPath(uri: vscode.Uri): string {
    return encodeURI(normalizePath(uri.path));
}

const connections = {}

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {

    private readonly _eventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

    public constructor() {

        this._eventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        this.onDidChangeFile = this._eventEmitter.event;
    }

    public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

    public async copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        return await this.forConnection("copy", source, async webdav => {
            return await webdav.copyFile(toWebDAVPath(source), toWebDAVPath(destination))
        })
    }

    public async createDirectory(uri: vscode.Uri): Promise<void> {
        return await this.forConnection("createDirectory", uri, async webdav => {
            return await webdav.createDirectory(toWebDAVPath(uri))
        })
    }

    public async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        return await this.forConnection("delete", uri, async webdav => {
            return await webdav.deleteFile(toWebDAVPath(uri))
        })
    }

    private async forConnection<T>(operation:string, uri: vscode.Uri, action: (webdav:client.WebDAVClient) => Promise<T>): Promise<T>
    {
        log(`${operation}: ${uri}`)
        try {
            let baseUri = vscode.Uri.parse(uri.toString().replace(/^webdav/i, "http")).with({path:"", fragment:"", query:""}).toString()
            if(!connections[baseUri]) {
                connections[baseUri] = client.createClient(baseUri);
            }
            return await action(connections[baseUri])
        } catch (e) {
            switch(e.status) {
                case 404: throw vscode.FileSystemError.FileNotFound(uri)
                case 403: throw vscode.FileSystemError.NoPermissions(uri)
            }
            throw e;
        }
    }
    
    public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        return await this.forConnection("readDirectory", uri, async webdav => {
            let results = await webdav.getDirectoryContents(toWebDAVPath(uri)) as client.FileStat[]
            return results.map(r => [r.basename, r.type == 'directory' ? vscode.FileType.Directory : vscode.FileType.File])
        })
    }

    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return await this.forConnection("readFile", uri, async webdav => {
            let body = await webdav.getFileContents(toWebDAVPath(uri))
            if (typeof body === "string") {
                return Buffer.from(body, 'binary')
            } else if (Buffer.isBuffer(body)) {
                return body
            } else {
                throw Error("TODO:")
            }
        })
    }

    public async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        return await this.forConnection("rename", oldUri, async webdav => {
            await webdav.moveFile(toWebDAVPath(oldUri), toWebDAVPath(newUri))
        })
    }

    public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return await this.forConnection("stat", uri, async webdav => {
            let props = await webdav.stat(toWebDAVPath(uri)) as FileStat
            return {
                ctime: Moment(props.lastmod).utc().unix(),
                mtime: Moment(props.lastmod).utc().unix(),
                size: props.size,
                type: props.type === 'file' ? vscode.FileType.File : vscode.FileType.Directory,
            };
        })
    }

    public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        return { dispose: () => { } };
    }

    public async writeFile(uri: vscode.Uri, content: Uint8Array, options: {create: boolean, overwrite: boolean}): Promise<void> {
        return await this.forConnection("stat", uri, async webdav => {
            await this.throwIfWriteFileIsNotAllowed(uri, options);
            await webdav.putFileContents(toWebDAVPath(uri), content, {overwrite: options.overwrite})
        })
    }

    protected async throwIfWriteFileIsNotAllowed(uri: vscode.Uri, options: {create: boolean, overwrite: boolean}) {
        try {
            let stat = await this.stat(uri);
            if (stat.type === vscode.FileType.Directory)
                throw vscode.FileSystemError.FileIsADirectory(uri);

            if (!options.overwrite)
                throw vscode.FileSystemError.FileExists(uri);
        } catch {
            if (!options.create)
                throw vscode.FileSystemError.FileNotFound(uri);
        }
    }
}