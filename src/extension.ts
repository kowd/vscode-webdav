import * as vscode from 'vscode';
import * as client from 'webdav';
import { FileStat } from 'webdav';
import { parse } from 'date-fns'

let outputChannel: vscode.OutputChannel;
const log = (message: string): void => outputChannel.appendLine(message)

function validationErrorsForUri(value:string): string | undefined {
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

    secrets = context.secrets
    state = context.globalState

    try {
        for(let scheme of ['webdav', 'webdavs']) {
            context.subscriptions.push(
                vscode.workspace.registerFileSystemProvider(scheme, new WebDAVFileSystemProvider(), { isCaseSensitive: true })
            );
        }
    } catch (e) {
        log(`ERROR: ${e}`);
    }

    log(`Register extension.remote.webdav.resetAuth command... `);
    context.subscriptions.push(vscode.commands.registerCommand('extension.remote.webdav.resetAuth', async () => {
        let uris = (vscode.workspace.workspaceFolders || []).map(f => f.uri.toString()).filter(u => u.startsWith("webdav"))
        if(uris) {
            let uri = uris.length == 1 ? uris[0] : await vscode.window.showQuickPick(uris, {placeHolder: "Which WebDAV to Authenticate to?"})
            if(uri) {
                await configureAuthForUri(toBaseUri(vscode.Uri.parse(uri)))
            }
        } else {
            vscode.window.showInformationMessage("No WebDAVs folders can be found in the current Workspace")
        }
    }))

    log(`Register extension.remote.webdav.open command... `);
    context.subscriptions.push(vscode.commands.registerCommand('extension.remote.webdav.open', async () => {
        const uriValue = await vscode.window.showInputBox({
            placeHolder: 'Enter a WebDAV address here ...',
            prompt: "Open remote WebDAV",
            validateInput: validationErrorsForUri
        });

        if(!uriValue || validationErrorsForUri(uriValue)) {
            return;
        }

        let webdavUri = vscode.Uri.parse(uriValue.trim().replace(/^http/i, 'webdav'))

        let name = await vscode.window.showInputBox({
            placeHolder: 'Press ENTER to use default ...',
            value: webdavUri.authority,
            prompt: "Custom name for Remote WebDAV"
        });

        await configureAuthForUri(toBaseUri(webdavUri))

        vscode.workspace.updateWorkspaceFolders(
            0, 0,
            {
                uri: webdavUri,
                name: name?.trim() ?? webdavUri.authority,
            },
        );
    }))

    outputChannel.appendLine('Extension has been initialized.');
}

export function deactivate() { }

const toWebDAVPath = (uri: vscode.Uri): string => 
    uri.path?.trim() || "/"

const toBaseUri = (uri: vscode.Uri): string => 
    vscode.Uri.parse(uri.toString().replace(/^webdav/i, "http")).with({path:"", fragment:"", query:""}).toString()

const keyFromUri = (uriKey:string): string => `webdav.auth.${uriKey}`

type AuthType = "None" | "Basic" | "Digest" | "Kerberos";
interface AuthSettings {
    auth?: AuthType,
    user?: string,
}

let secrets: vscode.SecretStorage
let state: vscode.Memento

async function configureAuthForUri(uriKey: string): Promise<void> {
    delete connections[uriKey] // The conections are keyed on the baseUri
    let key = keyFromUri(uriKey)
    let settings: AuthSettings = { auth: await vscode.window.showQuickPick(["None", "Basic", "Digest", "Kerberos"], {placeHolder: `Choose authentication for ${uriKey}`}) as AuthType }
    if (settings.auth === "Basic" || settings.auth === "Digest") {
        settings.user = await vscode.window.showInputBox({prompt: "Username", placeHolder: `Username for login to ${uriKey}`})
        let pass = await vscode.window.showInputBox({prompt: "Password", password: true, placeHolder: `Password for ${settings.user}`}) || ""
        await secrets.store(key, pass)
    }
    await state.update(key, settings)
}

const connections: {[key: string]: Promise<client.WebDAVClient>} = {}

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

    private async createClient(baseUri: string): Promise<client.WebDAVClient> {
        let key = keyFromUri(baseUri)
        let options: client.WebDAVClientOptions = {}
        let settings = state.get<AuthSettings>(key, {})
        if(settings.auth === "Basic" || settings.auth === "Digest") {
            let password = await secrets.get(key)
            options = {
                authType: settings.auth === "Basic" ? client.AuthType.Password : client.AuthType.Digest, 
                username: settings.user, 
                password: password
            }
        } else if (settings.auth === "Kerberos") {
            options = {withCredentials: true}
        }
        return client.createClient(baseUri, options);
    }

    private async forConnection<T>(operation:string, uri: vscode.Uri, action: (webdav:client.WebDAVClient) => Promise<T>): Promise<T>
    {
        log(`${operation}: ${uri}`)
        let baseUri = toBaseUri(uri)
        try {
            if(!connections[baseUri]) {
                connections[baseUri] = this.createClient(baseUri)
            }
            return await action(await connections[baseUri])
        } catch (e) {
            log(`${e} for ${uri}`)
            switch((e as client.WebDAVClientError).status) {
                case 401: 
                    let message = await vscode.window.showWarningMessage(`Authentication failed for ${uri.authority}.`, "Authenticate") 
                    if(message === "Authenticate") {
                        await configureAuthForUri(baseUri)
                    }
                    throw vscode.FileSystemError.NoPermissions(uri)
                case 403:
                    throw vscode.FileSystemError.NoPermissions(uri)
                case 404: 
                    throw vscode.FileSystemError.FileNotFound(uri)
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
                throw Error("Not Implemented")
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
            let created = parse(props.lastmod, "iii, dd MM y HH:mm:ss", new Date()).getTime() // Sun, 06 Nov 1994 08:49:37 GMT
            return {
                ctime: created,
                mtime: created,
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