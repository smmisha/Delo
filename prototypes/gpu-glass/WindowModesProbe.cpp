#define DELO_MONITOR_NO_MAIN
#include "MonitorProbe.cpp"

HWND desktopHost{}, sentinel{}, desktopSource{}, topSource{}; int clicks{}, letters{};
BOOL CALLBACK FindDesktop(HWND h,LPARAM) {
    if(FindWindowEx(h,nullptr,L"SHELLDLL_DefView",nullptr)) { desktopHost=h; return FALSE; } return TRUE;
}
LRESULT CALLBACK InputProc(HWND h,UINT m,WPARAM w,LPARAM l) {
    if(h==outputWindow&&m==WM_LBUTTONUP) { ++clicks; SetFocus(h); return 0; }
    if(h==outputWindow&&m==WM_CHAR) { ++letters; return 0; }
    return Proc(h,m,w,l);
}
void Parent(HWND h,HWND parent) {
    SetLastError(0); SetParent(h,parent); DWORD e=GetLastError(); if(e) throw hresult_error(HRESULT_FROM_WIN32(e));
}
void Position(HWND h,HWND after,POINT origin,bool child) {
    if(child) ScreenToClient(desktopHost,&origin);
    if(!SetWindowPos(h,after,origin.x,origin.y,Width,Height,SWP_NOACTIVATE|SWP_FRAMECHANGED|SWP_SHOWWINDOW)) throw hresult_error(E_FAIL);
}
void ToggleDesktop() {
    for(int key:{VK_SHIFT,VK_CONTROL,VK_MENU,VK_LWIN,VK_RWIN}) if(GetAsyncKeyState(key)&0x8000)throw hresult_error(HRESULT_FROM_WIN32(ERROR_BUSY));
    INPUT keys[4]{}; for(auto& k:keys) k.type=INPUT_KEYBOARD;
    keys[0].ki.wVk=VK_LWIN; keys[1].ki.wVk='D'; keys[2].ki.wVk='D';keys[2].ki.dwFlags=KEYEVENTF_KEYUP;keys[3].ki.wVk=VK_LWIN;keys[3].ki.dwFlags=KEYEVENTF_KEYUP;
    if(SendInput(4,keys,sizeof(INPUT))!=4) { SendInput(2,keys+2,sizeof(INPUT)); throw hresult_error(E_FAIL); }
    Pump(600);
}
bool HitOutput() {
    POINT p{200,150}; ClientToScreen(outputWindow,&p); return WindowFromPoint(p)==outputWindow;
}
bool InputCheck() {
    if(!HitOutput()) return false;
    POINT old{}; GetCursorPos(&old); POINT p{200,150}; ClientToScreen(outputWindow,&p); SetCursorPos(p.x,p.y);
    int before=clicks, chars=letters; INPUT mouse[2]{};mouse[0].type=mouse[1].type=INPUT_MOUSE;mouse[0].mi.dwFlags=MOUSEEVENTF_LEFTDOWN;mouse[1].mi.dwFlags=MOUSEEVENTF_LEFTUP;
    UINT sent=SendInput(2,mouse,sizeof(INPUT)); Pump(150); SetCursorPos(old.x,old.y);
    if(sent!=2||GetFocus()!=outputWindow) return false;
    INPUT key[2]{};key[0].type=key[1].type=INPUT_KEYBOARD;key[0].ki.wScan=key[1].ki.wScan=L'D';key[0].ki.dwFlags=KEYEVENTF_UNICODE;key[1].ki.dwFlags=KEYEVENTF_UNICODE|KEYEVENTF_KEYUP;
    sent=SendInput(2,key,sizeof(INPUT)); Pump(150); return sent==2&&clicks==before+1&&letters==chars+1;
}
// No recursive feedback is ever started until a static marker proves exclusion in this exact mode.
bool Optics(GPU& gpu,MonitorCapture& capture,std::string const& name) {
    ShowWindow(outputWindow,SW_HIDE); capture.Update(gpu); auto baseline=gpu.Read(true);
    uint32_t ink=dark?0x99c0d2:0x234b69,background=dark?0x232f3e:0xcde3ef;
    auto inkCount=std::count_if(baseline.begin(),baseline.end(),[&](uint32_t p){return(p&0xffffff)==ink;});
    auto bgCount=std::count_if(baseline.begin(),baseline.end(),[&](uint32_t p){return(p&0xffffff)==background;});
    bool sourceValid=inkCount>1000&&bgCount>10000;Check(name+"_grid_source",sourceValid);
    if(!sourceValid)return false;
    if(name.find("win_d")!=std::string::npos) {
        SetWindowDisplayAffinity(outputWindow,WDA_NONE);capture.Update(gpu);auto unrestricted=gpu.Read(true);
        POINT p{100,100};ClientToScreen(sourceWindow,&p);HWND hit=WindowFromPoint(p);DWORD hostAffinity{},sourceCloak{};GetWindowDisplayAffinity(desktopHost,&hostAffinity);DwmGetWindowAttribute(sourceWindow,DWMWA_CLOAKED,&sourceCloak,sizeof(sourceCloak));
        COLORREF screen=CLR_INVALID;if(hit==sourceWindow){auto dc=GetDC(nullptr);screen=GetPixel(dc,p.x,p.y);ReleaseDC(nullptr,dc);}
        Check(name+"_source_diagnostic",true,"base="+std::to_string(baseline[100*Width+100]&0xffffff)+",unrestricted="+std::to_string(unrestricted[100*Width+100]&0xffffff)+",screen="+std::to_string(screen)+",sourceHit="+std::to_string(hit==sourceWindow)+",visible="+std::to_string(IsWindowVisible(sourceWindow))+",cloak="+std::to_string(sourceCloak)+",hostAffinity="+std::to_string(hostAffinity));
        SetWindowDisplayAffinity(outputWindow,WDA_EXCLUDEFROMCAPTURE);capture.Update(gpu);baseline=gpu.Read(true);
    }
    float marker[4]{1,0,1,1};gpu.context->ClearRenderTargetView(gpu.outputRT.get(),marker);gpu.Present();ShowWindow(outputWindow,SW_SHOWNOACTIVATE);Pump(150);
    Check(name+"_hit",HitOutput());
    capture.Update(gpu);auto sampled=gpu.Read(true);int error=AllChanged(baseline,sampled);
    bool excluded=error<100&&Magenta(sampled)<100;
    Check(name+"_exclusion",excluded,"difference="+std::to_string(error)+",magenta="+std::to_string(Magenta(sampled)));
    if(!excluded) { ShowWindow(outputWindow,SW_HIDE);return false; }
    gpu.Draw(false,false);auto flat=gpu.Read();gpu.Draw(false,true);auto lens=gpu.Read();gpu.Present();Save(name+"_lens",lens);
    Check(name+"_refraction",Difference(flat,lens,true)>300,std::to_string(Difference(flat,lens,true)));
    phase=(phase==0?9:0);InvalidateRect(sourceWindow,nullptr,FALSE);UpdateWindow(sourceWindow);capture.Update(gpu);auto changed=gpu.Read(true);gpu.Draw(false,true);gpu.Present();
    Check(name+"_live",Difference(sampled,changed,false)>300);
    return excluded;
}

