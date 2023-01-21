import {describe, expect, test} from '@jest/globals';
import * as vscode from 'vscode';

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
    commands: {
      registerCommand: jest.fn()
    }
  };
}, {virtual:true});

import * as x from './extension';

let y = require('./extension');

describe('command', () => {
  test('activate', () => {
    let m = {
      globalState: {
        update: jest.fn(),
      },  
      subscriptions: [] as { dispose(): any }[],
    } as unknown as vscode.ExtensionContext;
    x.activate(m);
  });
  
  test('deactivate', () => {
    x.deactivate();
  });
  test('else', () => {
    x.configureAuthForUri("a");
  });
});