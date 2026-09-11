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
#include "resource.h"

using Microsoft::WRL::Callback;
using namespace winrt;
using namespace winrt::Windows::Data::Json;
namespace fs=std::filesystem;
constexpr UINT TrayMessage=WM_APP+1, ShowMessage=WM_APP+2;
constexpr wchar_t ClassName[]=L"Delo.Widget.Host";
struct View {
    HWND hwnd{};bool quick{},temporary{},visible{true},captureFrozen{},gesture{};HWND previous{};
    com_ptr<ICoreWebView2Controller> controller;com_ptr<ICoreWebView2> web;
    std::unique_ptr<delo::GlassRenderer> glass;bool lastHealthy{true};
};
HINSTANCE appInstance;HWND control{};View mainView,quickView;HWND desktopOwner{};
com_ptr<ICoreWebView2Environment> environment;std::unique_ptr<delo::Store> store;
fs::path appRoot,dataRoot;JsonObject nativeSettings;std::string storageError;
bool pinned{},exiting{},harness{};UINT taskbarCreated{};HPOWERNOTIFY powerNotify{};
std::uint64_t powerSuspends{},powerResumes{};
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
void ApplyMode(){if(!mainView.hwnd)return;auto top=pinned||mainView.temporary;auto owner=top?nullptr:Desktop();SetLastError(0);auto prior=SetWindowLongPtrW(mainView.hwnd,GWLP_HWNDPARENT,reinterpret_cast<LONG_PTR>(owner));if(!prior&&GetLastError())Log("owner_error",std::to_string(GetLastError()));SetWindowPos(mainView.hwnd,top?HWND_TOPMOST:HWND_NOTOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_FRAMECHANGED);}
void ClampWindow(View& v){RECT r{};GetWindowRect(v.hwnd,&r);auto mon=MonitorFromRect(&r,MONITOR_DEFAULTTONEAREST);MONITORINFO mi{sizeof(mi)};GetMonitorInfoW(mon,&mi);int width=std::min(r.right-r.left,mi.rcWork.right-mi.rcWork.left),height=std::min(r.bottom-r.top,mi.rcWork.bottom-mi.rcWork.top);int x=std::clamp(r.left,mi.rcWork.left,mi.rcWork.right-width),y=std::clamp(r.top,mi.rcWork.top,mi.rcWork.bottom-height);SetWindowPos(v.hwnd,nullptr,x,y,width,height,SWP_NOZORDER|SWP_NOACTIVATE);}
void Bounds(View& v){if(v.controller){RECT r{};GetClientRect(v.hwnd,&r);v.controller->put_Bounds(r);v.controller->NotifyParentWindowPositionChanged();}}
void Layout(View& v){Bounds(v);if(v.glass)v.glass->Resize();}
// Layout plus one immediate frame, for the end of a gesture: the material has been held
// since the button went down and should be live again before the next paint.
void Reposition(View& v){Layout(v);if(v.glass)v.glass->Tick();}
void Hide(View& v){v.visible=false;ShowWindow(v.hwnd,SW_HIDE);if(v.controller)v.controller->put_IsVisible(FALSE);JsonObject p;p.Insert(L"visible",Bool(false));Event(v,L"visibility",p);}
void Focus(View& v){v.visible=true;ShowWindow(v.hwnd,SW_SHOW);if(v.controller){v.controller->put_IsVisible(TRUE);v.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);}SetForegroundWindow(v.hwnd);JsonObject p;p.Insert(L"visible",Bool(true));Event(v,L"visibility",p);}
void ReturnFocus(View& v){if(IsWindow(v.previous))SetForegroundWindow(v.previous);v.previous=nullptr;}
void Quick(){if(!quickView.visible)quickView.previous=GetForegroundWindow();Focus(quickView);Event(quickView,L"focusQuick");}
void ShowList(){
    // Opening the list dismisses quick capture: the two are the same job on one screen,
    // and leaving the capture capsule floating over the list looked like a stuck window.
    if(quickView.hwnd&&quickView.visible)Hide(quickView);
    if(mainView.temporary&&IsWindowVisible(mainView.hwnd)){mainView.temporary=false;ApplyMode();ReturnFocus(mainView);}else{mainView.previous=GetForegroundWindow();mainView.temporary=true;ApplyMode();Focus(mainView);}}
