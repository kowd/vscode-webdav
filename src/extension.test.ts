/* eslint-disable @typescript-eslint/naming-convention*/
import {describe, expect, test} from '@jest/globals';
import * as vscode from 'vscode';

let parse = jest.fn();
let registerFSP = jest.fn();
let registerC = jest.fn();
let workspaceFolders: {uri:string}[] = [];
let showInfo = jest.fn();
let showQuickPick = jest.fn();
let showInputBox = jest.fn();
let oc = {
  hide: jest.fn(),
  appendLine: jest.fn()
};
let vsc = {
  window: {
    createOutputChannel: jest.fn().mockReturnValue(oc),
    showInformationMessage: showInfo,
    showQuickPick: showQuickPick,
    showInputBox,
  },
  workspace: {
    registerFileSystemProvider: registerFSP,
    workspaceFolders
  },
  commands: {
    registerCommand: registerC
  },
  Uri : {
    parse: parse
  },
  EventEmitter: jest.fn(),
};

let m = jest.mock('vscode', () => vsc, {virtual:true});

let stateUpdate = jest.fn();
let secretsStore = jest.fn();
let c = {
  subscriptions: [],
  globalState: {
    update: stateUpdate
  },
  secrets: {
    store: secretsStore,
  }
} as unknown as vscode.ExtensionContext;

import * as x from './extension';

let y = require('./extension');

describe('Helpers', () => {
  test('Validate URI', () => {
    expect(x.validationErrorsForUri("")).toContain("WebDAV");

    parse.mockImplementation(f => {throw new Error();});
    expect(x.validationErrorsForUri("Not an URI")).toContain("valid");

    parse.mockReturnValue({scheme: "http"});
    expect(x.validationErrorsForUri("http://example.com")).toBeUndefined();
    parse.mockReturnValue({scheme: "https"});
    expect(x.validationErrorsForUri("https://example.com")).toBeUndefined();
    parse.mockReturnValue({scheme: "webdav"});
    expect(x.validationErrorsForUri("webdav://example.com")).toBeUndefined();
    parse.mockReturnValue({scheme: "webdavs"});
    expect(x.validationErrorsForUri("webdavs://example.com")).toBeUndefined();

    parse.mockReturnValue({scheme: "other"});
    expect(x.validationErrorsForUri("other://example.com")).toContain("Unsupported");
    expect(x.validationErrorsForUri("other://example.com")).toContain("other");

    
    x.validationErrorsForUri("  http://example.com \t");
    expect(parse).toBeCalledWith("http://example.com");
  });

  test('toWebDAVPath', () => {
    expect(x.toWebDAVPath({path:""} as vscode.Uri)).toEqual("/");
    expect(x.toWebDAVPath({path:" x "} as vscode.Uri)).toEqual("x");
  });
});

describe('Extrension', () => {
  test('deactivate', () => {
    x.deactivate();
  });

  test('activate', async () => {
    let ec = {subscriptions: []} as unknown as vscode.ExtensionContext;
    await x.activate(ec);

    expect(ec.subscriptions).toHaveLength(5);
    expect(registerFSP).toBeCalledTimes(2);
    expect(registerFSP).toBeCalledWith("webdav", expect.any(x.WebDAVFileSystemProvider), {isCaseSensitive: true});
    expect(registerFSP).toBeCalledWith("webdavs", expect.any(x.WebDAVFileSystemProvider), {isCaseSensitive: true});

    expect(registerC).toHaveBeenCalledTimes(2);
    expect(registerC).toBeCalledWith('extension.remote.webdav.open', x.openWebdav);
    expect(registerC).toBeCalledWith('extension.remote.webdav.resetAuth', x.resetAuth);
  });
});

