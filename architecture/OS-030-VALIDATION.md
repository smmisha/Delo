# 0.3.0: N12, T07, N13 OS boundary validation

Base: `main` at `f2c9ce4`, checked 2026-09-29. PR #6 merged as
`bf96ad7` (tag `v0.3.0`, released September 27). The only later main commit,
`f2c9ce4`, updates TASKS and DISTRIBUTION with the published installer. It does
not close the three OS UI gaps. `ui-030-smoke.js` remains unchanged.

## Evidence boundaries

| Scenario | New deterministic Windows integration | Separate manual live check |
| --- | --- | --- |
| N12 | Real export handler with a controlled picker; cancellation does not download; invalid import and cancelled confirmation do not write; CDP selects a synthetic file, actual confirmation saves through Host/Store, disk and returned state match, before-import copy equals previous bytes | Actual Windows save/open dialogs, cancel, selected path, resulting file and import copy |
| T07 | One synthetic call through the real bridge to Shell_NotifyIconW, accepted counter increases; show/click callbacks are diagnostic only | Actual reminder appearance, text, one delivery, click opens list |
| N13 | Future version seeded in the isolated native cache; real cached update result; GetMenuItemInfoW reads the same HMENU builder used by the tray; first item, label, order and removal when disabled | Right-click actual tray icon, visible item and click opens the intended release page; disappearance after disabling |

Neither a CDP selection nor a picker double tests the system dialog. HMENU
inspection is not visible-menu evidence. Shell acceptance is not visual receipt;
quiet time and OS settings can suppress display. No synthetic tray callbacks are
sent. No external release is created, and the seeded cache avoids relying on the
currently published version or GitHub availability. The future label points to the
existing v0.3.0 release solely for the manual link check.

Reference contracts checked against Microsoft documentation:
[GetMenuItemInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmenuiteminfow),
[Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw).

## Repeatable commands

From the repository root, Windows 11, MSVC/SDK/WebView2 SDK and Node 22+:

```powershell
# Separate build; do not replace the installed application.
./app/build.ps1 -SkipVoice -OutputDirectory ./app/test-output/os-030-runtime
node --test app/tests/*.test.mjs
./app/tests/run-os-030.ps1 -RuntimeDirectory ./app/test-output/os-030-runtime
```

The runner refuses an existing harness or occupied port 9223. It creates a fresh
GUID-named profile with synthetic data, verifies the native PID and profile before
mutation, and retains `runtime-manifest.json`, `os-030.json`, tasks, fixtures,
exported bytes, the before-import copy and native logs under that profile. Paths
are derived from RuntimeDirectory, with no machine-specific paths. The manifest
records hashes of the tested runtime and test/source files; it does not prove an
old EXE was built from new source. The patched diagnostics requirement rejects an
unpatched EXE. Use the build command above and retain its output with the manifest.

Exit zero means **integration only**. The report always retains N12/T07/N13 live
as UNVERIFIED. Missing, duplicate or failed checks cannot yield integration PASS.
A startup/build failure is not a test pass. After a failed run inspect the cause;
use a fresh session after fixing it. Cleanup requests a saved exit of the verified
PID, never kills another Delo and retains evidence even on failure.

## Manual live check, fresh session

```powershell
./app/tests/run-os-030.ps1 -RuntimeDirectory ./app/test-output/os-030-runtime -Manual
```

This intentionally leaves the new harness running, prints its profile/PID and
records the runtime manifest. It does not run the doubled picker or send the
synthetic notification. Close any previous harness first. Only interact with this
harness's tray icon and widget; the production profile is never a test target.

1. **N12:** open Settings in the harness. Export, observe the actual save surface,
   cancel and verify no file appeared. Export again to a new path inside the printed
   profile; record the exact path and inspect the JSON (`format: delo-export`). If
   WebView2 uses download fallback instead of a save dialog, record that fact: the
   save-dialog live check is UNVERIFIED, not PASS. Import, observe the real file
   chooser, cancel: state and file must remain unchanged. Add a synthetic task in
   the widget. Select the exported file with the real chooser, cancel the app's
   confirmation: the task stays. Repeat and accept: the task is removed, disk state
   matches the export, and exactly one new `tasks.json.before-import-*` is a byte
   copy of the pre-import file. Before accepting, copy/hash `tasks.json` while no
   timer is running. Also select `invalid.json`: an error with no changed data or
   new copy is required. Never choose personal data or overwrite an existing export.
2. **T07:** create one synthetic task due ten minutes from the current local time,
   with an explicit date/time in the editor (avoid text-date parsing and midnight
   ambiguity). Default reminder threshold is fifteen minutes. Observe the Windows
   notification, record title/body, whether it appeared once, and the OS notification
   settings. Click that notification and confirm the harness list is shown. Observe
   another tick without a duplicate. A stored `reminded` value, log `notify`, accepted
   count or NIN_BALLOONSHOW callback alone is not visual PASS. If Windows suppresses
   the notification, record BLOCKED/UNVERIFIED and the setting; do not silently change
   system notification policy or mark it successful.
3. **N13:** right-click the actual harness tray icon. First entry must read
   `Version available: 999.0.0` in this English fixture, with a separator before the
   ordinary items. Click it and verify the browser opens
   `https://github.com/smmisha/Delo/releases/tag/v0.3.0`. This is an intentional test
   fixture, not a claim that version 999 exists. Disable update checking in Settings
   and save; reopen the actual tray menu and verify the item is gone.

Native diagnostics can be saved before/after the manual steps, using the printed
profile and PID (they supplement, not replace, the observations):

```powershell
node app/tests/audit-os-030.mjs --snapshot '<printed profile>' <printed PID>
```

Keep a separate `manual-live.md` in the profile: runtime manifest, Windows and
WebView2 versions, date/time, operator, each substep PASS/FAIL/BLOCKED/UNVERIFIED,
observed vs expected result, selected file hashes and evidence paths. Cropped
screenshots may show synthetic test content only; do not publish desktop captures
or personal paths. Record each live scenario separately. Finish via the harness
tray's Exit, preserving its files. Do not rewrite automatic `live` fields to PASS.

## Verification in the patch session

Linux: `node --test app/tests/*.test.mjs`: 83 tests PASS (81 existing + 2 narrow
fixture/evidence tests); JS syntax check and `git diff --check` pass. Windows/MSVC,
PowerShell execution, real WebView2 integration and all three manual OS checks
were **not run** here. Windows build and integration are review gates, not claimed
results. The public installer and release are unchanged.
