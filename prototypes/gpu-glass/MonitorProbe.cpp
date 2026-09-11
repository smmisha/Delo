// Reuses the verified shader/device implementation; this entry point tests monitor capture.
#define DELO_GPU_NO_MAIN
#include "Probe.cpp"

HWND pulseWindow{}; bool pulse{};
LRESULT CALLBACK PulseProc(HWND h,UINT m,WPARAM w,LPARAM l) {
    if(m==WM_PAINT) { PAINTSTRUCT ps{}; auto dc=BeginPaint(h,&ps); RECT r{}; GetClientRect(h,&r); auto b=CreateSolidBrush(pulse?RGB(60,70,80):RGB(90,100,110)); FillRect(dc,&r,b); DeleteObject(b); EndPaint(h,&ps); return 0; }
    return DefWindowProc(h,m,w,l);
}
struct MonitorCapture {
    GraphicsCaptureItem item{nullptr}; Direct3D11CaptureFramePool pool{nullptr}; GraphicsCaptureSession session{nullptr};
    RECT monitor{}; UINT x{},y{}; int frames{};
    MonitorCapture(GPU& gpu,HMONITOR handle,POINT origin) {
        MONITORINFO mi{sizeof(mi)}; if(!GetMonitorInfo(handle,&mi)) throw hresult_error(E_FAIL); monitor=mi.rcMonitor;
        x=UINT(origin.x-monitor.left); y=UINT(origin.y-monitor.top);
        if(origin.x<monitor.left||origin.y<monitor.top||origin.x+int(Width)>monitor.right||origin.y+int(Height)>monitor.bottom) throw hresult_error(E_INVALIDARG);
        auto interop=get_activation_factory<GraphicsCaptureItem,IGraphicsCaptureItemInterop>();
        check_hresult(interop->CreateForMonitor(handle,guid_of<GraphicsCaptureItem>(),put_abi(item)));
        auto size=item.Size(); Check("monitor_size",size.Width==monitor.right-monitor.left&&size.Height==monitor.bottom-monitor.top,std::to_string(size.Width)+"x"+std::to_string(size.Height));
        com_ptr<::IInspectable> inspectable; check_hresult(CreateDirect3D11DeviceFromDXGIDevice(gpu.device.as<IDXGIDevice>().get(),inspectable.put()));
        auto device=inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
        pool=Direct3D11CaptureFramePool::CreateFreeThreaded(device,winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size);
        session=pool.CreateCaptureSession(item); session.IsCursorCaptureEnabled(false); session.StartCapture();
    }
    ~MonitorCapture() { if(session) session.Close(); if(pool) pool.Close(); }
    void Update(GPU& gpu) {
        // A tiny owned window OUTSIDE the saved crop creates a monitor frame even on a static desktop.
        while(auto frame=pool.TryGetNextFrame()) frame.Close();
        pulse=!pulse; InvalidateRect(pulseWindow,nullptr,FALSE); UpdateWindow(pulseWindow);
        bool copied=false; auto end=GetTickCount64()+400;
        do {
            Pump(15);
            while(auto frame=pool.TryGetNextFrame()) {
                auto size=frame.ContentSize(); if(size.Width!=monitor.right-monitor.left||size.Height!=monitor.bottom-monitor.top) throw hresult_error(E_INVALIDARG);
                auto access=frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
                com_ptr<ID3D11Texture2D> texture; check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D),texture.put_void()));
                D3D11_BOX box{x,y,0,x+Width,y+Height,1};
                gpu.context->CopySubresourceRegion(gpu.source.get(),0,0,0,0,texture.get(),0,&box);
                frame.Close(); copied=true; ++frames;
            }
        } while(GetTickCount64()<end);
        if(!copied) throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT));
    }
};
int AllChanged(Pixels const& a,Pixels const& b,int threshold=12) {
    int count{};
    for(size_t i=0;i<a.size();++i) { int d{}; for(int shift=0;shift<24;shift+=8) d+=abs(int((a[i]>>shift)&255)-int((b[i]>>shift)&255)); if(d>threshold) ++count; }
    return count;
}
int Magenta(Pixels const& a) {
    return int(std::count_if(a.begin(),a.end(),[](uint32_t p){return ((p>>16)&255)>240&&((p>>8)&255)<15&&(p&255)>240;}));
}
void Affinity(DWORD value) {
    SetLastError(0); BOOL ok=SetWindowDisplayAffinity(outputWindow,value); DWORD error=GetLastError(), actual{};
    bool read=GetWindowDisplayAffinity(outputWindow,&actual)!=FALSE;
    Check(value?"exclude_affinity":"include_affinity",ok&&read&&actual==value,"error="+std::to_string(error)+",value="+std::to_string(actual));
    if(!ok||!read||actual!=value) throw hresult_error(E_FAIL);
    Pump(120);
}

