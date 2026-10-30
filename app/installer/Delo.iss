#ifndef AppVersion
  #define AppVersion "0.3.10"
#endif
#ifdef UpdateInstallerTest
  ; Test builds must provide isolated identities; they must never touch a live installation.
  #ifndef TestAppId
    #error TestAppId is required for UpdateInstallerTest
  #endif
  #ifndef TestDir
    #error TestDir is required for UpdateInstallerTest
  #endif
  #ifndef TestRunKey
    #error TestRunKey is required for UpdateInstallerTest
  #endif
  #ifndef TestGroup
    #error TestGroup is required for UpdateInstallerTest
  #endif
  #define InstallerAppId TestAppId
  #define InstallerDir TestDir
  #define InstallerGroup TestGroup
  #define StartupRunKey TestRunKey
#else
  #define InstallerAppId "{{CE9AAB6D-03AE-43FB-A87E-48BF58868D12}"
  #define InstallerDir "{localappdata}\Programs\Delo"
  #define InstallerGroup "Delo"
  #define StartupRunKey "Software\Microsoft\Windows\CurrentVersion\Run"
#endif
[Setup]
AppId={#InstallerAppId}
AppName=Delo
AppVersion={#AppVersion}
AppPublisher=Delo contributors
DefaultDirName={#InstallerDir}
DefaultGroupName={#InstallerGroup}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.22000
WizardStyle=modern
#ifdef UpdateInstallerTest
Compression=none
SolidCompression=no
#else
Compression=lzma2
SolidCompression=yes
#endif
OutputDir=..\dist
OutputBaseFilename=Delo-{#AppVersion}-windows-x64-setup
UninstallDisplayIcon={app}\Delo.exe
LicenseFile=..\..\LICENSE
SetupIconFile=..\native\Delo.ico
CloseApplications=no
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "uk"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ru.RuntimeFailed=Не удалось установить Microsoft WebView2. Установка Delo остановлена. Повторите установку; ваши задачи сохранены.
uk.RuntimeFailed=Не вдалося встановити Microsoft WebView2. Встановлення Delo зупинено. Спробуйте ще раз; ваші завдання збережено.
en.RuntimeFailed=Microsoft WebView2 could not be installed. Delo setup has stopped. Try again; your tasks are preserved.
ru.DataNotice=Задачи хранятся отдельно от приложения. Обновление и удаление Delo сохраняют эти данные.
uk.DataNotice=Завдання зберігаються окремо від програми. Оновлення та видалення Delo зберігають ці дані.
en.DataNotice=Tasks are stored separately from the app. Updating or uninstalling Delo preserves this data.
ru.LaunchDelo=Запустить Delo
uk.LaunchDelo=Запустити Delo
en.LaunchDelo=Launch Delo
ru.CloseFailed=Не удалось закрыть Delo. Закройте его через меню значка в трее («Выход») и повторите.
uk.CloseFailed=Не вдалося закрити Delo. Закрийте його через меню значка в треї («Вихід») і повторіть.
en.CloseFailed=Delo could not be closed. Exit it from the tray icon menu and try again.

[Files]
Source: "..\bin\Delo.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bin\Glass.hlsl"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bin\privacy.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bin\ui\*.html"; DestDir: "{app}\ui"; Flags: ignoreversion
Source: "..\bin\ui\*.css"; DestDir: "{app}\ui"; Flags: ignoreversion
Source: "..\bin\ui\*.mjs"; DestDir: "{app}\ui"; Flags: ignoreversion
Source: "..\bin\core\*.mjs"; DestDir: "{app}\core"; Flags: ignoreversion
Source: "..\bin\voice\*.exe"; DestDir: "{app}\voice"; Flags: ignoreversion
Source: "..\bin\voice\*.dll"; DestDir: "{app}\voice"; Flags: ignoreversion
Source: "..\bin\voice\*.bin"; DestDir: "{app}\voice"; Flags: ignoreversion
Source: "..\bin\voice\*.txt"; DestDir: "{app}\voice"; Flags: ignoreversion
Source: "..\bin\voice\manifest.json"; DestDir: "{app}\voice"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\vendor\webview2-1.0.4191.47\LICENSE.txt"; DestDir: "{app}\licenses"; DestName: "WebView2-SDK.txt"; Flags: ignoreversion
Source: "..\vendor\webview2-1.0.4191.47\NOTICE.txt"; DestDir: "{app}\licenses"; DestName: "WebView2-NOTICE.txt"; Flags: ignoreversion
#ifdef Offline
; Offline build: the whole runtime travels inside the installer (~250 MB).
Source: "..\vendor\distribution\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Flags: dontcopy
#else
; Default: Microsoft's evergreen bootstrapper (~2 MB) fetches the runtime during
; install, and only on machines that do not already have WebView2.
Source: "..\vendor\distribution\MicrosoftEdgeWebView2Setup.exe"; Flags: dontcopy
#endif

[Icons]
Name: "{group}\Delo"; Filename: "{app}\Delo.exe"

[Run]
Filename: "{app}\Delo.exe"; Description: "{cm:LaunchDelo}"; Flags: nowait postinstall skipifsilent unchecked

[Code]
// A running Delo is asked to leave the ordinary way: it pauses its timers, saves, and quits only
// once that save is acknowledged, however long the disk takes. It answers the request, so Setup
// knows to wait for the exit. A version from before this request (0.1.9 and older) does not
// answer; it is closed the way Windows closes it at sign-out instead: the session-end query
// makes it pause and save, and the session end quits it. Only the widget that holds the app
// mutex counts as running; it is started again after an update.
const
#ifdef UpdateInstallerTest
  DeloMutex = 'Local\Delo.UpdateInstallerTest';
  DeloControl = 'Delo.UpdateInstallerTest.Control';
#else
  DeloMutex = 'Local\Delo.Widget';
  DeloControl = 'Delo.Control';
#endif
  StartupRunKey = '{#StartupRunKey}';
  WM_QUERYENDSESSION = $0011;
  WM_ENDSESSION = $0016;
  SMTO_ABORTIFHUNG = $0002;
  RequestExitAccepted = $44454C4F;
var
  WasRunning: Boolean;

function IsWindow(Wnd: HWND): Integer; external 'IsWindow@user32.dll stdcall';
function RegisterWindowMessage(Name: String): Cardinal; external 'RegisterWindowMessageW@user32.dll stdcall';
function SendMessageTimeout(Wnd: HWND; Msg: Cardinal; WParam, LParam: Longint; Flags, Timeout: Cardinal; var Answer: Int64): Longint; external 'SendMessageTimeoutW@user32.dll stdcall';

function WaitGone(Wnd: HWND; Steps: Integer): Boolean;
var Step: Integer;
begin
  for Step := 1 to Steps do begin
    if IsWindow(Wnd) = 0 then break;
    Sleep(200);
  end;
  Result := IsWindow(Wnd) = 0;
end;

function CloseDelo: Boolean;
var Wnd: HWND; Round, Step: Integer; Answer: Int64; RequestExit: Cardinal;
begin
  RequestExit := RegisterWindowMessage('Delo.RequestExit');
  for Round := 1 to 10 do begin
    if not CheckForMutexes(DeloMutex) then break;
    Wnd := FindWindowByWindowName(DeloControl);
    if Wnd = 0 then break;
    Answer := 0;
    if (SendMessageTimeout(Wnd, RequestExit, 0, 0, SMTO_ABORTIFHUNG, 5000, Answer) <> 0) and (Answer = RequestExitAccepted) then
      // The app gives up its own exit after 20 s if the save cannot be acknowledged.
      WaitGone(Wnd, 150)
    else begin
      PostMessage(Wnd, WM_QUERYENDSESSION, 0, 0);
      Sleep(3000);
      PostMessage(Wnd, WM_ENDSESSION, 1, 0);
      WaitGone(Wnd, 75);
    end;
  end;
  for Step := 1 to 50 do begin
    if not CheckForMutexes(DeloMutex) then break;
    Sleep(200);
  end;
  Result := not CheckForMutexes(DeloMutex);
end;

function InitializeUninstall: Boolean;
begin
  Result := CloseDelo;
  if not Result then SuppressibleMsgBox(CustomMessage('CloseFailed'), mbError, MB_OK, IDOK);
end;

// Run entries written by Delo are quoted. Also accept legacy unquoted paths,
// including spaces, but never reinterpret a different executable as Delo.
function ParseStartupCommand(Command: String; var Executable, Arguments: String): Boolean;
var Boundary, Index: Integer;
begin
  Result := False;
  Executable := '';
  Arguments := '';
  Command := Trim(Command);
  if Command = '' then exit;
  if Command[1] = '"' then begin
    Boundary := Pos('"', Copy(Command, 2, Length(Command)));
    if Boundary = 0 then exit;
    Boundary := Boundary + 1;
    if Boundary < Length(Command) then
      if (Command[Boundary + 1] <> ' ') and (Command[Boundary + 1] <> #9) then exit;
    Executable := Copy(Command, 2, Boundary - 2);
    Arguments := Copy(Command, Boundary + 1, Length(Command));
  end else begin
    Boundary := 0;
    for Index := 1 to Length(Command) - 3 do
      if CompareText(Copy(Command, Index, 4), '.exe') = 0 then begin
        if Index + 3 = Length(Command) then
          Boundary := Index + 3
        else if (Command[Index + 4] = ' ') or (Command[Index + 4] = #9) then
          Boundary := Index + 3;
        if Boundary > 0 then break;
      end;
    if Boundary = 0 then exit;
    Executable := Copy(Command, 1, Boundary);
    Arguments := Copy(Command, Boundary + 1, Length(Command));
  end;
  Result := Executable <> '';
end;

procedure RepairAutostart;
var Command, Executable, Arguments, UpdatedCommand: String;
begin
  // Keep the existing value name and leave Windows' StartupApproved state alone.
  // Autostart opt-in/opt-out and Task Manager disable flags belong to the user.
  if not RegQueryStringValue(HKCU, StartupRunKey, 'Delo', Command) then exit;
  if not ParseStartupCommand(Command, Executable, Arguments) then exit;
  if CompareText(ExtractFileName(Executable), 'Delo.exe') <> 0 then exit;
  UpdatedCommand := '"' + ExpandConstant('{app}\Delo.exe') + '"' + Arguments;
  if CompareText(Command, UpdatedCommand) = 0 then exit;
  if RegWriteStringValue(HKCU, StartupRunKey, 'Delo', UpdatedCommand) then
    Log('Updated the existing Delo autostart path.')
  else
    Log('Could not update the existing Delo autostart path.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer;
begin
  if CurStep = ssPostInstall then begin
    RepairAutostart;
    if WasRunning then
      ExecAsOriginalUser(ExpandConstant('{app}\Delo.exe'), '', '', SW_SHOWNORMAL, ewNoWait, Code);
  end;
end;

function HasRuntimeAt(Root: Integer): Boolean;
var Version: String;
begin
  Result := RegQueryStringValue(Root, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  if Result then Result := StrToIntDef(Copy(Version, 1, Pos('.', Version)-1), 0) >= 120;
end;

function HasRuntime: Boolean;
begin
  Result := HasRuntimeAt(HKLM32) or HasRuntimeAt(HKCU32) or HasRuntimeAt(HKCU64);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  WasRunning := CheckForMutexes(DeloMutex);
  if WasRunning and not CloseDelo then begin
    Result := CustomMessage('CloseFailed');
    exit;
  end;
  if HasRuntime then exit;
#ifdef Offline
  ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then
#else
  ExtractTemporaryFile('MicrosoftEdgeWebView2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then
#endif
    Result := CustomMessage('RuntimeFailed')
  else if not HasRuntime then Result := CustomMessage('RuntimeFailed');
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine + CustomMessage('DataNotice');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Command, Executable, Arguments: String;
begin
  if CurUninstallStep = usUninstall then begin
    if RegQueryStringValue(HKCU, StartupRunKey, 'Delo', Command) then
      if ParseStartupCommand(Command, Executable, Arguments) then
        if CompareText(Executable, ExpandConstant('{app}\Delo.exe')) = 0 then
          RegDeleteValue(HKCU, StartupRunKey, 'Delo');
  end;
end;
