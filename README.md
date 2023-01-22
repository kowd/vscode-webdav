[![GitHub](https://img.shields.io/github/license/kowd/vscode-webdav?style=flat-square)](https://github.com/kowd/vscode-webdav/blob/main/LICENSE)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/kowd.vscode-webdav?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=kowd.vscode-webdav)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/kowd.vscode-webdav?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=kowd.vscode-webdav)
[![Coverage](https://img.shields.io/coverallsCoverage/github/kowd/vscode-webdav?style=flat-square)](https://coveralls.io/github/kowd/vscode-webdav)

# WebDAV Workspaces for Visual Studio Code

The `vscode-webdav` Visual Studio Code extension allows adding WebDAV endpoints as remote workspaces.

## How to use

Install the extension in VS Code.

### Adding a new WebDAV Workspace

There are three ways to open a WebDAV Workspace

* When no folder is open in VS Code, activate the explorer and click on the "Open WebDAV"

* Run the "Open WebDAV Workspace..." command and follow the prompts to enter an address, name and choose authentication.

* Open a `.code-workspace` file which contains a uri with a `webdav` or `webdavs` scheme (corresponding to `http` and `https` WebDAV endpoints respectively). 
```js
{
  "folders": [{
    "name": "live.sysinternals.com",
    "uri": "webdavs://live.sysinternals.com"
  }]
}
```

### Authentication Support

The authentication schemes supported by the extension are:
* `None` - no authentication.
* `Basic` - for Basic authentication consider using TLS too. The password for the account is stored securely in the VS Code SecretStorage.
* `Digest` - The password for the account is stored securely in the VS Code SecretStorage. This means that the OS-specific credential storage will be used.
* `Windows (SSPI)` - This authentication uses the [Windows Security Support Provider Interface](https://learn.microsoft.com/en-us/windows/win32/rpc/security-support-provider-interface-sspi-). In practice this means that the authentication is Kerberos (via [SPNEGO](https://en.wikipedia.org/wiki/SPNEGO)). This should work the same way as in browsers like Edge or Chrome. It is only available on Windows.

### Changing Passwords or Authentication

If `Basic` or `Digest` authentication is used, you may need to update the password or the account.

If at any time authentication fails with a "Forbidden" error a notification pops up suggesting the authentication settings should be reset.

Additionally you can reset the authentication at any time by using the `Reset WebDAV Authentication ...` command.

### Operating System Support

The `Windows (SSPI)` authentication scheme is only supported on Windows.

## Contributions

Contributions are welcome.