int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR args,int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    init_apartment(apartment_type::multi_threaded);
    bool ownerMode=wcsstr(args,L"--child")==nullptr, desktopToggled=false;
    wchar_t exe[MAX_PATH]{};GetModuleFileName(nullptr,exe,MAX_PATH);auto bin=std::filesystem::path(exe).parent_path();
    artifacts=bin/(std::string(ownerMode?"owner-modes-":"child-modes-")+std::to_string(GetTickCount64()));std::filesystem::create_directories(artifacts);logFile.open(artifacts/"checks.jsonl");
    HWND previous=GetForegroundWindow();bool previousMinimized=IsIconic(previous)!=FALSE;
    try {
        EnumWindows(FindDesktop,0);if(!desktopHost) throw hresult_error(E_FAIL);
        SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(desktopHost));
        GPU gpu(bin.parent_path()/"Glass.hlsl");HMONITOR monitor=MonitorFromWindow(desktopHost,MONITOR_DEFAULTTOPRIMARY);MONITORINFO mi{sizeof(mi)};GetMonitorInfo(monitor,&mi);
        POINT origin{mi.rcMonitor.left+80,mi.rcMonitor.top+160};
        WNDCLASS wc{};wc.lpfnWndProc=InputProc;wc.hInstance=instance;wc.lpszClassName=L"Delo.GlassModes";if(!RegisterClass(&wc))throw hresult_error(E_FAIL);
        sourceWindow=CreateWindowEx(WS_EX_TOOLWINDOW,wc.lpszClassName,L"Delo desktop source",WS_POPUP,origin.x,origin.y,Width,Height,nullptr,nullptr,instance,nullptr);
        topSource=sourceWindow;
        desktopSource=CreateWindowEx(WS_EX_TOOLWINDOW|WS_EX_LAYERED,wc.lpszClassName,L"Delo fixed desktop source",WS_CHILD,0,0,Width,Height,desktopHost,nullptr,instance,nullptr);
        if(!desktopSource||!SetLayeredWindowAttributes(desktopSource,0,255,LWA_ALPHA))throw hresult_error(E_FAIL);
        outputWindow=CreateWindowEx(WS_EX_TOOLWINDOW|WS_EX_NOREDIRECTIONBITMAP,wc.lpszClassName,L"Delo mode probe",WS_POPUP,origin.x,origin.y,Width,Height,nullptr,nullptr,instance,nullptr);
        sentinel=CreateWindowEx(0,wc.lpszClassName,L"Delo Win+D control",WS_OVERLAPPEDWINDOW,mi.rcMonitor.left+600,mi.rcMonitor.top+180,280,160,nullptr,nullptr,instance,nullptr);
        wc.lpfnWndProc=PulseProc;wc.lpszClassName=L"Delo.ModesPulse";RegisterClass(&wc);
        pulseWindow=CreateWindowEx(WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE,wc.lpszClassName,L"Delo frame trigger",WS_POPUP,mi.rcMonitor.right-30,mi.rcMonitor.top+30,8,8,nullptr,nullptr,instance,nullptr);
        if(!sourceWindow||!outputWindow||!sentinel||!pulseWindow)throw hresult_error(E_FAIL);
        ShowWindow(sourceWindow,SW_SHOWNOACTIVATE);ShowWindow(sourceWindow,SW_SHOWNOACTIVATE);Position(sourceWindow,HWND_TOPMOST,origin,false);
        ShowWindow(pulseWindow,SW_SHOWNOACTIVATE);ShowWindow(pulseWindow,SW_SHOWNOACTIVATE);SetWindowPos(pulseWindow,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
        gpu.Attach(outputWindow);Affinity(WDA_EXCLUDEFROMCAPTURE);Position(outputWindow,HWND_TOPMOST,origin,false);
        MonitorCapture capture(gpu,monitor,origin);
        if(!Optics(gpu,capture,"initial_topmost"))throw hresult_error(E_FAIL);
        for(int cycle=0;cycle<2;++cycle) {
            dark=cycle==1;phase=0;InvalidateRect(sourceWindow,nullptr,FALSE);UpdateWindow(sourceWindow);
            ShowWindow(sourceWindow,SW_HIDE);sourceWindow=desktopSource;Position(sourceWindow,HWND_TOP,origin,true);InvalidateRect(sourceWindow,nullptr,FALSE);UpdateWindow(sourceWindow);
            ShowWindow(outputWindow,SW_HIDE);SetWindowPos(outputWindow,HWND_NOTOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
            if(ownerMode) {
                SetLastError(0);SetWindowLongPtr(outputWindow,GWLP_HWNDPARENT,reinterpret_cast<LONG_PTR>(desktopHost));if(GetLastError())throw hresult_error(E_FAIL);
                Position(outputWindow,HWND_BOTTOM,origin,false);
            } else {
                SetWindowLongPtr(outputWindow,GWL_STYLE,WS_CHILD);Parent(outputWindow,desktopHost);Position(outputWindow,HWND_TOP,origin,true);
            }
            std::string name="desktop_"+std::to_string(cycle);
            Check(name+"_relationship",ownerMode?GetWindow(outputWindow,GW_OWNER)==desktopHost:GetParent(outputWindow)==desktopHost);
            Check(name+"_not_topmost",!(GetWindowLongPtr(outputWindow,GWL_EXSTYLE)&WS_EX_TOPMOST));
            SetLastError(0);BOOL set=SetWindowDisplayAffinity(outputWindow,WDA_EXCLUDEFROMCAPTURE);DWORD err=GetLastError(),affinity{};GetWindowDisplayAffinity(outputWindow,&affinity);
            Check(name+"_affinity",set&&affinity==WDA_EXCLUDEFROMCAPTURE,"set="+std::to_string(set)+",error="+std::to_string(err)+",value="+std::to_string(affinity));
            if(!set||affinity!=WDA_EXCLUDEFROMCAPTURE)throw hresult_error(E_FAIL);
            ShowWindow(sentinel,SW_SHOW);ShowWindow(sentinel,SW_SHOW);SetWindowPos(sentinel,HWND_TOP,origin.x,origin.y,Width,Height,SWP_SHOWWINDOW);SetForegroundWindow(sentinel);Pump(200);
            POINT overlapped{origin.x+200,origin.y+150};
            Check(name+"_below_normal_window",GetAncestor(WindowFromPoint(overlapped),GA_ROOT)==sentinel);
            ToggleDesktop();desktopToggled=true;Check(name+"_win_d_control_minimized",IsIconic(sentinel)!=FALSE);
            RECT sourceRect{},outputRect{};GetWindowRect(sourceWindow,&sourceRect);GetWindowRect(outputWindow,&outputRect);DWORD cloak{};DwmGetWindowAttribute(outputWindow,DWMWA_CLOAKED,&cloak,sizeof(cloak));
            Check(name+"_geometry_observation",true,"source="+std::to_string(sourceRect.left)+","+std::to_string(sourceRect.top)+","+std::to_string(sourceRect.right-sourceRect.left)+";output="+std::to_string(outputRect.left)+","+std::to_string(outputRect.top)+","+std::to_string(outputRect.right-outputRect.left)+";cloak="+std::to_string(cloak));
            Check(name+"_visible_after_win_d",IsWindowVisible(outputWindow)&&!IsIconic(outputWindow)&&HitOutput());
            if(!Optics(gpu,capture,name+"_win_d"))throw hresult_error(E_FAIL);
            Check(name+"_input",InputCheck());
            ToggleDesktop();desktopToggled=false;ShowWindow(sentinel,SW_HIDE);Pump(150);
            ShowWindow(outputWindow,SW_HIDE);
            if(ownerMode)SetWindowLongPtr(outputWindow,GWLP_HWNDPARENT,0);
            else {Parent(outputWindow,nullptr);SetWindowLongPtr(outputWindow,GWL_STYLE,WS_POPUP);}
            Affinity(WDA_EXCLUDEFROMCAPTURE);Position(outputWindow,HWND_TOPMOST,origin,false);
            ShowWindow(sourceWindow,SW_HIDE);sourceWindow=topSource;Position(sourceWindow,outputWindow,origin,false);InvalidateRect(sourceWindow,nullptr,FALSE);UpdateWindow(sourceWindow);
            if(!Optics(gpu,capture,"returned_topmost_"+std::to_string(cycle)))throw hresult_error(E_FAIL);
            ShowWindow(sentinel,SW_SHOW);SetWindowPos(sentinel,HWND_TOP,origin.x,origin.y,Width,Height,SWP_SHOWWINDOW);SetForegroundWindow(sentinel);Pump(150);
            Check("topmost_above_normal_"+std::to_string(cycle),HitOutput()&&(GetWindowLongPtr(outputWindow,GWL_EXSTYLE)&WS_EX_TOPMOST));
            ShowWindow(sentinel,SW_HIDE);
            Check("topmost_input_"+std::to_string(cycle),InputCheck());
        }
        Check("device_not_removed",SUCCEEDED(gpu.device->GetDeviceRemovedReason()));
    } catch(hresult_error const& e) { std::ostringstream s;s<<"HRESULT 0x"<<std::hex<<uint32_t(e.code());Check("exception",false,s.str()); }
    if(desktopToggled) { try {ToggleDesktop();}catch(...){} }
    if(outputWindow)DestroyWindow(outputWindow);if(topSource)DestroyWindow(topSource);if(desktopSource)DestroyWindow(desktopSource);if(sentinel)DestroyWindow(sentinel);if(pulseWindow)DestroyWindow(pulseWindow);
    if(IsWindow(previous)&&!previousMinimized&&!IsIconic(previous))SetForegroundWindow(previous);
    logFile<<"{\"failed_checks\":"<<failures<<"}\n";return failures?1:0;
}
