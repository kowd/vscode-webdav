'use strict';

import Moment from 'moment';
import * as vscode from 'vscode';
import * as WebDAV from 'webdav-client';
import { promisify } from 'util';
import { ConnectionReaddirComplexResult, ConnectionReaddirOptions, ContentType, Properties } from 'webdav-client';

let outputChannel: vscode.OutputChannel;
function validationErrorsForUri(value:string):string {
    if (!value) {
        return 'Enter a WebDAV address'
    } else {
        try {
            let uri = vscode.Uri.parse(value.trim());
            if (!isSchemeSupported(uri)) {
                return `Unsupported protocol '${uri.scheme}'!`;
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
    outputChannel.appendLine('Initializing WebDAV extension...');
    outputChannel.appendLine(`Register provider for webdav scheme... `);

    try {
        let provider = new WebDAVFileSystemProvider();
        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(WebDAVFileSystemProvider.scheme, provider, { isCaseSensitive: true })
        );

    } catch (e) {
        outputChannel.appendLine(`ERROR: ${e}`);
    }

    outputChannel.appendLine(`Register extension.remote.webdav.open command... `);
    context.subscriptions.push(vscode.commands.registerCommand('extension.remote.webdav.open', async () => {
        const uriValue = await vscode.window.showInputBox({
            password: false,
            placeHolder: 'Enter a WebDAV address here ...',
            prompt: "Open remote WebDAV",
            validateInput: validationErrorsForUri
        });

        if(validationErrorsForUri(uriValue)) {
            return;
        }

        const uri = vscode.Uri.parse(uriValue);
        let name = await vscode.window.showInputBox({
            password: false,
            placeHolder: 'Press ENTER to use default ...',
            prompt: "Custom name for Remote WebDAV"
        });

        vscode.workspace.updateWorkspaceFolders(
            0, 0,
            {
                uri: uri,
                name: name?.trim() ?? undefined,
            },
        );
    }))

    outputChannel.appendLine('Extension has been initialized.');
}

export function deactivate() { }

function isSchemeSupported(uri: vscode.Uri): boolean {
    return uri && uri.scheme.toLowerCase() == "webdav"
}

function normalizePath(p: string): string {
    return p.trim() || "/"
}

function toWebDAVPath(uri: vscode.Uri): string {
    return encodeURI(normalizePath(uri.path));
}

export type DirectoryEntry = [string, vscode.FileType];

export interface WriteFileOptions {
    create: boolean;
    overwrite: boolean;
}

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {

    private readonly _eventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

    public constructor() {

        this._eventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        this.onDidChangeFile = this._eventEmitter.event;
    }

    public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

    public async copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        let webdav = await this.openConnection(source)
        return await promisify<string, string, boolean>(webdav.copy)(toWebDAVPath(source), toWebDAVPath(destination), options.overwrite)
    }

    public async createDirectory(uri: vscode.Uri): Promise<void> {
        let webdav = await this.openConnection(uri)
        let path = toWebDAVPath(uri)
        return await promisify(webdav.mkdir)(path)
    }

    public async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        let webdav = await this.openConnection(uri)
        let path = toWebDAVPath(uri)
        return await promisify(webdav.delete)(path)
    }

    private async openConnection(uri: vscode.Uri): Promise<WebDAV.Connection> {
        return new WebDAV.Connection(uri.toString());
    }

    public async readDirectory(uri: vscode.Uri): Promise<DirectoryEntry[]> {
        let webdav = await this.openConnection(uri)
        let options: ConnectionReaddirOptions = { extraProperties: [], properties: true }
        let readdir = promisify<string, ConnectionReaddirOptions, string[] | ConnectionReaddirComplexResult[]>(webdav.readdir)

        // We know the result is a ConnectionReaddirComplexResult because of properties: true above.
        let results = await readdir(toWebDAVPath(uri), options) as ConnectionReaddirComplexResult[]

        results.shift()

        return results.map(r => [r.name, r.isDirectory ? vscode.FileType.Directory : vscode.FileType.File])
    }

    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        let webdav = await this.openConnection(uri)
        let body = await promisify<string, ContentType>(webdav.get)(toWebDAVPath(uri))
        if (typeof body === "string") {
            return Buffer.from(body, 'utf8')
        }
        return body
    }

    public async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        let webdav = await this.openConnection(oldUri)
        let move = promisify<string, string, boolean>(webdav.move)
        await move(toWebDAVPath(oldUri), toWebDAVPath(newUri), options.overwrite)
    }

    public static readonly scheme = 'webdav';

    public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        if ('/' === normalizePath(uri.path)) {
            return {
                type: vscode.FileType.Directory,
                ctime: 0,
                mtime: 0,
                size: 0,
            };
        }

        let webdav = await this.openConnection(uri)
        let props = await promisify<string, Properties>(webdav.getProperties)(toWebDAVPath(uri))

        return {
            ctime: Moment(props['dav:creationdate'] as string).utc().unix(),
            mtime: Moment(props['dav:getlastmodified'] as string).utc().unix(),
            size: parseInt(props['dav:getcontentlength'] as string || '0'),
            type: ((props['dav:resourcetype'] || {}).content as { name: string }[] || []).findIndex(x => x.name == 'dav:collection') == -1 ? vscode.FileType.File : vscode.FileType.Directory,
        };
    }

    public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        return { dispose: () => { } };
    }

    public async writeFile(uri: vscode.Uri, content: Uint8Array, options: WriteFileOptions): Promise<void> {
        let webdav = await this.openConnection(uri)
        await this.throwIfWriteFileIsNotAllowed(uri, options);

        let put = promisify<string, ContentType, void>(webdav.put)
        let payload: ContentType = Buffer.from(content)
        await put(toWebDAVPath(uri), payload)
    }

    protected async throwIfWriteFileIsNotAllowed(uri: vscode.Uri, options: WriteFileOptions) {
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