# Delo

Delo is a local Windows 11 desktop planner. It combines a Win32 host, a D3D11/Windows Graphics Capture live backdrop material, and a transparent WebView2 interface.

The app keeps a task list on the desktop, provides global shortcuts for the list and quick entry, tracks focused work, archives stale tasks, keeps deleted tasks for 30 days, and records a simple reputation score. The interface supports Russian, Ukrainian, and English, light and dark themes, keyboard operation, and reduced motion.

## Build

Requirements: Windows 11 x64, Visual Studio Build Tools with Desktop development with C++, a Windows SDK with C++/WinRT, PowerShell, and Node.js for JavaScript tests.

```powershell
cd app
./setup.ps1
./build.ps1 -Version 0.1.4
node --test tests/*.test.mjs
./test-store.ps1
./test-renderer.ps1
```

`setup.ps1` restores the pinned WebView2 SDK and verifies its SHA-256. The release executable statically links the MSVC runtime and WebView2Loader. End users still need the Microsoft Edge WebView2 Runtime.

## Installer

The Inno Setup package installs per user into `%LOCALAPPDATA%\Programs\Delo` and does not require administrator rights for Delo itself. It embeds the signed Microsoft WebView2 standalone installer and runs it only when a compatible runtime is absent.

```powershell
cd app
./setup-distribution.ps1
./package.ps1 -Version 0.1.4
```

The installer and a matching SHA-256 sidecar are written to `app/dist`. Build outputs, restored dependencies, test sessions, and user data are excluded from Git.

## Data and privacy

Delo stores ordinary data in `%LOCALAPPDATA%\Delo\tasks.json` and keeps `tasks.json.bak` for explicit recovery. Writes use a revisioned atomic envelope. Uninstalling Delo preserves tasks and the shared WebView2 Runtime.

The app has no account, cloud synchronization, analytics, or network-backed task storage. WebView2 is restricted to the local `https://delo.local/` virtual host; navigation, new windows, and permission requests are blocked.

## Verification status

Local verification covers 32 JavaScript tests, 20 native storage/hotkey assertions, 9 GPU checks, screenshot-key coverage, live UI scenarios, Win+D, idle behavior, install/update/uninstall, and sleep/resume recovery with persisted timer state. See [TASKS.md](TASKS.md), [application lifecycle](architecture/APP-LIFECYCLE.md), and [distribution evidence](architecture/DISTRIBUTION.md).

Physical multi-monitor/DPI scenarios and the missing-WebView2 branch on a clean Windows image remain unverified. The current local installer is unsigned, so SmartScreen can warn until a publisher certificate is used.

## License

Delo source code is available under the [MIT License](LICENSE). Dependency provenance and redistribution notes are in [THIRD_PARTY.md](THIRD_PARTY.md).
