#ifndef AppVersion
  #define AppVersion "0.1.1"
#endif
[Setup]
AppId={{CE9AAB6D-03AE-43FB-A87E-48BF58868D12}
AppName=Delo
AppVersion={#AppVersion}
AppPublisher=Delo contributors
DefaultDirName={localappdata}\Programs\Delo
DefaultGroupName=Delo
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.22000
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
OutputDir=..\dist
OutputBaseFilename=Delo-{#AppVersion}-windows-x64-setup
UninstallDisplayIcon={app}\Delo.exe
LicenseFile=..\..\LICENSE
SetupIconFile=..\native\Delo.ico
AppMutex=Local\Delo.Widget
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

[Files]
Source: "..\bin\Delo.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bin\Glass.hlsl"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bin\ui\*.html"; DestDir: "{app}\ui"; Flags: ignoreversion
Source: "..\bin\ui\*.css"; DestDir: "{app}\ui"; Flags: ignoreversion
Source: "..\bin\ui\*.mjs"; DestDir: "{app}\ui"; Flags: ignoreversion
Source: "..\bin\core\*.mjs"; DestDir: "{app}\core"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\vendor\webview2-1.0.4191.47\LICENSE.txt"; DestDir: "{app}\licenses"; DestName: "WebView2-SDK.txt"; Flags: ignoreversion
Source: "..\vendor\webview2-1.0.4191.47\NOTICE.txt"; DestDir: "{app}\licenses"; DestName: "WebView2-NOTICE.txt"; Flags: ignoreversion
Source: "..\vendor\distribution\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Flags: dontcopy

[Icons]
Name: "{group}\Delo"; Filename: "{app}\Delo.exe"

[Run]
Filename: "{app}\Delo.exe"; Description: "{cm:LaunchDelo}"; Flags: nowait postinstall skipifsilent unchecked

[Code]
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
  if HasRuntime then exit;
  ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Result := CustomMessage('RuntimeFailed')
  else if not HasRuntime then Result := CustomMessage('RuntimeFailed');
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine + CustomMessage('DataNotice');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Command: String;
begin
  if CurUninstallStep = usUninstall then begin
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Delo', Command) then
      if CompareText(Command, '"' + ExpandConstant('{app}\Delo.exe') + '"') = 0 then
        RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Delo');
  end;
end;
