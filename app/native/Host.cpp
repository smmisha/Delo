#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wtsapi32.h>
#include <dwmapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Data.Json.h>
#include <memory>
#include <vector>
#include <sstream>
#include "Store.h"
#include "Hotkey.h"
#include "GlassRenderer.h"
#include "ScreenshotKeys.h"
#include "Voice.h"
#include "resource.h"

using Microsoft::WRL::Callback;
using namespace winrt;
using namespace winrt::Windows::Data::Json;
namespace fs=std::filesystem;
constexpr UINT TrayMessage=WM_APP+1, ShowMessage=WM_APP+2;
constexpr wchar_t ClassName[]=L"Delo.Widget.Host";
constexpr int QuickHeightDip=83;
struct View {
    HWND hwnd{};bool quick{},temporary{},visible{true},captureFrozen{},gesture{};HWND previous{};
    com_ptr<ICoreWebView2Controller> controller;com_ptr<ICoreWebView2> web;
    std::unique_ptr<delo::GlassRenderer> glass;bool lastHealthy{true};
};
HINSTANCE appInstance;HWND control{};View mainView,quickView;HWND desktopOwner{};
std::unique_ptr<delo::LightshotTray> lightshotTray;
std::unique_ptr<delo::ScreenshotKeys> screenshotKeys;
com_ptr<ICoreWebView2Environment> environment;std::unique_ptr<delo::Store> store;
fs::path appRoot,dataRoot;JsonObject nativeSettings;std::string storageError;
std::unique_ptr<delo::Voice> voice;View* voiceView{};hstring voiceSession;
void CancelVoice(View* view=nullptr){if(voice&&(!view||voiceView==view))voice->Cancel();}
bool pinned{},exiting{},harness{},mainHiddenForQuick{},ignoreTrayButtonUp{},shortcutRecording{};UINT taskbarCreated{};HPOWERNOTIFY powerNotify{};
std::uint64_t powerSuspends{},powerResumes{},dragRequests{},quickDismissals{},traySingleClicks{},trayDoubleClicks{};
std::ofstream trace;
void Log(std::string const& kind,std::string const& value){if(!trace)return;JsonObject r;r.Insert(L"event",JsonValue::CreateStringValue(to_hstring(kind)));r.Insert(L"value",JsonValue::CreateStringValue(to_hstring(value)));trace<<to_string(r.Stringify())<<'\n';trace.flush();}
JsonValue Number(double n){return JsonValue::CreateNumberValue(n);}JsonValue Text(std::wstring const& s){return JsonValue::CreateStringValue(s);}
JsonValue Bool(bool b){return JsonValue::CreateBooleanValue(b);}
double MonotonicMs(){ULONGLONG ticks{};QueryUnbiasedInterruptTimePrecise(&ticks);return double(ticks)/10000.0;}
void Send(View& v,JsonObject const& obj){if(v.web)v.web->PostWebMessageAsJson(obj.Stringify().c_str());}
void Event(View& v,wchar_t const* name,JsonObject const& payload={}){JsonObject obj;obj.Insert(L"event",Text(name));obj.Insert(L"payload",payload);Send(v,obj);}
void Broadcast(wchar_t const* name,JsonObject const& payload={}){Event(mainView,name,payload);Event(quickView,name,payload);}
void SaveNative(){nativeSettings.Insert(L"pinned",Bool(pinned));delo::AtomicWrite(dataRoot/L"window.json",to_string(nativeSettings.Stringify()));}
BOOL CALLBACK FindDesktop(HWND h,LPARAM){if(FindWindowExW(h,nullptr,L"SHELLDLL_DefView",nullptr)){desktopOwner=h;return FALSE;}return TRUE;}
HWND Desktop(){desktopOwner=nullptr;EnumWindows(FindDesktop,0);if(!desktopOwner){auto progman=FindWindowW(L"Progman",nullptr);DWORD_PTR out{};if(progman)SendMessageTimeoutW(progman,0x052c,0,0,SMTO_ABORTIFHUNG,1000,&out);EnumWindows(FindDesktop,0);}return desktopOwner;}
void ApplyMode(){if(!mainView.hwnd)return;auto top=pinned||mainView.temporary;auto owner=top?nullptr:Desktop();SetWindowLongPtrW(mainView.hwnd,GWLP_HWNDPARENT,reinterpret_cast<LONG_PTR>(owner));if(GetWindow(mainView.hwnd,GW_OWNER)!=owner)Log("owner_error",std::to_string(GetLastError()));SetWindowPos(mainView.hwnd,top?HWND_TOPMOST:HWND_BOTTOM,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_FRAMECHANGED);}
void ClampWindow(View& v){RECT r{};GetWindowRect(v.hwnd,&r);auto mon=MonitorFromRect(&r,MONITOR_DEFAULTTONEAREST);MONITORINFO mi{sizeof(mi)};GetMonitorInfoW(mon,&mi);int width=std::min(r.right-r.left,mi.rcWork.right-mi.rcWork.left),height=std::min(r.bottom-r.top,mi.rcWork.bottom-mi.rcWork.top);int x=std::clamp(r.left,mi.rcWork.left,mi.rcWork.right-width),y=std::clamp(r.top,mi.rcWork.top,mi.rcWork.bottom-height);SetWindowPos(v.hwnd,nullptr,x,y,width,height,SWP_NOZORDER|SWP_NOACTIVATE);}
void Bounds(View& v){if(v.controller){RECT r{};GetClientRect(v.hwnd,&r);v.controller->put_Bounds(r);v.controller->NotifyParentWindowPositionChanged();}}
void Layout(View& v){Bounds(v);if(v.glass)v.glass->Resize();}
// Layout synchronously resizes and redraws the material as well as WebView2.
void Reposition(View& v){Layout(v);}
void Hide(View& v){CancelVoice(&v);v.visible=false;ShowWindow(v.hwnd,SW_HIDE);if(v.controller)v.controller->put_IsVisible(FALSE);JsonObject p;p.Insert(L"visible",Bool(false));Event(v,L"visibility",p);}
void ShowPassive(View& v){v.visible=true;ShowWindow(v.hwnd,SW_SHOWNOACTIVATE);if(v.controller)v.controller->put_IsVisible(TRUE);Reposition(v);JsonObject p;p.Insert(L"visible",Bool(true));Event(v,L"visibility",p);}
void Focus(View& v){v.visible=true;ShowWindow(v.hwnd,SW_SHOW);if(v.controller)v.controller->put_IsVisible(TRUE);Reposition(v);if(v.controller)v.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);SetForegroundWindow(v.hwnd);JsonObject p;p.Insert(L"visible",Bool(true));Event(v,L"visibility",p);}
void ReturnFocus(View& v){if(IsWindow(v.previous))SetForegroundWindow(v.previous);v.previous=nullptr;}
void FinishQuick(bool restoreMain=true,bool returnFocus=true){Hide(quickView);if(restoreMain&&mainHiddenForQuick&&mainView.hwnd)ShowPassive(mainView);mainHiddenForQuick=false;if(returnFocus)ReturnFocus(quickView);else quickView.previous=nullptr;}
void DismissQuick(){if(!quickView.visible)return;++quickDismissals;FinishQuick(false,false);}
void Quick(){if(!quickView.visible){quickView.previous=GetForegroundWindow();if(mainView.hwnd&&mainView.visible){Hide(mainView);mainHiddenForQuick=true;}}Focus(quickView);Event(quickView,L"focusQuick");}
void ShowList(){
    // Opening the list dismisses quick capture: the two are the same job on one screen,
    // and leaving the capture capsule floating over the list looked like a stuck window.
    if(quickView.hwnd&&quickView.visible){Hide(quickView);quickView.previous=nullptr;if(mainHiddenForQuick){ShowPassive(mainView);mainHiddenForQuick=false;}}
    if(mainView.temporary&&IsWindowVisible(mainView.hwnd)){mainView.temporary=false;ApplyMode();ReturnFocus(mainView);}else{mainView.previous=GetForegroundWindow();mainView.temporary=true;ApplyMode();Focus(mainView);}}