HICON AppIcon(bool smallIcon=false){return static_cast<HICON>(LoadImageW(appInstance,MAKEINTRESOURCEW(IDI_DELO),IMAGE_ICON,smallIcon?GetSystemMetrics(SM_CXSMICON):0,smallIcon?GetSystemMetrics(SM_CYSMICON):0,LR_DEFAULTCOLOR|LR_SHARED));}
void Tray(){NOTIFYICONDATAW n{sizeof(n)};n.hWnd=control;n.uID=1;n.uFlags=NIF_MESSAGE|NIF_ICON|NIF_TIP;n.uCallbackMessage=TrayMessage;n.hIcon=AppIcon(true);wcscpy_s(n.szTip,L"Delo");Shell_NotifyIconW(NIM_ADD,&n);}
void RegisterKeys(std::wstring const& list,std::wstring const& quick){auto a=ParseHotkey(list),b=ParseHotkey(quick);if(a.key==b.key&&a.modifiers==b.modifiers)throw std::runtime_error("Hotkeys must be different");UnregisterHotKey(control,1);UnregisterHotKey(control,2);if(!RegisterHotKey(control,1,a.modifiers,a.key)||!RegisterHotKey(control,2,b.modifiers,b.key)){UnregisterHotKey(control,1);UnregisterHotKey(control,2);throw std::runtime_error("Hotkey is already used by another application; choose another combination");}}
void SetAutostart(bool enabled){if(harness){Log("autostart_simulated",enabled?"true":"false");return;}HKEY raw{};check_hresult(HRESULT_FROM_WIN32(RegCreateKeyExW(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",0,nullptr,0,KEY_SET_VALUE,nullptr,&raw,nullptr)));auto exe=appRoot/L"Delo.exe";auto value=L"\""+exe.wstring()+L"\"";LSTATUS error=enabled?RegSetValueExW(raw,L"Delo",0,REG_SZ,reinterpret_cast<BYTE const*>(value.c_str()),DWORD((value.size()+1)*sizeof(wchar_t))):RegDeleteValueW(raw,L"Delo");RegCloseKey(raw);if(error!=ERROR_SUCCESS&&error!=ERROR_FILE_NOT_FOUND)throw std::runtime_error("Could not change autostart");}
void RequestExit(){if(exiting)return;exiting=true;Broadcast(L"beforeExit");SetTimer(control,4,20000,nullptr);}
void Reply(View& v,IJsonValue const& id,bool ok,JsonObject const& result,std::string const& error={}){JsonObject response;response.Insert(L"id",id);response.Insert(L"ok",Bool(ok));if(ok)response.Insert(L"result",result);else response.Insert(L"error",JsonValue::CreateStringValue(to_hstring(error)));Send(v,response);}
void Handle(View& v,std::wstring const& json){IJsonValue id=JsonValue::CreateNullValue();try{auto request=JsonObject::Parse(json);id=request.GetNamedValue(L"id");auto type=request.GetNamedString(L"type");auto payload=request.GetNamedObject(L"payload",JsonObject{});JsonObject result;
    if(type==L"clock"){result.Insert(L"monotonicMs",Number(MonotonicMs()));}
    else if(type==L"load"){if(!storageError.empty())throw std::runtime_error(storageError);result.Insert(L"state",store->State()?store->State().as<IJsonValue>():JsonValue::CreateNullValue());result.Insert(L"revision",Number(double(store->Revision())));result.Insert(L"native",nativeSettings);result.Insert(L"monotonicMs",Number(MonotonicMs()));}
    else if(type==L"save"){auto expected=payload.GetNamedNumber(L"revision",-1);if(expected<0)throw std::runtime_error("Missing revision");auto revision=store->Save(payload.GetNamedObject(L"state"),uint64_t(expected));result.Insert(L"revision",Number(double(revision)));JsonObject changed;changed.Insert(L"state",store->State());changed.Insert(L"revision",Number(double(revision)));Reply(v,id,true,result);if(&v!=&mainView)Event(mainView,L"stateChanged",changed);if(&v!=&quickView)Event(quickView,L"stateChanged",changed);return;}
    else if(type==L"restoreBackup"){store->RestoreBackup();storageError.clear();result.Insert(L"state",store->State());result.Insert(L"revision",Number(double(store->Revision())));Broadcast(L"stateChanged",result);}
    else if(type==L"window"){
        auto action=payload.GetNamedString(L"action");
        if(action==L"pin"){pinned=payload.GetNamedBoolean(L"pinned",!pinned);mainView.temporary=false;ApplyMode();SaveNative();Broadcast(L"nativeChanged",nativeSettings);}
        else if(action==L"hide"){if(mainView.temporary){mainView.temporary=false;ApplyMode();ReturnFocus(mainView);}else Hide(v);}
        else if(action==L"show")ShowList();
        else if(action==L"quick")Quick();
        else if(action==L"quickDone"){Hide(quickView);ReturnFocus(quickView);}
        else if(action==L"drag"){ReleaseCapture();PostMessageW(v.hwnd,WM_NCLBUTTONDOWN,HTCAPTION,0);}
        else if(action==L"theme"){if(v.glass)v.glass->SetDark(payload.GetNamedBoolean(L"dark",false));}
        else if(action==L"diagnostics"&&harness){auto c=v.glass->GetCounters();result.Insert(L"healthy",Bool(v.glass->Healthy()));result.Insert(L"copied",Number(double(c.copied)));result.Insert(L"rendered",Number(double(c.rendered)));result.Insert(L"recoveries",Number(double(c.recoveries)));result.Insert(L"errors",Number(double(c.errors)));result.Insert(L"error",JsonValue::CreateStringValue(to_hstring(v.glass->LastError())));result.Insert(L"powerSuspends",Number(double(powerSuspends)));result.Insert(L"powerResumes",Number(double(powerResumes)));result.Insert(L"visible",Bool(v.visible));result.Insert(L"windowVisible",Bool(IsWindowVisible(v.hwnd)));result.Insert(L"iconic",Bool(IsIconic(v.hwnd)));result.Insert(L"window",Number(double(reinterpret_cast<UINT_PTR>(v.hwnd))));result.Insert(L"owner",Number(double(reinterpret_cast<UINT_PTR>(GetWindow(v.hwnd,GW_OWNER)))));result.Insert(L"previous",Number(double(reinterpret_cast<UINT_PTR>(v.previous))));result.Insert(L"foreground",Number(double(reinterpret_cast<UINT_PTR>(GetForegroundWindow()))));}
        else if(action==L"freezeForScreenshot"&&harness){v.captureFrozen=true;check_hresult(SetWindowDisplayAffinity(v.hwnd,WDA_NONE)?S_OK:E_FAIL);SetTimer(control,5,5000,nullptr);}
        else if(action==L"finishScreenshot"&&harness){check_hresult(SetWindowDisplayAffinity(v.hwnd,WDA_EXCLUDEFROMCAPTURE)?S_OK:E_FAIL);v.glass->Rebuild();v.captureFrozen=false;}
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
        // Dragging runs Windows' own modal loop, so the app's message loop — and with it
        // GlassRenderer::Tick — stops for the whole gesture. Trying to keep the material
        // live from inside that loop is a dead end: a capture, a GPU readback and a
        // vblank-synced Present per frame starve the move loop, and the backdrop crop is
        // always a frame behind where DWM has already put the window, which reads as the
        // panel flickering against its own frame. So the material is frozen instead — the
        // last good frame travels with the window as one rigid pane, the way the platform
        // materials on macOS and iOS behave — and live refraction resumes on release.
        if(message==WM_ENTERSIZEMOVE){v->gesture=true;if(v->glass)v->glass->Freeze(true);return 0;}
        // The web layer keeps following the window while a resize gesture is in flight —
        // it costs nothing and the list has to reflow under the cursor. Only the material
        // stays frozen, stretched to the new bounds until the button comes up.
        if(message==WM_SIZE||message==WM_MOVE){
            if(v->controller)v->controller->NotifyParentWindowPositionChanged();
            if(message==WM_SIZE){if(v->gesture){Bounds(*v);if(v->glass)v->glass->Stretch();}else Layout(*v);}
            return 0;
        }
        if(message==WM_DPICHANGED){auto r=reinterpret_cast<RECT*>(l);SetWindowPos(hwnd,nullptr,r->left,r->top,r->right-r->left,r->bottom-r->top,SWP_NOZORDER|SWP_NOACTIVATE);Layout(*v);return 0;}
        if(message==WM_GETMINMAXINFO){auto info=reinterpret_cast<MINMAXINFO*>(l);auto dpi=GetDpiForWindow(hwnd);info->ptMinTrackSize={MulDiv(360,dpi,96),MulDiv(v->quick?92:420,dpi,96)};return 0;}
        if(message==WM_EXITSIZEMOVE){v->gesture=false;if(v->glass)v->glass->Freeze(false);ClampWindow(*v);if(!v->quick){RECT r{};GetWindowRect(hwnd,&r);JsonObject bounds;bounds.Insert(L"x",Number(r.left));bounds.Insert(L"y",Number(r.top));bounds.Insert(L"width",Number(r.right-r.left));bounds.Insert(L"height",Number(r.bottom-r.top));nativeSettings.Insert(L"bounds",bounds);try{SaveNative();}catch(std::exception const& e){Log("window_save_error",e.what());}}Reposition(*v);return 0;}
        if(message==WM_CLOSE){if(v->quick){Hide(*v);ReturnFocus(*v);}else Hide(*v);return 0;}
        // With the non-client band gone, DefWindowProc no longer reports the sizing
        // edges, so they are mapped by hand inside the client rect. Without this the
        // window could only be resized by the bottom-right corner.
        if(message==WM_NCHITTEST){auto hit=DefWindowProcW(hwnd,message,w,l);if(hit==HTCLIENT&&!v->quick){POINT p{GET_X_LPARAM(l),GET_Y_LPARAM(l)};ScreenToClient(hwnd,&p);RECT r{};GetClientRect(hwnd,&r);constexpr int edge=6,corner=14;bool left=p.x<edge,right=p.x>=r.right-edge,top=p.y<edge,bottom=p.y>=r.bottom-edge;if(p.x>=r.right-corner&&p.y>=r.bottom-corner)return HTBOTTOMRIGHT;if(left&&top)return HTTOPLEFT;if(right&&top)return HTTOPRIGHT;if(left&&bottom)return HTBOTTOMLEFT;if(right&&bottom)return HTBOTTOMRIGHT;if(left)return HTLEFT;if(right)return HTRIGHT;if(top)return HTTOP;if(bottom)return HTBOTTOM;}return hit;}
        if(message==WM_DESTROY){v->glass.reset();if(v->controller)v->controller->Close();v->controller=nullptr;v->web=nullptr;v->hwnd=nullptr;return 0;}
    }
    if(hwnd==control){
        if(message==taskbarCreated){Tray();if(mainView.hwnd)ApplyMode();return 0;}
        if(message==ShowMessage){ShowList();return 0;}
        if(message==WM_HOTKEY){if(w==1)ShowList();else if(w==2)Quick();return 0;}
        if(message==WM_DISPLAYCHANGE){if(mainView.hwnd)ClampWindow(mainView);if(quickView.hwnd)ClampWindow(quickView);if(mainView.glass)mainView.glass->Rebuild();if(quickView.glass)quickView.glass->Rebuild();return 0;}
        if(message==WM_POWERBROADCAST||message==WM_WTSSESSION_CHANGE){bool suspend=(message==WM_POWERBROADCAST&&w==PBT_APMSUSPEND)||(message==WM_WTSSESSION_CHANGE&&w==WTS_SESSION_LOCK);bool resume=(message==WM_POWERBROADCAST&&w==PBT_APMRESUMEAUTOMATIC)||(message==WM_WTSSESSION_CHANGE&&w==WTS_SESSION_UNLOCK);if(suspend){++powerSuspends;Log("power_suspend",message==WM_POWERBROADCAST?"system":"session");Broadcast(L"suspend");if(mainView.glass)mainView.glass->Suspend(true);if(quickView.glass)quickView.glass->Suspend(true);}if(resume){++powerResumes;Log("power_resume",message==WM_POWERBROADCAST?"system":"session");if(mainView.glass)mainView.glass->Suspend(false);if(quickView.glass)quickView.glass->Suspend(false);Broadcast(L"resume");}return TRUE;}
        if(message==WM_QUERYENDSESSION){Broadcast(L"suspend");return TRUE;}
        if(message==WM_ENDSESSION&&w){PostQuitMessage(0);return 0;}
        if(message==TrayMessage){if(l==WM_LBUTTONDBLCLK)ShowList();if(l==WM_RBUTTONUP||l==WM_CONTEXTMENU){auto language=store&&store->State()?store->State().GetNamedObject(L"settings",JsonObject{}).GetNamedString(L"language",L"ru"):hstring(L"ru");auto menu=CreatePopupMenu();AppendMenuW(menu,MF_STRING,1,TrayLabel(language.c_str(),1));AppendMenuW(menu,MF_STRING,2,TrayLabel(language.c_str(),2));AppendMenuW(menu,MF_SEPARATOR,0,nullptr);AppendMenuW(menu,MF_STRING,3,TrayLabel(language.c_str(),3));POINT p{};GetCursorPos(&p);SetForegroundWindow(control);auto cmd=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_RIGHTBUTTON,p.x,p.y,0,control,nullptr);DestroyMenu(menu);if(cmd==1)ShowList();if(cmd==2)Quick();if(cmd==3)RequestExit();}return 0;}
        if(message==WM_TIMER&&w==4){KillTimer(control,4);exiting=false;Focus(mainView);Event(mainView,L"exitFailed");Log("exit_cancelled","No save acknowledgement");return 0;}
        if(message==WM_TIMER&&w==5){KillTimer(control,5);for(auto* item:{&mainView,&quickView})if(item->captureFrozen){SetWindowDisplayAffinity(item->hwnd,WDA_EXCLUDEFROMCAPTURE);item->glass->Rebuild();item->captureFrozen=false;}return 0;}
    }
    return DefWindowProcW(hwnd,message,w,l);
}
void CreateWindowFor(View& v){auto dpi=GetDpiForSystem();int width=MulDiv(v.quick?520:440,dpi,96),height=MulDiv(v.quick?112:680,dpi,96);int x=100,y=120;if(!v.quick&&nativeSettings.HasKey(L"bounds")){auto b=nativeSettings.GetNamedObject(L"bounds");x=int(b.GetNamedNumber(L"x",x));y=int(b.GetNamedNumber(L"y",y));width=std::clamp(int(b.GetNamedNumber(L"width",width)),360,2400);height=std::clamp(int(b.GetNamedNumber(L"height",height)),420,2400);}
    auto hwnd=CreateWindowExW(WS_EX_TOOLWINDOW|WS_EX_NOREDIRECTIONBITMAP,ClassName,v.quick?L"Delo Quick":L"Delo",WS_POPUP|WS_THICKFRAME,x,y,width,height,nullptr,nullptr,appInstance,&v);if(!hwnd)throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
    // Windows 11 still strokes a 1px border outside the client area; DWMWA_COLOR_NONE
    // drops it so nothing squares off the rounded corners.
    {COLORREF borderNone=DWMWA_COLOR_NONE;DwmSetWindowAttribute(hwnd,DWMWA_BORDER_COLOR,&borderNone,sizeof(borderNone));}
    ClampWindow(v);v.glass=std::make_unique<delo::GlassRenderer>(hwnd,appRoot/L"Glass.hlsl");if(v.quick){v.visible=false;SetWindowPos(hwnd,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);}else{ApplyMode();ShowWindow(hwnd,SW_SHOWNOACTIVATE);}if(environment)CreateWebView(v);
}
int WINAPI wWinMain(HINSTANCE module,HINSTANCE,PWSTR args,int){appInstance=module;try{
    init_apartment(apartment_type::single_threaded);SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    wchar_t path[32768]{};GetModuleFileNameW(nullptr,path,32768);appRoot=fs::path(path).parent_path();harness=wcsstr(args,L"--harness")!=nullptr;
    PWSTR local{};check_hresult(SHGetKnownFolderPath(FOLDERID_LocalAppData,0,nullptr,&local));dataRoot=fs::path(local)/L"Delo";CoTaskMemFree(local);if(harness){dataRoot=appRoot/L"test-output";auto named=wcsstr(args,L"--harness=");if(named){std::wstring name(named+10);if(name.empty()||name.size()>64||name.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")!=std::wstring::npos)throw std::runtime_error("Invalid harness session name");dataRoot/=L"sessions";dataRoot/=name;}}fs::create_directories(dataRoot);trace.open(dataRoot/L"native.jsonl",std::ios::app);
    auto mutexName=harness?L"Local\\Delo.Widget.Harness":L"Local\\Delo.Widget";winrt::handle mutex{CreateMutexW(nullptr,FALSE,mutexName)};if(GetLastError()==ERROR_ALREADY_EXISTS){auto other=FindWindowW(ClassName,harness?L"Delo.Harness.Control":L"Delo.Control");if(other)PostMessageW(other,ShowMessage,0,0);return 0;}
    if(fs::exists(dataRoot/L"window.json")){try{nativeSettings=JsonObject::Parse(to_hstring(delo::ReadBytes(dataRoot/L"window.json")));}catch(...){Log("settings_error","Using defaults; original preserved");}}
    pinned=nativeSettings.GetNamedBoolean(L"pinned",false);nativeSettings.Insert(L"pinned",Bool(pinned));if(!nativeSettings.HasKey(L"autostart"))nativeSettings.Insert(L"autostart",Bool(false));if(!nativeSettings.HasKey(L"hotkeys")){JsonObject keys;keys.Insert(L"list",Text(L"Ctrl+Alt+Space"));keys.Insert(L"quick",Text(L"Ctrl+Alt+N"));nativeSettings.Insert(L"hotkeys",keys);}
    store=std::make_unique<delo::Store>(dataRoot/L"tasks.json");try{store->Load();}catch(...){storageError="dataCorrupt: Local data is damaged. Restore the backup; original data will be retained.";Log("storage_error",storageError);}
    WNDCLASSW wc{};wc.lpfnWndProc=WindowProc;wc.hInstance=appInstance;wc.lpszClassName=ClassName;wc.hCursor=LoadCursorW(nullptr,IDC_ARROW);wc.hIcon=AppIcon();RegisterClassW(&wc);control=CreateWindowExW(WS_EX_TOOLWINDOW,ClassName,harness?L"Delo.Harness.Control":L"Delo.Control",WS_POPUP,0,0,0,0,nullptr,nullptr,appInstance,nullptr);if(!control)throw hresult_error(E_FAIL);
    taskbarCreated=RegisterWindowMessageW(L"TaskbarCreated");Tray();powerNotify=RegisterSuspendResumeNotification(control,DEVICE_NOTIFY_WINDOW_HANDLE);WTSRegisterSessionNotification(control,NOTIFY_FOR_THIS_SESSION);
    try{auto keys=nativeSettings.GetNamedObject(L"hotkeys");RegisterKeys(keys.GetNamedString(L"list").c_str(),keys.GetNamedString(L"quick").c_str());}catch(std::exception const& e){nativeSettings.Insert(L"hotkeyError",JsonValue::CreateStringValue(to_hstring(e.what())));}
    if(harness)SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",L"--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1");
    quickView.quick=true;CreateWindowFor(mainView);CreateWindowFor(quickView);
    check_hresult(CreateCoreWebView2EnvironmentWithOptions(nullptr,(dataRoot/L"WebView2").c_str(),nullptr,Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([](HRESULT hr,ICoreWebView2Environment* env)->HRESULT{if(FAILED(hr)){MessageBoxW(mainView.hwnd,L"Install Microsoft Edge WebView2 Runtime to run Delo.",L"Delo",MB_ICONERROR);PostQuitMessage(1);return S_OK;}environment.copy_from(env);CreateWebView(mainView);CreateWebView(quickView);return S_OK;}).Get()));
    auto ownerCheck=GetTickCount64();bool running=true;int exitCode{};
    while(running){MSG msg{};while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){if(msg.message==WM_QUIT){running=false;exitCode=int(msg.wParam);break;}TranslateMessage(&msg);DispatchMessageW(&msg);}if(!running)break;
        for(auto* v:{&mainView,&quickView}){if(v->hwnd&&v->visible&&v->glass&&!v->captureFrozen){v->glass->Tick();auto healthy=v->glass->Healthy();if(healthy!=v->lastHealthy){v->lastHealthy=healthy;JsonObject p;p.Insert(L"available",Bool(healthy));Event(*v,L"material",p);InvalidateRect(v->hwnd,nullptr,TRUE);}}}
        if(GetTickCount64()-ownerCheck>2000){ownerCheck=GetTickCount64();if(!mainView.hwnd&&!exiting){CreateWindowFor(mainView);Log("window_recreated","true");}if(mainView.hwnd&&!pinned&&!mainView.temporary){auto owner=GetWindow(mainView.hwnd,GW_OWNER);if(!IsWindow(owner))ApplyMode();}}
        HANDLE handles[2]{};DWORD count{};for(auto* v:{&mainView,&quickView})if(v->visible&&v->glass&&v->glass->EventHandle())handles[count++]=v->glass->EventHandle();MsgWaitForMultipleObjectsEx(count,handles,50,QS_ALLINPUT,MWMO_INPUTAVAILABLE);
    }
    NOTIFYICONDATAW n{sizeof(n)};n.hWnd=control;n.uID=1;Shell_NotifyIconW(NIM_DELETE,&n);UnregisterHotKey(control,1);UnregisterHotKey(control,2);if(powerNotify)UnregisterSuspendResumeNotification(powerNotify);WTSUnRegisterSessionNotification(control);if(mainView.hwnd)DestroyWindow(mainView.hwnd);if(quickView.hwnd)DestroyWindow(quickView.hwnd);DestroyWindow(control);return exitCode;
}catch(hresult_error const& e){MessageBoxW(nullptr,e.message().c_str(),L"Delo",MB_ICONERROR);return 1;}catch(std::exception const& e){MessageBoxW(nullptr,to_hstring(e.what()).c_str(),L"Delo",MB_ICONERROR);return 1;}}
