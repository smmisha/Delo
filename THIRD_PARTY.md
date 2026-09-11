# Third-party software

The Delo application source is MIT-licensed. The following components keep their own terms.

## Microsoft Edge WebView2 SDK

- Version: 1.0.4191.47.
- Use: headers and the static WebView2Loader library used to build `Delo.exe`.
- Restoration: `app/setup.ps1` downloads the pinned NuGet package and verifies its SHA-256.
- Distribution: the Delo installer includes the SDK `LICENSE.txt` and `NOTICE.txt` as `licenses/WebView2-SDK.txt` and `licenses/WebView2-NOTICE.txt`.

## Microsoft Edge WebView2 Runtime

- Use: runtime required by the transparent local web interface.
- Distribution: `app/setup-distribution.ps1` obtains the x64 standalone installer and accepts it only when Authenticode is valid and the signer is Microsoft Corporation. `app/package.ps1` repeats that verification before packaging.
- Removal: the Delo uninstaller does not remove the shared runtime.

## Inno Setup

- Tested compiler: Inno Setup 6.7.3.
- Use: creates the per-user Windows installer. The compiler itself is restored under an ignored local `vendor` directory and is not committed as project source.
- Project: https://jrsoftware.org/isinfo.php

## Windows SDK and C++/WinRT

The application uses Windows system APIs, Windows Runtime headers, and import libraries supplied by the installed Windows SDK. Build tools and SDK files are not copied into the source repository.

## Research prototypes

The historical WinUI experiment has separate provenance in `prototypes/winui-glass/THIRD_PARTY.md`. Its downloaded `vendor`, `bin`, and `obj` trees are ignored and are not part of the application or installer.
