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

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {

    private readonly _eventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

    public constructor() {

        this._eventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        this.onDidChangeFile = this._eventEmitter.event;
    }

    public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

    public async copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        return await this.forConnection("copy", source, async webdav => {
            return await promisify<string, string, boolean>(webdav.copy).bind(webdav)(toWebDAVPath(source), toWebDAVPath(destination), options.overwrite)
        })
    }

    public async createDirectory(uri: vscode.Uri): Promise<void> {
        return await this.forConnection("createDirectory", uri, async webdav => {
            let path = toWebDAVPath(uri)
            return await promisify(webdav.mkdir).bind(webdav)(path)
        })
    }

    public async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        return await this.forConnection("delete", uri, async webdav => {
            return await promisify(webdav.delete).bind(webdav)(toWebDAVPath(uri))
        })
    }

    private async forConnection<T>(operation:string, uri: vscode.Uri, action: (webdav:WebDAV.Connection) => Promise<T>): Promise<T>
    {
        log(`${operation}: ${uri}`)
        try {
            let baseUri = vscode.Uri.parse(uri.toString().replace(/^webdav/i, "http")).with({path:"", fragment:"", query:""}).toString()
            let webdav = new WebDAV.Connection(baseUri);
            return await action(webdav)
        } catch (e) {
            switch(e.statusCode) {
                case 404: throw vscode.FileSystemError.FileNotFound(uri)
                case 403: throw vscode.FileSystemError.NoPermissions(uri)
            }
            throw e;
        }
    }
    
    public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        return await this.forConnection("readDirectory", uri, async webdav => {
            let options: ConnectionReaddirOptions = { extraProperties: [], properties: true }
            let readdir = promisify<string, ConnectionReaddirOptions, string[] | ConnectionReaddirComplexResult[]>(webdav.readdir).bind(webdav)

            // We know the result is a ConnectionReaddirComplexResult because of properties: true above.
            let path = toWebDAVPath(uri)
            let results = await readdir(path, options) as ConnectionReaddirComplexResult[]

            return results.map(r => [r.name, r.isDirectory ? vscode.FileType.Directory : vscode.FileType.File])
        })
    }

    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return await this.forConnection("readFile", uri, async webdav => {
            let body = await promisify<string, ContentType>(webdav.get).bind(webdav)(toWebDAVPath(uri))
            if (typeof body === "string") {
                return Buffer.from(body, 'binary')
            }
            return body
        })
    }

    public async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        return await this.forConnection("rename", oldUri, async webdav => {
            let move = promisify<string, string, boolean>(webdav.move).bind(webdav)
            await move(toWebDAVPath(oldUri), toWebDAVPath(newUri), options.overwrite)
        })
    }

    public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return await this.forConnection("stat", uri, async webdav => {
            let result = await promisify<string, Properties>(webdav.getProperties).bind(webdav)(toWebDAVPath(uri))
            let props = {}
            for(let key in result) {
                // This is terrible, potentially implementations can exclude the namespace ? 
                props[key.split(":")[1].toLowerCase()] = result[key] 
            }

            return {
                ctime: Moment(props['creationdate'] as string).utc().unix(),
                mtime: Moment(props['getlastmodified'] as string).utc().unix(),
                size: parseInt(props['getcontentlength'] as string || '0'),
                type: ((props['resourcetype'] || {}).content as { name: string }[] || []).findIndex(x => x.name && x.name.endsWith(':collection')) == -1 ? vscode.FileType.File : vscode.FileType.Directory,
            };
        })
    }

    public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        return { dispose: () => { } };
    }

    public async writeFile(uri: vscode.Uri, content: Uint8Array, options: {create: boolean, overwrite: boolean}): Promise<void> {
        return await this.forConnection("stat", uri, async webdav => {
            await this.throwIfWriteFileIsNotAllowed(uri, options);

            let put = promisify<string, ContentType, void>(webdav.put).bind(webdav)
            let payload: ContentType = Buffer.from(content)
            await put(toWebDAVPath(uri), payload)
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