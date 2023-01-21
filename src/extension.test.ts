/* eslint-disable @typescript-eslint/naming-convention*/
import {describe, expect, test} from '@jest/globals';
import * as vscode from 'vscode';

let parse = jest.fn();
let registerFSP = jest.fn();
let registerC = jest.fn();
let m = jest.mock('vscode', () => {
  let oc = {
    hide: jest.fn(),
    appendLine: jest.fn()
  };
  return {
    window: {
      createOutputChannel: jest.fn().mockReturnValue(oc),
      showQuickPick: jest.fn().mockReturnValue(Promise.resolve("wow"))
    },
    workspace: {
      registerFileSystemProvider: registerFSP
    },
    commands: {
      registerCommand: registerC
    },
    Uri : {
      parse: parse
    },
    EventEmitter: jest.fn(),
  };
}, {virtual:true});

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

  test('activate', () => {
    let ec = {subscriptions: []} as unknown as vscode.ExtensionContext;
    x.activate(ec);

    expect(ec.subscriptions).toHaveLength(5);
    expect(registerFSP).toBeCalledTimes(2);
    expect(registerFSP).toBeCalledWith("webdav", expect.any(x.WebDAVFileSystemProvider), {isCaseSensitive: true});
    expect(registerFSP).toBeCalledWith("webdavs", expect.any(x.WebDAVFileSystemProvider), {isCaseSensitive: true});

    expect(registerC).toHaveBeenCalledTimes(2);
    expect(registerC).toBeCalledWith('extension.remote.webdav.open', x.openWebdav);
    expect(registerC).toBeCalledWith('extension.remote.webdav.resetAuth', x.resetAuth);
  });
});

describe('WebDAVFileSystemProvider', () => {
  beforeAll(() => {
  });
  test('Delete', () => {
  });
});