describe('Rest Auth Command', () => {
  beforeAll(async () => {
    await x.activate(c);
  });
  beforeEach(() => {
    workspaceFolders.length = 0;
  });
  test('Shows a message if there are no webdav URIs', async () => {
    await x.resetAuth();
    expect(showInfo).toBeCalledWith(expect.stringContaining("WebDAV"));
  });
  test('Shows a selector if there are multiple addresses', async () => {
    workspaceFolders.push({uri:"webdav:a"}, {uri:"http:b"}, {uri:"webdavs:c"});
    showQuickPick.mockReturnValueOnce(Promise.resolve(undefined));
    await x.resetAuth();
    expect(showQuickPick).toBeCalledWith(["webdav:a", "webdavs:c"], {placeHolder: expect.stringContaining("WebDAV")});
  });

  test('Does not show a selector for one folder', async () => {
    let baseUri = jest.spyOn(x, "toBaseUri");
    baseUri.mockReturnValueOnce("http:key");

    workspaceFolders.push({uri:"webdav:a"}, {uri:"http:b"});
    showQuickPick.mockReturnValueOnce(Promise.resolve(undefined));
    
    await x.resetAuth();

    expect(showQuickPick).toBeCalledWith(["None", "Basic", "Digest", "Windows (SSPI)"], {"placeHolder": expect.stringContaining("http:key")});
  });

  test('workspaceFolders can be undefined', async () => {
    // @ts-ignore
    vsc.workspace.workspaceFolders = undefined;

    await x.resetAuth();
    expect(showInfo).toBeCalledWith(expect.stringContaining("WebDAV"));
  });

  test('Windows auth is not shown on non-windows', async () => {
    // @ts-ignore
    x.IS_WINDOWS = false;

    await x.configureAuthForUri("https:key");

    expect(showQuickPick).toBeCalledWith(["None", "Basic", "Digest"], {"placeHolder": expect.stringContaining("https:key")});

    expect(stateUpdate).toBeCalledWith("https:key", {auth:undefined});
  });

  test('Windows auth is not shown on non-windows', async () => {
    // @ts-ignore
    x.IS_WINDOWS = false;

    await x.configureAuthForUri("https:key");

    expect(showQuickPick).toBeCalledWith(["None", "Basic", "Digest"], {"placeHolder": expect.stringContaining("https:key")});

    expect(stateUpdate).toBeCalledWith("https:key", {auth:undefined});
  });
  for(let auth of ["Basic", "Digest"]) {
    test(`${auth} auth saves username and password`, async () => {
      showQuickPick.mockReturnValueOnce(Promise.resolve(auth));
      showInputBox.mockReturnValueOnce(Promise.resolve("U"));
      showInputBox.mockReturnValueOnce(Promise.resolve("P"));

      await x.configureAuthForUri("https:key");

      expect(showInputBox).toBeCalledWith({ prompt: "Username", placeHolder: expect.stringContaining("https:key") });
      expect(showInputBox).toBeCalledWith({ prompt: "Password", password:true, placeHolder: expect.stringContaining("Password") });

      expect(stateUpdate).toBeCalledWith("https:key", {auth:auth, user:"U"});

      expect(secretsStore).toBeCalledWith("https:key", "P");
    });
  }

  test(`If password is not entered, empty string will be used`, async () => {
    showQuickPick.mockReturnValueOnce(Promise.resolve("Basic"));
    showInputBox.mockReturnValueOnce(Promise.resolve("U"));
    showInputBox.mockReturnValueOnce(Promise.resolve(undefined));

    await x.configureAuthForUri("https:key");

    expect(showInputBox).toBeCalledWith({ prompt: "Username", placeHolder: expect.stringContaining("https:key") });
    expect(showInputBox).toBeCalledWith({ prompt: "Password", password:true, placeHolder: expect.stringContaining("Password") });

    expect(stateUpdate).toBeCalledWith("https:key", {auth:"Basic", user:"U"});

    expect(secretsStore).toBeCalledWith("https:key", "");
  });
});



describe('WebDAVFileSystemProvider', () => {
  beforeAll(() => {
  });
  test('Delete', () => {
  });
});