HICON AppIcon(bool smallIcon=false){return static_cast<HICON>(LoadImageW(appInstance,MAKEINTRESOURCEW(IDI_DELO),IMAGE_ICON,smallIcon?GetSystemMetrics(SM_CXSMICON):0,smallIcon?GetSystemMetrics(SM_CYSMICON):0,LR_DEFAULTCOLOR|LR_SHARED));}
void Tray(){NOTIFYICONDATAW n{sizeof(n)};n.hWnd=control;n.uID=1;n.uFlags=NIF_MESSAGE|NIF_ICON|NIF_TIP;n.uCallbackMessage=TrayMessage;n.hIcon=AppIcon(true);wcscpy_s(n.szTip,L"Delo");Shell_NotifyIconW(NIM_ADD,&n);}
void RegisterKeys(std::wstring const& list,std::wstring const& quick){auto a=ParseHotkey(list),b=ParseHotkey(quick);if(a.key==b.key&&a.modifiers==b.modifiers)throw std::runtime_error("Hotkeys must be different");UnregisterHotKey(control,1);UnregisterHotKey(control,2);if(!RegisterHotKey(control,1,a.modifiers,a.key)||!RegisterHotKey(control,2,b.modifiers,b.key)){UnregisterHotKey(control,1);UnregisterHotKey(control,2);throw std::runtime_error("Hotkey is already used by another application; choose another combination");}if(shortcutRecording){UnregisterHotKey(control,1);UnregisterHotKey(control,2);}}
// Own global shortcuts must not swallow keys while their recorder has focus.
// Leaving the window restores them even when the renderer has not delivered blur yet.
void RecordShortcuts(bool enabled){
    if(shortcutRecording==enabled)return;
    shortcutRecording=enabled;
    if(enabled){UnregisterHotKey(control,1);UnregisterHotKey(control,2);return;}
    try{auto keys=nativeSettings.GetNamedObject(L"hotkeys");RegisterKeys(keys.GetNamedString(L"list").c_str(),keys.GetNamedString(L"quick").c_str());if(nativeSettings.HasKey(L"hotkeyError"))nativeSettings.Remove(L"hotkeyError");}
    catch(std::exception const& e){nativeSettings.Insert(L"hotkeyError",JsonValue::CreateStringValue(to_hstring(e.what())));}
    Broadcast(L"nativeChanged",nativeSettings);
}
void SetAutostart(bool enabled){if(harness){Log("autostart_simulated",enabled?"true":"false");return;}HKEY raw{};check_hresult(HRESULT_FROM_WIN32(RegCreateKeyExW(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",0,nullptr,0,KEY_SET_VALUE,nullptr,&raw,nullptr)));auto exe=appRoot/L"Delo.exe";auto value=L"\""+exe.wstring()+L"\"";LSTATUS error=enabled?RegSetValueExW(raw,L"Delo",0,REG_SZ,reinterpret_cast<BYTE const*>(value.c_str()),DWORD((value.size()+1)*sizeof(wchar_t))):RegDeleteValueW(raw,L"Delo");RegCloseKey(raw);if(error!=ERROR_SUCCESS&&error!=ERROR_FILE_NOT_FOUND)throw std::runtime_error("Could not change autostart");}
void RequestExit(){if(exiting)return;CancelVoice();exiting=true;Broadcast(L"beforeExit");SetTimer(control,4,20000,nullptr);}
void FinishScreenshot(){
    // Exclude every widget before restarting either monitor session: otherwise the
    // other view could copy the temporarily visible glass into its own background.
    for(auto* item:{&mainView,&quickView})if(item->captureFrozen&&item->hwnd)
        check_hresult(SetWindowDisplayAffinity(item->hwnd,WDA_EXCLUDEFROMCAPTURE)?S_OK:HRESULT_FROM_WIN32(GetLastError()));
    check_hresult(DwmFlush());
    for(auto* item:{&mainView,&quickView})if(item->captureFrozen){
        if(item->glass)item->glass->PauseCapture(false);
        item->captureFrozen=false;
    }
    KillTimer(control,5);
}
void BeginScreenshot(){
    check_hresult(SetTimer(control,5,15000,nullptr)?S_OK:HRESULT_FROM_WIN32(GetLastError()));
    try{
        for(auto* item:{&mainView,&quickView})if(item->glass){
            item->glass->PauseCapture(true);item->captureFrozen=true;
        }
        for(auto* item:{&mainView,&quickView})if(item->captureFrozen)
            check_hresult(SetWindowDisplayAffinity(item->hwnd,WDA_NONE)?S_OK:HRESULT_FROM_WIN32(GetLastError()));
        check_hresult(DwmFlush());
    }catch(...){try{FinishScreenshot();}catch(...){Log("screenshot_restore_error","Will retry on timer");}throw;}
}
void Reply(View& v,IJsonValue const& id,bool ok,JsonObject const& result,std::string const& error={}){JsonObject response;response.Insert(L"id",id);response.Insert(L"ok",Bool(ok));if(ok)response.Insert(L"result",result);else response.Insert(L"error",JsonValue::CreateStringValue(to_hstring(error)));Send(v,response);}
void Handle(View& v,std::wstring const& json){IJsonValue id=JsonValue::CreateNullValue();try{auto request=JsonObject::Parse(json);id=request.GetNamedValue(L"id");auto type=request.GetNamedString(L"type");auto payload=request.GetNamedObject(L"payload",JsonObject{});JsonObject result;
    if(type==L"clock"){result.Insert(L"monotonicMs",Number(MonotonicMs()));}
    else if(type==L"load"){if(!storageError.empty())throw std::runtime_error(storageError);result.Insert(L"state",store->State()?store->State().as<IJsonValue>():JsonValue::CreateNullValue());result.Insert(L"revision",Number(double(store->Revision())));result.Insert(L"native",nativeSettings);result.Insert(L"monotonicMs",Number(MonotonicMs()));}
    else if(type==L"save"){auto expected=payload.GetNamedNumber(L"revision",-1);if(expected<0)throw std::runtime_error("Missing revision");auto revision=store->Save(payload.GetNamedObject(L"state"),uint64_t(expected));result.Insert(L"revision",Number(double(revision)));JsonObject changed;changed.Insert(L"state",store->State());changed.Insert(L"revision",Number(double(revision)));Reply(v,id,true,result);if(&v!=&mainView)Event(mainView,L"stateChanged",changed);if(&v!=&quickView)Event(quickView,L"stateChanged",changed);return;}
    else if(type==L"restoreBackup"){store->RestoreBackup();storageError.clear();result.Insert(L"state",store->State());result.Insert(L"revision",Number(double(store->Revision())));Broadcast(L"stateChanged",result);}
    else if(type==L"voice"){
        auto action=payload.GetNamedString(L"action"),session=payload.GetNamedString(L"session",L"");
        if(action==L"start"){
            if(!v.visible||session.empty()||session.size()>64)throw std::runtime_error("voiceFailed");
            // Finish delivering the preceding session before assigning the next owner.
            if(voiceView)throw std::runtime_error("voiceBusy");
            if(!voice)voice=std::make_unique<delo::Voice>(appRoot/L"voice",dataRoot/L"voice-temp");
            fs::path fixture;
            if(harness&&payload.HasKey(L"fixture")){
                auto name=payload.GetNamedString(L"fixture");
                if(name!=L"en.wav"&&name!=L"ru.wav"&&name!=L"uk.wav")throw std::runtime_error("voiceFailed");
                fixture=appRoot/L"test-output"/L"voice-fixtures"/std::wstring(name);
            }
            voice->Start(to_string(payload.GetNamedString(L"language",L"ru")),fixture);
            voiceView=&v;voiceSession=session;SetTimer(control,7,50,nullptr);
        }else if(voice&&voiceView==&v&&session==voiceSession){if(action==L"stop")voice->Stop();else if(action==L"cancel")voice->Cancel();else throw std::runtime_error("voiceFailed");}
    }
    else if(type==L"window"){
        auto action=payload.GetNamedString(L"action");
        if(action==L"pin"){pinned=payload.GetNamedBoolean(L"pinned",!pinned);mainView.temporary=false;ApplyMode();SaveNative();Broadcast(L"nativeChanged",nativeSettings);}
        else if(action==L"hide"){if(v.quick)FinishQuick(false);else{mainView.temporary=false;ApplyMode();Hide(mainView);ReturnFocus(mainView);}}
        else if(action==L"show")ShowList();
        else if(action==L"recordShortcuts"&&!v.quick)RecordShortcuts(payload.GetNamedBoolean(L"enabled",false)&&GetForegroundWindow()==v.hwnd);
        else if(action==L"quick")Quick();
        else if(action==L"quickDone")FinishQuick();
        else if(action==L"drag"){++dragRequests;ReleaseCapture();PostMessageW(v.hwnd,WM_NCLBUTTONDOWN,HTCAPTION,0);}
        else if(action==L"resize"){int edge=int(payload.GetNamedNumber(L"edge",0));if((!v.quick&&edge>=WMSZ_LEFT&&edge<=WMSZ_BOTTOMRIGHT)||(v.quick&&(edge==WMSZ_LEFT||edge==WMSZ_RIGHT))){ReleaseCapture();PostMessageW(v.hwnd,WM_SYSCOMMAND,SC_SIZE+edge,0);}}
        else if(action==L"theme"){if(v.glass)v.glass->SetDark(payload.GetNamedBoolean(L"dark",false));}
        else if(action==L"diagnostics"&&harness){auto c=v.glass->GetCounters();RECT r{},client{},webBounds{};GetWindowRect(v.hwnd,&r);GetClientRect(v.hwnd,&client);if(v.controller)v.controller->get_Bounds(&webBounds);result.Insert(L"healthy",Bool(v.glass->Healthy()));result.Insert(L"copied",Number(double(c.copied)));result.Insert(L"rendered",Number(double(c.rendered)));result.Insert(L"recoveries",Number(double(c.recoveries)));result.Insert(L"errors",Number(double(c.errors)));result.Insert(L"error",JsonValue::CreateStringValue(to_hstring(v.glass->LastError())));result.Insert(L"captureApi",Text(L"Windows Graphics Capture + HLSL"));result.Insert(L"clientWidth",Number(client.right-client.left));result.Insert(L"clientHeight",Number(client.bottom-client.top));result.Insert(L"webWidth",Number(webBounds.right-webBounds.left));result.Insert(L"webHeight",Number(webBounds.bottom-webBounds.top));result.Insert(L"materialWidth",Number(c.width));result.Insert(L"materialHeight",Number(c.height));DWORD affinity{};GetWindowDisplayAffinity(v.hwnd,&affinity);result.Insert(L"captureFrozen",Bool(v.captureFrozen));result.Insert(L"displayAffinity",Number(affinity));result.Insert(L"powerSuspends",Number(double(powerSuspends)));result.Insert(L"powerResumes",Number(double(powerResumes)));result.Insert(L"dragRequests",Number(double(dragRequests)));result.Insert(L"quickDismissals",Number(double(quickDismissals)));result.Insert(L"traySingleClicks",Number(double(traySingleClicks)));result.Insert(L"trayDoubleClicks",Number(double(trayDoubleClicks)));result.Insert(L"visible",Bool(v.visible));result.Insert(L"windowVisible",Bool(IsWindowVisible(v.hwnd)));result.Insert(L"mainVisible",Bool(mainView.visible));result.Insert(L"mainWindowVisible",Bool(IsWindowVisible(mainView.hwnd)));result.Insert(L"x",Number(r.left));result.Insert(L"y",Number(r.top));result.Insert(L"width",Number(r.right-r.left));result.Insert(L"height",Number(r.bottom-r.top));result.Insert(L"iconic",Bool(IsIconic(v.hwnd)));result.Insert(L"window",Number(double(reinterpret_cast<UINT_PTR>(v.hwnd))));result.Insert(L"controlWindow",Number(double(reinterpret_cast<UINT_PTR>(control))));result.Insert(L"owner",Number(double(reinterpret_cast<UINT_PTR>(GetWindow(v.hwnd,GW_OWNER)))));result.Insert(L"previous",Number(double(reinterpret_cast<UINT_PTR>(v.previous))));result.Insert(L"foreground",Number(double(reinterpret_cast<UINT_PTR>(GetForegroundWindow()))));}
        else if(action==L"pacingDiagnostics"&&harness){
            const auto c=v.glass->GetCounters();RECT r{};GetWindowRect(v.hwnd,&r);
            DWM_TIMING_INFO timing{sizeof(timing)};const auto timingOk=SUCCEEDED(DwmGetCompositionTimingInfo(nullptr,&timing));
            result.Insert(L"rendered",Number(double(c.rendered)));result.Insert(L"copied",Number(double(c.copied)));
            result.Insert(L"cropX",Number(c.cropX));result.Insert(L"cropY",Number(c.cropY));
            result.Insert(L"windowX",Number(r.left));result.Insert(L"windowY",Number(r.top));
            result.Insert(L"lastSubmitMs",Number(c.lastSubmitMs));result.Insert(L"lastRenderWorkMs",Number(c.lastRenderWorkMs));
            result.Insert(L"displayHz",Number(timingOk&&timing.rateRefresh.uiDenominator?double(timing.rateRefresh.uiNumerator)/timing.rateRefresh.uiDenominator:0));
            result.Insert(L"healthy",Bool(v.glass->Healthy()));result.Insert(L"errors",Number(double(c.errors)));
        }
        // Material readback supports a transparent two-layer harness screenshot.
        else if(action==L"screenshotKeys"&&harness){
            auto keys=screenshotKeys?screenshotKeys->GetCounters():delo::ScreenshotKeys::Counters{};
            result.Insert(L"installed",Bool(keys.installed));result.Insert(L"installError",Number(keys.installError));
            result.Insert(L"requested",Number(double(keys.requested)));result.Insert(L"prepared",Number(double(keys.prepared)));
            result.Insert(L"timeouts",Number(double(keys.timeouts)));result.Insert(L"postFailures",Number(double(keys.postFailures)));
            result.Insert(L"lastWaitMs",Number(keys.lastWaitMs));
            result.Insert(L"lastPrepareStartMs",Number(keys.lastPrepareStartMs));result.Insert(L"lastPrepareWorkMs",Number(keys.lastPrepareWorkMs));result.Insert(L"latePrepared",Number(double(keys.latePrepared)));
            result.Insert(L"mouseInstalled",Bool(keys.mouseInstalled));result.Insert(L"mouseInstallError",Number(keys.mouseInstallError));
            result.Insert(L"trayRequested",Number(double(keys.trayRequested)));result.Insert(L"trayPrepared",Number(double(keys.trayPrepared)));result.Insert(L"skipped",Number(double(keys.skipped)));
            const auto lightshotKey=lightshotTray?lightshotTray->ConfiguredHotkey():0;
            result.Insert(L"lightshotKey",Number(lightshotKey&255));result.Insert(L"lightshotModifiers",Number(lightshotKey>>8));
            result.Insert(L"lightshotRunning",Bool(lightshotTray&&lightshotTray->Running()));result.Insert(L"trayAutomationReady",Bool(lightshotTray&&lightshotTray->AutomationReady()));
            result.Insert(L"lastTrayQueryMs",Number(lightshotTray?lightshotTray->LastQueryMs():0));result.Insert(L"lastTrayQueryMatched",Bool(lightshotTray&&lightshotTray->LastQueryMatched()));
        }
        else if(action==L"materialShot"&&harness){auto target=payload.GetNamedString(L"path",L"");if(target.empty())throw std::runtime_error("materialShot requires a path");v.glass->SaveMaterial(std::wstring(target));result.Insert(L"written",Text(target.c_str()));}
        else if(action==L"freezeForScreenshot"&&harness)BeginScreenshot();
        else if(action==L"finishScreenshot"&&harness)FinishScreenshot();
        else if(action==L"autostart"){auto old=nativeSettings.GetNamedBoolean(L"autostart",false);auto enabled=payload.GetNamedBoolean(L"enabled");SetAutostart(enabled);nativeSettings.Insert(L"autostart",Bool(enabled));try{SaveNative();}catch(...){nativeSettings.Insert(L"autostart",Bool(old));try{SetAutostart(old);}catch(...){throw std::runtime_error("nativeRollbackError");}throw;}Broadcast(L"nativeChanged",nativeSettings);}
        else if(action==L"hotkeys"){auto old=nativeSettings.GetNamedObject(L"hotkeys");auto keys=payload.HasKey(L"hotkeys")?payload.GetNamedObject(L"hotkeys"):payload;try{RegisterKeys(keys.GetNamedString(L"list").c_str(),keys.GetNamedString(L"quick").c_str());}catch(...){try{RegisterKeys(old.GetNamedString(L"list").c_str(),old.GetNamedString(L"quick").c_str());}catch(...){}throw;}JsonObject saved;saved.Insert(L"list",keys.GetNamedValue(L"list"));saved.Insert(L"quick",keys.GetNamedValue(L"quick"));nativeSettings.Insert(L"hotkeys",saved);if(nativeSettings.HasKey(L"hotkeyError"))nativeSettings.Remove(L"hotkeyError");try{SaveNative();}catch(...){nativeSettings.Insert(L"hotkeys",old);try{RegisterKeys(old.GetNamedString(L"list").c_str(),old.GetNamedString(L"quick").c_str());}catch(...){throw std::runtime_error("nativeRollbackError");}throw;}Broadcast(L"nativeChanged",nativeSettings);}
        else if(action==L"sound"){MessageBeep(payload.GetNamedString(L"kind",L"complete")==L"complete"?MB_OK:MB_ICONEXCLAMATION);}
        else if(action==L"exit")RequestExit();
        else if(action==L"exitReady"){if(exiting)PostQuitMessage(0);}
        else if(action==L"cancelExit"){exiting=false;KillTimer(control,4);Focus(mainView);}
        else throw std::runtime_error("Unknown window action");
    }else throw std::runtime_error("Unknown bridge command");Reply(v,id,true,result);
}catch(hresult_error const& e){Reply(v,id,false,{},to_string(e.message()));}catch(std::exception const& e){Reply(v,id,false,{},e.what());}}

void CreateWebView(View& v){
    check_hresult(environment->CreateCoreWebView2Controller(v.hwnd,Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([&v](HRESULT hr,ICoreWebView2Controller* controller)->HRESULT{
        try{check_hresult(hr);v.controller.copy_from(controller);check_hresult(controller->get_CoreWebView2(v.web.put()));
            auto controller2=v.controller.as<ICoreWebView2Controller2>();check_hresult(controller2->put_DefaultBackgroundColor({0,0,0,0}));
            com_ptr<ICoreWebView2Settings> settings;v.web->get_Settings(settings.put());settings->put_AreDefaultContextMenusEnabled(FALSE);settings->put_AreDevToolsEnabled(harness);settings->put_IsStatusBarEnabled(FALSE);settings->put_IsZoomControlEnabled(FALSE);
            auto web3=v.web.as<ICoreWebView2_3>();check_hresult(web3->SetVirtualHostNameToFolderMapping(L"delo.local",appRoot.c_str(),COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY));
            EventRegistrationToken token{};
            v.web->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{LPWSTR uri{};args->get_Uri(&uri);std::wstring url(uri?uri:L"");CoTaskMemFree(uri);if(url.rfind(L"https://delo.local/",0)!=0)args->put_Cancel(TRUE);return S_OK;}).Get(),&token);
            v.web->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{args->put_Handled(TRUE);return S_OK;}).Get(),&token);
            v.web->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*,ICoreWebView2PermissionRequestedEventArgs* args)->HRESULT{args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);return S_OK;}).Get(),&token);
            v.web->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>([&v](ICoreWebView2*,ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT{LPWSTR source{},json{};args->get_Source(&source);std::wstring origin(source?source:L"");CoTaskMemFree(source);if(origin.rfind(L"https://delo.local/",0)!=0)return S_OK;args->get_WebMessageAsJson(&json);std::wstring request(json?json:L"{}");CoTaskMemFree(json);Handle(v,request);return S_OK;}).Get(),&token);
            v.web->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([&v](ICoreWebView2*,ICoreWebView2NavigationCompletedEventArgs* args)->HRESULT{BOOL success{};args->get_IsSuccess(&success);Log(v.quick?"quick_loaded":"main_loaded",success?"true":"false");if(v.quick&&!v.visible)v.controller->put_IsVisible(FALSE);return S_OK;}).Get(),&token);
            v.web->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>([&v](ICoreWebView2*,ICoreWebView2ProcessFailedEventArgs*)->HRESULT{Log("web_process_failed",v.quick?"quick":"main");v.web->Reload();return S_OK;}).Get(),&token);
            Layout(v);check_hresult(v.web->Navigate(v.quick?L"https://delo.local/ui/index.html?view=quick":L"https://delo.local/ui/index.html"));
        }catch(hresult_error const& e){Log("webview_error",to_string(e.message()));MessageBoxW(v.hwnd,e.message().c_str(),L"Delo — WebView2",MB_ICONERROR);}return S_OK;
    }).Get()));
}
LRESULT CALLBACK WindowProc(HWND hwnd,UINT message,WPARAM w,LPARAM l){
    auto* v=reinterpret_cast<View*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));
    if(message==WM_NCCREATE){v=static_cast<View*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(v));if(v)v->hwnd=hwnd;}
    if(message==WM_ERASEBKGND)return 1;
    if(message==WM_PAINT){PAINTSTRUCT p{};auto dc=BeginPaint(hwnd,&p);if(v&&(!v->glass||!v->glass->Healthy())){RECT r{};GetClientRect(hwnd,&r);auto brush=CreateSolidBrush(RGB(235,240,245));FillRect(dc,&r,brush);DeleteObject(brush);}EndPaint(hwnd,&p);return 0;}
    if(v){
        // WS_THICKFRAME leaves a 6-7px non-client band the app never draws into, and DWM
        // paints it as a square frame around the rounded glass. Claiming the whole window
        // as client area removes the band; sizing and the bottom-right grip below are
        // unaffected because both work off the client rect.
        if(message==WM_NCCALCSIZE&&w==TRUE)return 0;
        // The outer render loop cannot run inside Windows' modal move/size loop.
        // New WGC frames and geometry changes drive rendering. The slow timer only
        // retries a failed renderer while the normal outer loop is blocked.
        if(message==WM_ENTERSIZEMOVE){v->gesture=true;SetTimer(hwnd,1,250,nullptr);return 0;}
        if(message==WM_TIMER&&w==1){if(v->gesture&&v->glass&&!v->captureFrozen&&!v->glass->Healthy())v->glass->Tick();return 0;}
        // WM_MOVE/WM_SIZE already submit the freshest crop while Windows owns the
        // interactive loop. Processing an additional capture callback between two
        // geometry messages can block on the GPU detector and leave the material dead
        // at its old size. Keep capture callbacks for idle rendering only.
        if(message==delo::GlassFrameReadyMessage){if(v->visible&&v->glass&&!v->captureFrozen&&!v->gesture)v->glass->Tick();return 0;}
        // Keep WebView bounds, the Composition visual and HWND clipping region in sync
        // during the gesture, including before the pointer is released.
        if(message==WM_SIZE||message==WM_MOVE){
            if(v->controller)v->controller->NotifyParentWindowPositionChanged();
            if(message==WM_SIZE)Layout(*v);
            else if(v->gesture&&v->glass&&!v->captureFrozen)v->glass->Tick();
            return 0;
        }
        if(message==WM_DPICHANGED){auto r=reinterpret_cast<RECT*>(l);SetWindowPos(hwnd,nullptr,r->left,r->top,r->right-r->left,r->bottom-r->top,SWP_NOZORDER|SWP_NOACTIVATE);Layout(*v);return 0;}
        if(message==WM_ACTIVATE&&LOWORD(w)==WA_INACTIVE){
            if(!v->quick){RecordShortcuts(false);if(!pinned&&v->temporary&&v->visible&&!v->gesture&&!v->captureFrozen){v->temporary=false;ApplyMode();}}
            else if(v->visible&&!v->gesture&&!v->captureFrozen){DismissQuick();return 0;}
        }
        if(message==WM_GETMINMAXINFO){auto info=reinterpret_cast<MINMAXINFO*>(l);auto dpi=GetDpiForWindow(hwnd);if(v->quick){auto height=MulDiv(QuickHeightDip,dpi,96);info->ptMinTrackSize={MulDiv(296,dpi,96),height};info->ptMaxTrackSize.y=height;}else info->ptMinTrackSize={MulDiv(320,dpi,96),MulDiv(360,dpi,96)};return 0;}
        if(message==WM_EXITSIZEMOVE){KillTimer(hwnd,1);v->gesture=false;ClampWindow(*v);RECT r{};GetWindowRect(hwnd,&r);JsonObject bounds;bounds.Insert(L"x",Number(r.left));bounds.Insert(L"y",Number(r.top));bounds.Insert(L"width",Number(r.right-r.left));bounds.Insert(L"height",Number(r.bottom-r.top));nativeSettings.Insert(v->quick?L"quickPosition":L"bounds",bounds);try{SaveNative();}catch(std::exception const& e){Log("window_save_error",e.what());}Reposition(*v);return 0;}
        if(message==WM_CLOSE){if(v->quick)FinishQuick();else Hide(*v);return 0;}
        // With the non-client band gone, map sizing edges inside the client rect. Quick
        // capture has a fixed compact height, so its entire left/right edges resize only
        // horizontally, including the corners.
        if(message==WM_NCHITTEST){auto hit=DefWindowProcW(hwnd,message,w,l);if(hit==HTCLIENT){POINT p{GET_X_LPARAM(l),GET_Y_LPARAM(l)};ScreenToClient(hwnd,&p);RECT r{};GetClientRect(hwnd,&r);auto dpi=GetDpiForWindow(hwnd);int edge=MulDiv(v->quick?4:10,dpi,96),corner=MulDiv(24,dpi,96);bool left=p.x<edge,right=p.x>=r.right-edge;if(v->quick){if(left)return HTLEFT;if(right)return HTRIGHT;return hit;}bool top=p.y<edge,bottom=p.y>=r.bottom-edge,cornerLeft=p.x<corner,cornerRight=p.x>=r.right-corner,cornerTop=p.y<corner,cornerBottom=p.y>=r.bottom-corner;if(cornerLeft&&cornerTop)return HTTOPLEFT;if(cornerRight&&cornerTop)return HTTOPRIGHT;if(cornerLeft&&cornerBottom)return HTBOTTOMLEFT;if(cornerRight&&cornerBottom)return HTBOTTOMRIGHT;if(left)return HTLEFT;if(right)return HTRIGHT;if(top)return HTTOP;if(bottom)return HTBOTTOM;}return hit;}
        if(message==WM_DESTROY){v->glass.reset();if(v->controller)v->controller->Close();v->controller=nullptr;v->web=nullptr;v->hwnd=nullptr;return 0;}
    }
    if(hwnd==control){
        if(message==WM_TIMER&&w==7){
            if(voice){
                // Snapshot completion before draining to avoid losing a terminal update.
                bool finished=!voice->Busy();
                for(auto const& update:voice->Take())if(voiceView){JsonObject p;p.Insert(L"session",Text(voiceSession.c_str()));p.Insert(L"state",Text(to_hstring(update.state).c_str()));p.Insert(L"text",Text(to_hstring(update.text).c_str()));p.Insert(L"error",Text(to_hstring(update.error).c_str()));Event(*voiceView,L"voiceState",p);}
                if(finished){KillTimer(control,7);voiceView=nullptr;voiceSession=L"";}
            }return 0;
        }
        if((message==WM_POWERBROADCAST&&w==PBT_APMSUSPEND)||(message==WM_WTSSESSION_CHANGE&&w==WTS_SESSION_LOCK)||message==WM_QUERYENDSESSION)CancelVoice();
        if(message==delo::ScreenshotKeys::PrepareMessage){
            if(!screenshotKeys)return 0;
            if(!w){Log("screenshot_keys_timeout",std::to_string(screenshotKeys->GetCounters().timeouts));return 0;}
            if(!screenshotKeys->Pending(w))return 0;
            if(l==delo::LightshotTray::QueryPoint){
                if(lightshotTray)lightshotTray->Query(w,screenshotKeys->MousePoint(),screenshotKeys->Deadline());
                else screenshotKeys->Complete(w,false);
                return 0;
            }
            if(l==delo::LightshotTray::PointDoesNotMatch){screenshotKeys->Complete(w,false);return 0;}
            // A UIA result may arrive after the hook's deadline; Pending above
            // rejects that result before it can freeze the renderer or touch affinity.
            try{const auto start=GetTickCount64();screenshotKeys->RecordPrepareStarted();BeginScreenshot();screenshotKeys->RecordPrepareFinished(w,start);screenshotKeys->Complete(w);}
            catch(hresult_error const& e){Log("screenshot_keys_prepare_error",to_string(e.message()));}
            catch(std::exception const& e){Log("screenshot_keys_prepare_error",e.what());}
            return 0;
        }
        if(message==taskbarCreated){Tray();if(mainView.hwnd)ApplyMode();return 0;}
        if(message==ShowMessage){ShowList();return 0;}
        if(message==WM_HOTKEY){if(w==1)ShowList();else if(w==2)Quick();return 0;}
        if(message==WM_DISPLAYCHANGE){if(mainView.hwnd)ClampWindow(mainView);if(quickView.hwnd)ClampWindow(quickView);if(mainView.glass)mainView.glass->Rebuild();if(quickView.glass)quickView.glass->Rebuild();return 0;}
        if(message==WM_POWERBROADCAST||message==WM_WTSSESSION_CHANGE){bool suspend=(message==WM_POWERBROADCAST&&w==PBT_APMSUSPEND)||(message==WM_WTSSESSION_CHANGE&&w==WTS_SESSION_LOCK);bool resume=(message==WM_POWERBROADCAST&&w==PBT_APMRESUMEAUTOMATIC)||(message==WM_WTSSESSION_CHANGE&&w==WTS_SESSION_UNLOCK);if(suspend){++powerSuspends;Log("power_suspend",message==WM_POWERBROADCAST?"system":"session");Broadcast(L"suspend");if(mainView.glass)mainView.glass->Suspend(true);if(quickView.glass)quickView.glass->Suspend(true);}if(resume){++powerResumes;Log("power_resume",message==WM_POWERBROADCAST?"system":"session");if(mainView.glass)mainView.glass->Suspend(false);if(quickView.glass)quickView.glass->Suspend(false);Broadcast(L"resume");}return TRUE;}
        if(message==WM_QUERYENDSESSION){Broadcast(L"suspend");return TRUE;}
        if(message==WM_ENDSESSION&&w){PostQuitMessage(0);return 0;}
        // A new press always starts a new gesture: a double click whose final button-up was
        // released away from the icon must not swallow the next genuine click.
        if(message==TrayMessage){if(l==WM_LBUTTONDOWN)ignoreTrayButtonUp=false;else if(l==WM_LBUTTONDBLCLK){ignoreTrayButtonUp=true;++trayDoubleClicks;}else if(l==WM_LBUTTONUP){if(ignoreTrayButtonUp)ignoreTrayButtonUp=false;else{++traySingleClicks;Quick();}}if(l==WM_RBUTTONUP||l==WM_CONTEXTMENU){auto language=store&&store->State()?store->State().GetNamedObject(L"settings",JsonObject{}).GetNamedString(L"language",L"ru"):hstring(L"ru");auto menu=CreatePopupMenu();AppendMenuW(menu,MF_STRING,1,TrayLabel(language.c_str(),1));AppendMenuW(menu,MF_STRING,2,TrayLabel(language.c_str(),2));AppendMenuW(menu,MF_STRING,4,TrayLabel(language.c_str(),4));AppendMenuW(menu,MF_SEPARATOR,0,nullptr);AppendMenuW(menu,MF_STRING,3,TrayLabel(language.c_str(),3));POINT p{};GetCursorPos(&p);SetForegroundWindow(control);auto cmd=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_RIGHTBUTTON,p.x,p.y,0,control,nullptr);DestroyMenu(menu);if(cmd==1)ShowList();if(cmd==2)Quick();if(cmd==3)RequestExit();if(cmd==4){try{BeginScreenshot();}catch(hresult_error const& e){Log("screenshot_error",to_string(e.message()));MessageBoxW(mainView.hwnd,e.message().c_str(),L"Delo",MB_ICONERROR);}}}return 0;}
        if(message==WM_TIMER&&w==4){KillTimer(control,4);exiting=false;Focus(mainView);Event(mainView,L"exitFailed");Log("exit_cancelled","No save acknowledgement");return 0;}
        if(message==WM_TIMER&&w==5){try{FinishScreenshot();}catch(hresult_error const& e){Log("screenshot_restore_error",to_string(e.message()));SetTimer(control,5,1000,nullptr);}return 0;}
    }
    return DefWindowProcW(hwnd,message,w,l);
}
void CreateWindowFor(View& v){auto dpi=GetDpiForSystem();int width=MulDiv(v.quick?414:420,dpi,96),height=MulDiv(v.quick?QuickHeightDip:620,dpi,96);int x=100,y=120;auto key=v.quick?L"quickPosition":L"bounds";if(nativeSettings.HasKey(key)){auto b=nativeSettings.GetNamedObject(key);x=int(b.GetNamedNumber(L"x",x));y=int(b.GetNamedNumber(L"y",y));width=std::clamp(int(b.GetNamedNumber(L"width",width)),v.quick?296:320,2400);if(v.quick){auto savedHeight=int(b.GetNamedNumber(L"height",height));if(savedHeight!=height){y+=(savedHeight-height)/2;b.Insert(L"y",Number(y));b.Insert(L"height",Number(height));nativeSettings.Insert(key,b);try{SaveNative();}catch(std::exception const& e){Log("quick_height_save_error",e.what());}}}else height=std::clamp(int(b.GetNamedNumber(L"height",height)),360,2400);}
    auto style=DWORD(WS_POPUP|WS_THICKFRAME);auto hwnd=CreateWindowExW(WS_EX_TOOLWINDOW|WS_EX_NOREDIRECTIONBITMAP,ClassName,v.quick?L"Delo Quick":L"Delo",style,x,y,width,height,nullptr,nullptr,appInstance,&v);if(!hwnd)throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
    // Windows 11 still strokes a 1px border outside the client area; DWMWA_COLOR_NONE
    // drops it so nothing squares off the rounded corners.
    {COLORREF borderNone=DWMWA_COLOR_NONE;DwmSetWindowAttribute(hwnd,DWMWA_BORDER_COLOR,&borderNone,sizeof(borderNone));}
    ClampWindow(v);v.glass=std::make_unique<delo::GlassRenderer>(hwnd,appRoot/L"Glass.hlsl");if(v.quick){v.visible=false;SetWindowPos(hwnd,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);}else{ApplyMode();ShowWindow(hwnd,SW_SHOWNOACTIVATE);}if(environment)CreateWebView(v);
}
int WINAPI wWinMain(HINSTANCE module,HINSTANCE,PWSTR args,int){appInstance=module;try{
    init_apartment(apartment_type::single_threaded);SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    wchar_t path[32768]{};GetModuleFileNameW(nullptr,path,32768);appRoot=fs::path(path).parent_path();harness=wcsstr(args,L"--harness")!=nullptr;
    PWSTR local{};check_hresult(SHGetKnownFolderPath(FOLDERID_LocalAppData,0,nullptr,&local));dataRoot=fs::path(local)/L"Delo";CoTaskMemFree(local);if(harness){dataRoot=appRoot/L"test-output";auto named=wcsstr(args,L"--harness=");if(named){std::wstring name(named+10);// The rest of the command line is not the name: shells routinely leave a trailing space, and another argument may follow. Take the token and nothing else, otherwise a stray space refuses the launch with only "Invalid harness session name" to show for it.
        if(auto end=name.find_first_of(L" \t\"");end!=std::wstring::npos)name.erase(end);
        if(name.empty()||name.size()>64||name.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")!=std::wstring::npos)throw std::runtime_error("Invalid harness session name");dataRoot/=L"sessions";dataRoot/=name;}}fs::create_directories(dataRoot);trace.open(dataRoot/L"native.jsonl",std::ios::app);
    auto mutexName=harness?L"Local\\Delo.Widget.Harness":L"Local\\Delo.Widget";winrt::handle mutex{CreateMutexW(nullptr,FALSE,mutexName)};if(GetLastError()==ERROR_ALREADY_EXISTS){auto other=FindWindowW(ClassName,harness?L"Delo.Harness.Control":L"Delo.Control");if(other)PostMessageW(other,ShowMessage,0,0);return 0;}
    if(fs::exists(dataRoot/L"window.json")){try{nativeSettings=JsonObject::Parse(to_hstring(delo::ReadBytes(dataRoot/L"window.json")));}catch(...){Log("settings_error","Using defaults; original preserved");}}
    pinned=nativeSettings.GetNamedBoolean(L"pinned",false);nativeSettings.Insert(L"pinned",Bool(pinned));if(!nativeSettings.HasKey(L"autostart"))nativeSettings.Insert(L"autostart",Bool(false));if(!nativeSettings.HasKey(L"hotkeys")){JsonObject keys;keys.Insert(L"list",Text(L"Ctrl+Alt+Space"));keys.Insert(L"quick",Text(L"Ctrl+Alt+N"));nativeSettings.Insert(L"hotkeys",keys);}
    if(!nativeSettings.GetNamedBoolean(L"quickFrameReduced",false)){if(nativeSettings.HasKey(L"quickPosition")){auto b=nativeSettings.GetNamedObject(L"quickPosition");if(b.HasKey(L"width")&&b.HasKey(L"height")){auto oldWidth=int(b.GetNamedNumber(L"width")),oldHeight=int(b.GetNamedNumber(L"height"));auto width=std::max(1,MulDiv(oldWidth,985,1000)),height=std::max(1,MulDiv(oldHeight,985,1000));b.Insert(L"x",Number(b.GetNamedNumber(L"x",100)+(oldWidth-width)/2));b.Insert(L"y",Number(b.GetNamedNumber(L"y",120)+(oldHeight-height)/2));b.Insert(L"width",Number(width));b.Insert(L"height",Number(height));nativeSettings.Insert(L"quickPosition",b);}}nativeSettings.Insert(L"quickFrameReduced",Bool(true));try{SaveNative();}catch(std::exception const& e){Log("quick_frame_save_error",e.what());}}
    store=std::make_unique<delo::Store>(dataRoot/L"tasks.json");try{store->Load();}catch(...){storageError="dataCorrupt: Local data is damaged. Restore the backup; original data will be retained.";Log("storage_error",storageError);}
    WNDCLASSW wc{};wc.lpfnWndProc=WindowProc;wc.hInstance=appInstance;wc.lpszClassName=ClassName;wc.hCursor=LoadCursorW(nullptr,IDC_ARROW);wc.hIcon=AppIcon();RegisterClassW(&wc);control=CreateWindowExW(WS_EX_TOOLWINDOW,ClassName,harness?L"Delo.Harness.Control":L"Delo.Control",WS_POPUP,0,0,0,0,nullptr,nullptr,appInstance,nullptr);if(!control)throw hresult_error(E_FAIL);
    taskbarCreated=RegisterWindowMessageW(L"TaskbarCreated");Tray();powerNotify=RegisterSuspendResumeNotification(control,DEVICE_NOTIFY_WINDOW_HANDLE);WTSRegisterSessionNotification(control,NOTIFY_FOR_THIS_SESSION);
    try{
        auto keys=nativeSettings.GetNamedObject(L"hotkeys");
        RegisterKeys(keys.GetNamedString(L"list").c_str(),keys.GetNamedString(L"quick").c_str());
        // A message from an earlier launch outlives the problem it described: the
        // combination validates now, so the banner must not come back next time.
        if(nativeSettings.HasKey(L"hotkeyError")){nativeSettings.Remove(L"hotkeyError");
            try{SaveNative();}catch(std::exception const& save){Log("hotkey_clear_save_error",save.what());}}
    }
    catch(std::exception const& e){
        // A stored combination that stops validating must not leave the widget with
        // no way back: once it is hidden to the tray the hotkeys are how it returns.
        // Fall back to the defaults, persist them so settings show what is live, and
        // keep the message so the change is explained instead of silent.
        try{
            RegisterKeys(L"Ctrl+Alt+Space",L"Ctrl+Alt+N");
            JsonObject fallback;fallback.Insert(L"list",Text(L"Ctrl+Alt+Space"));fallback.Insert(L"quick",Text(L"Ctrl+Alt+N"));
            nativeSettings.Insert(L"hotkeys",fallback);
            // A message left over from a previous launch would otherwise be written
            // back out with the repaired keys and keep the banner coming forever.
            if(nativeSettings.HasKey(L"hotkeyError"))nativeSettings.Remove(L"hotkeyError");
            try{SaveNative();}catch(std::exception const& save){Log("hotkey_fallback_save_error",save.what());}
            Log("hotkey_fallback","Ctrl+Alt+Space / Ctrl+Alt+N");
        }catch(std::exception const& second){Log("hotkey_fallback_failed",second.what());}
        // The message belongs to this launch only. Persisting it made the banner reappear
        // on every start even though the fallback had already produced working shortcuts,
        // so it is set after the file is written and never saved.
        nativeSettings.Insert(L"hotkeyError",JsonValue::CreateStringValue(to_hstring(e.what())));
    }
    if(harness)SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",L"--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1");
    quickView.quick=true;CreateWindowFor(mainView);CreateWindowFor(quickView);
    try{lightshotTray=std::make_unique<delo::LightshotTray>(control,delo::ScreenshotKeys::PrepareMessage);}
    catch(std::exception const& e){Log("lightshot_tray_init_error",e.what());}
    try{screenshotKeys=std::make_unique<delo::ScreenshotKeys>(control,lightshotTray.get());auto keys=screenshotKeys->GetCounters();if(!keys.installed)Log("screenshot_keys_install_error",std::to_string(keys.installError));if(lightshotTray&&!keys.mouseInstalled)Log("screenshot_mouse_install_error",std::to_string(keys.mouseInstallError));}
    catch(std::exception const& e){Log("screenshot_keys_install_error",e.what());}
    check_hresult(CreateCoreWebView2EnvironmentWithOptions(nullptr,(dataRoot/L"WebView2").c_str(),nullptr,Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([](HRESULT hr,ICoreWebView2Environment* env)->HRESULT{if(FAILED(hr)){MessageBoxW(mainView.hwnd,L"Install Microsoft Edge WebView2 Runtime to run Delo.",L"Delo",MB_ICONERROR);PostQuitMessage(1);return S_OK;}environment.copy_from(env);CreateWebView(mainView);CreateWebView(quickView);return S_OK;}).Get()));
    auto ownerCheck=GetTickCount64();bool running=true;int exitCode{};
    while(running){MSG msg{};while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){if(msg.message==WM_QUIT){running=false;exitCode=int(msg.wParam);break;}TranslateMessage(&msg);DispatchMessageW(&msg);}if(!running)break;
        for(auto* v:{&mainView,&quickView}){if(v->hwnd&&v->visible&&v->glass&&!v->captureFrozen){v->glass->Tick();auto healthy=v->glass->Healthy();if(healthy!=v->lastHealthy){v->lastHealthy=healthy;JsonObject p;p.Insert(L"available",Bool(healthy));Event(*v,L"material",p);InvalidateRect(v->hwnd,nullptr,TRUE);}}}
        if(GetTickCount64()-ownerCheck>2000){ownerCheck=GetTickCount64();if(!mainView.hwnd&&!exiting){CreateWindowFor(mainView);Log("window_recreated","true");}if(mainView.hwnd&&!pinned&&!mainView.temporary){auto owner=GetWindow(mainView.hwnd,GW_OWNER);if(!IsWindow(owner))ApplyMode();}}
        HANDLE handles[2]{};DWORD count{};for(auto* v:{&mainView,&quickView})if(v->visible&&v->glass&&v->glass->EventHandle())handles[count++]=v->glass->EventHandle();MsgWaitForMultipleObjectsEx(count,handles,50,QS_ALLINPUT,MWMO_INPUTAVAILABLE);
    }
    voice.reset();
    screenshotKeys.reset();
    lightshotTray.reset();
    NOTIFYICONDATAW n{sizeof(n)};n.hWnd=control;n.uID=1;Shell_NotifyIconW(NIM_DELETE,&n);UnregisterHotKey(control,1);UnregisterHotKey(control,2);if(powerNotify)UnregisterSuspendResumeNotification(powerNotify);WTSUnRegisterSessionNotification(control);if(mainView.hwnd)DestroyWindow(mainView.hwnd);if(quickView.hwnd)DestroyWindow(quickView.hwnd);DestroyWindow(control);return exitCode;
}catch(hresult_error const& e){MessageBoxW(nullptr,e.message().c_str(),L"Delo",MB_ICONERROR);return 1;}catch(std::exception const& e){MessageBoxW(nullptr,to_hstring(e.what()).c_str(),L"Delo",MB_ICONERROR);return 1;}}
