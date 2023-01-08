'use strict';

import Moment from 'moment';
import * as vscode from 'vscode';
import * as WebDAV from 'webdav-client';
import { promisify } from 'util';
import { ConnectionReaddirComplexResult, ConnectionReaddirOptions, ContentType, Properties } from 'webdav-client';

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
            password: false,
            placeHolder: 'Enter a WebDAV address here ...',
            prompt: "Open remote WebDAV",
            validateInput: validationErrorsForUri
        });

        if(validationErrorsForUri(uriValue)) {
            return;
        }

        let webdavUri = uriValue.trim().replace(/^http/i, 'webdav',)

        let name = await vscode.window.showInputBox({
            password: false,
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
        return await promisify<string, string, boolean>(webdav.copy).bind(webdav)(toWebDAVPath(source), toWebDAVPath(destination), options.overwrite)
    }

    public async createDirectory(uri: vscode.Uri): Promise<void> {
        let webdav = await this.openConnection(uri)
        let path = toWebDAVPath(uri)
        return await promisify(webdav.mkdir).bind(webdav)(path)
    }

    public async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        let webdav = await this.openConnection(uri)
        let path = toWebDAVPath(uri)
        return await promisify(webdav.delete).bind(webdav)(path)
    }

    private async openConnection(uri: vscode.Uri): Promise<WebDAV.Connection> {
        let baseUri = vscode.Uri.parse(uri.toString().replace(/^webdav/i, "http")).with({path:"", fragment:""}).toString()
        log(`Open connection: ${baseUri}`)
        return new WebDAV.Connection(baseUri);
    }

    public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        log(`readDirectory: ${uri}`)
        let webdav = await this.openConnection(uri)
        let options: ConnectionReaddirOptions = { extraProperties: [], properties: true }
        let readdir = promisify<string, ConnectionReaddirOptions, string[] | ConnectionReaddirComplexResult[]>(webdav.readdir).bind(webdav)

        // We know the result is a ConnectionReaddirComplexResult because of properties: true above.
        let path = toWebDAVPath(uri)
        let results = await readdir(path, options) as ConnectionReaddirComplexResult[]

        results.shift()

        return results.map(r => [r.name, r.isDirectory ? vscode.FileType.Directory : vscode.FileType.File])
    }

    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        let webdav = await this.openConnection(uri)
        let body = await promisify<string, ContentType>(webdav.get).bind(webdav)(toWebDAVPath(uri))
        if (typeof body === "string") {
            return Buffer.from(body, 'utf8')
        }
        return body
    }

    public async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        let webdav = await this.openConnection(oldUri)
        let move = promisify<string, string, boolean>(webdav.move).bind(webdav)
        await move(toWebDAVPath(oldUri), toWebDAVPath(newUri), options.overwrite)
    }

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
        let props = await promisify<string, Properties>(webdav.getProperties).bind(webdav)(toWebDAVPath(uri))

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

        let put = promisify<string, ContentType, void>(webdav.put).bind(webdav)
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