#ifndef DELO_MONITOR_NO_MAIN
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int) {
    init_apartment(apartment_type::multi_threaded); SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    wchar_t exe[MAX_PATH]{}; GetModuleFileName(nullptr,exe,MAX_PATH); auto bin=std::filesystem::path(exe).parent_path();
    artifacts=bin/("monitor-"+std::to_string(GetTickCount64())); std::filesystem::create_directories(artifacts); logFile.open(artifacts/"checks.jsonl");
    // Do not activate the previous app at shutdown: the user deliberately minimized all apps.
    try {
        GPU gpu(bin.parent_path()/"Glass.hlsl");
        HMONITOR handle=MonitorFromPoint(POINT{0,0},MONITOR_DEFAULTTOPRIMARY); MONITORINFO mi{sizeof(mi)}; if(!GetMonitorInfo(handle,&mi)) throw hresult_error(E_FAIL);
        POINT origin{mi.rcMonitor.left+40,mi.rcMonitor.top+120};
        WNDCLASS wc{}; wc.lpfnWndProc=Proc; wc.hInstance=instance; wc.lpszClassName=L"Delo.MonitorProbe"; if(!RegisterClass(&wc)) throw hresult_error(E_FAIL);
        sourceWindow=CreateWindowEx(WS_EX_TOOLWINDOW,wc.lpszClassName,L"Delo controlled moving background",WS_POPUP,origin.x,origin.y,Width,Height,nullptr,nullptr,instance,nullptr);
        outputWindow=CreateWindowEx(WS_EX_TOOLWINDOW|WS_EX_NOREDIRECTIONBITMAP,wc.lpszClassName,L"Delo desktop lens",WS_POPUP,origin.x,origin.y,Width,Height,nullptr,nullptr,instance,nullptr);
        wc.lpfnWndProc=PulseProc; wc.lpszClassName=L"Delo.MonitorPulse"; if(!RegisterClass(&wc)) throw hresult_error(E_FAIL);
        pulseWindow=CreateWindowEx(WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE,wc.lpszClassName,L"Delo frame trigger",WS_POPUP,mi.rcMonitor.right-30,mi.rcMonitor.top+30,8,8,nullptr,nullptr,instance,nullptr);
        if(!sourceWindow||!outputWindow||!pulseWindow) throw hresult_error(E_FAIL);
        ShowWindow(pulseWindow,SW_SHOWNOACTIVATE); ShowWindow(pulseWindow,SW_SHOWNOACTIVATE); SetWindowPos(pulseWindow,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
        gpu.Attach(outputWindow); MonitorCapture capture(gpu,handle,origin);
        capture.Update(gpu); auto desktop=gpu.Read(true); Save("desktop_source",desktop);
        // Positive control: the non-excluded magenta window MUST be captured by this monitor route.
        float magenta[4]{1,0,1,1}; gpu.context->ClearRenderTargetView(gpu.outputRT.get(),magenta); gpu.Present();
        ShowWindow(outputWindow,SW_SHOWNOACTIVATE); ShowWindow(outputWindow,SW_SHOWNOACTIVATE); SetWindowPos(outputWindow,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
        Affinity(WDA_NONE); capture.Update(gpu); auto included=gpu.Read(true);
        Check("positive_self_capture",Magenta(included)>110000,std::to_string(Magenta(included)));
        Affinity(WDA_EXCLUDEFROMCAPTURE); capture.Update(gpu); auto excluded=gpu.Read(true);
        int backgroundError=AllChanged(desktop,excluded);
        Check("exclusion_reveals_background",backgroundError<100,std::to_string(backgroundError));
        Check("excluded_marker_absent",Magenta(excluded)<100,std::to_string(Magenta(excluded)));
        if(failures) throw hresult_error(E_FAIL); // Never run a feedback loop when exclusion fails.
        gpu.Draw(false,false); auto identity=gpu.Read(); Save("desktop_identity",identity);
        gpu.Draw(false,true); auto lens=gpu.Read(); Save("desktop_lens",lens); gpu.Present(); Pump(250);
        int wallpaperDisplacement=AllChanged(identity,lens,3);
        Check("desktop_center_preserved",Difference(identity,lens,false)==0);
        Check("desktop_optical_change",wallpaperDisplacement>10,std::to_string(wallpaperDisplacement));
        int worstFeedback{};
        for(int i=0;i<8;++i) { capture.Update(gpu); auto current=gpu.Read(true); worstFeedback=std::max(worstFeedback,AllChanged(excluded,current)); gpu.Draw(false,true); gpu.Present(); }
        Check("desktop_feedback_stable_8_updates",worstFeedback<100,std::to_string(worstFeedback));

        // A normal owned window now moves behind the excluded lens, with both test palettes.
        ShowWindow(sourceWindow,SW_SHOWNOACTIVATE); ShowWindow(sourceWindow,SW_SHOWNOACTIVATE);
        SetWindowPos(sourceWindow,outputWindow,origin.x,origin.y,Width,Height,SWP_NOACTIVATE);
        for(bool theme:{false,true}) {
            dark=theme; phase=0; std::string name=dark?"monitor_dark":"monitor_light";
            InvalidateRect(sourceWindow,nullptr,FALSE); UpdateWindow(sourceWindow); capture.Update(gpu); auto raw=gpu.Read(true);
            gpu.Draw(false,false); auto flat=gpu.Read(); gpu.Draw(false,true); auto refracted=gpu.Read(); Save(name+"_lens",refracted); gpu.Present();
            int edge=Difference(flat,refracted,true); Check(name+"_edge_displacement",edge>300,std::to_string(edge)); Check(name+"_center_preserved",Difference(flat,refracted,false)==0);
            phase=9; InvalidateRect(sourceWindow,nullptr,FALSE); UpdateWindow(sourceWindow); capture.Update(gpu); auto shifted=gpu.Read(true);
            gpu.Draw(false,true); auto live=gpu.Read(); gpu.Present(); Check(name+"_live_background",Difference(raw,shifted,false)>300); Check(name+"_live_lens",Difference(refracted,live,false)>300);
            SetWindowPos(sourceWindow,outputWindow,origin.x+80,origin.y+25,Width,Height,SWP_NOACTIVATE); capture.Update(gpu); auto moved=gpu.Read(true); gpu.Draw(false,true); gpu.Present();
            Check(name+"_window_movement",AllChanged(shifted,moved)>5000);
            SetWindowPos(sourceWindow,outputWindow,origin.x,origin.y,Width,Height,SWP_NOACTIVATE); capture.Update(gpu);
            Check(name+"_restored_coordinates",AllChanged(shifted,gpu.Read(true))<100);
        }
        ShowWindow(sourceWindow,SW_HIDE); capture.Update(gpu); auto restored=gpu.Read(true);
        Check("desktop_restored_after_window",AllChanged(excluded,restored)<100,std::to_string(AllChanged(excluded,restored)));
        gpu.Draw(false,true); gpu.Present(); Pump(1000);
        Check("monitor_frames_received",capture.frames>20,std::to_string(capture.frames));
        Check("device_not_removed",SUCCEEDED(gpu.device->GetDeviceRemovedReason()));
    } catch(hresult_error const& e) { std::ostringstream s; s<<"HRESULT 0x"<<std::hex<<uint32_t(e.code()); Check("exception",false,s.str()); }
      catch(std::exception const&) { Check("exception",false,"standard_exception"); }
    if(outputWindow) DestroyWindow(outputWindow); if(sourceWindow) DestroyWindow(sourceWindow); if(pulseWindow) DestroyWindow(pulseWindow);
    logFile<<"{\"failed_checks\":"<<failures<<"}\n"; return failures?1:0;
}
#endif
