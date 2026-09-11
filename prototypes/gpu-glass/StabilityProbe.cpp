// Recovery and load experiment. Fault injection is explicitly labelled in the log.
#define DELO_MONITOR_NO_MAIN
#include "MonitorProbe.cpp"
#include <psapi.h>
#include <dxgi1_4.h>
#include <memory>
#include <iomanip>
#include <atomic>
#include <wtsapi32.h>
#include <chrono>

double PreciseMilliseconds() {
    return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
struct PreciseTimer {
    winrt::handle timer{CreateWaitableTimerExW(nullptr,nullptr,CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,TIMER_MODIFY_STATE|SYNCHRONIZE)};
    PreciseTimer(){if(!timer)throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));}
    void Arm(double ms){LARGE_INTEGER due{};due.QuadPart=-std::max<LONGLONG>(1,LONGLONG(ms*10000));check_hresult(SetWaitableTimer(timer.get(),&due,0,nullptr,nullptr,FALSE)?S_OK:HRESULT_FROM_WIN32(GetLastError()));}
    void Pause(){Arm(1);if(WaitForSingleObject(timer.get(),1000)!=WAIT_OBJECT_0)throw hresult_error(E_FAIL);}
};

// Compare only the widget crop on the GPU. No desktop pixels are read back to the CPU in the render loop.
struct ChangeDetector {
    PreciseTimer wait;
    com_ptr<ID3D11Texture2D> previous;com_ptr<ID3D11ShaderResourceView> view;
    com_ptr<ID3D11PixelShader> shader;com_ptr<ID3D11BlendState> noWrite;com_ptr<ID3D11Query> query;bool valid{};
    ChangeDetector(GPU& gpu) {
        const char* code="Texture2D<float4> a:register(t0);Texture2D<float4> b:register(t1);float4 PS(float4 p:SV_Position):SV_Target{float4 d=abs(a.Load(int3(p.xy,0))-b.Load(int3(p.xy,0)));if(max(max(d.r,d.g),d.b)<0.001)discard;return 0;}";
        com_ptr<ID3DBlob> bytes;check_hresult(D3DCompile(code,strlen(code),nullptr,nullptr,nullptr,"PS","ps_5_0",D3DCOMPILE_OPTIMIZATION_LEVEL3,0,bytes.put(),nullptr));
        check_hresult(gpu.device->CreatePixelShader(bytes->GetBufferPointer(),bytes->GetBufferSize(),nullptr,shader.put()));
        D3D11_TEXTURE2D_DESC desc{};gpu.source->GetDesc(&desc);desc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
        check_hresult(gpu.device->CreateTexture2D(&desc,nullptr,previous.put()));check_hresult(gpu.device->CreateShaderResourceView(previous.get(),nullptr,view.put()));
        D3D11_BLEND_DESC blend{};check_hresult(gpu.device->CreateBlendState(&blend,noWrite.put()));D3D11_QUERY_DESC q{D3D11_QUERY_OCCLUSION,0};check_hresult(gpu.device->CreateQuery(&q,query.put()));
    }
    bool Changed(GPU& gpu) {
        bool changed=!valid;
        if(valid){
            auto& ctx=gpu.context;auto rt=gpu.outputRT.get();ctx->OMSetRenderTargets(1,&rt,nullptr);ctx->OMSetBlendState(noWrite.get(),nullptr,~0u);
            D3D11_VIEWPORT vp{0,0,float(gpu.renderWidth),float(gpu.renderHeight),0,1};ctx->RSSetViewports(1,&vp);ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            ctx->VSSetShader(gpu.vs.get(),nullptr,0);ctx->PSSetShader(shader.get(),nullptr,0);ID3D11ShaderResourceView* views[]{gpu.sourceView.get(),view.get()};ctx->PSSetShaderResources(0,2,views);
            ctx->Begin(query.get());ctx->Draw(3,0);ctx->End(query.get());ID3D11ShaderResourceView* none[2]{};ctx->PSSetShaderResources(0,2,none);ctx->OMSetRenderTargets(0,nullptr,nullptr);ctx->OMSetBlendState(nullptr,nullptr,~0u);
            UINT64 samples{};HRESULT hr{};auto deadline=GetTickCount64()+1000;
            do{hr=ctx->GetData(query.get(),&samples,sizeof(samples),0);if(hr==S_FALSE)wait.Pause();}while(hr==S_FALSE&&GetTickCount64()<deadline);
            if(hr==S_FALSE)throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT));check_hresult(hr);changed=samples>0;
        }
        if(changed){gpu.context->CopyResource(previous.get(),gpu.source.get());valid=true;}return changed;
    }
};

struct Signal { HANDLE event=CreateEvent(nullptr,FALSE,FALSE,nullptr); ~Signal(){if(event) CloseHandle(event);} };
struct EventCapture {
    GraphicsCaptureItem item{nullptr}; Direct3D11CaptureFramePool pool{nullptr}; GraphicsCaptureSession session{nullptr};
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice device{nullptr};
    winrt::Windows::Graphics::SizeInt32 size{};
    std::shared_ptr<Signal> ready=std::make_shared<Signal>();
    event_token arrived{},closed{}; bool subscribed{}; std::shared_ptr<std::atomic_bool> ended=std::make_shared<std::atomic_bool>(false);
    RECT monitor{}; bool windowSource{}; unsigned recreates{};
    EventCapture(GPU& gpu, HMONITOR handle, HWND window=nullptr) {
        auto interop=get_activation_factory<GraphicsCaptureItem,IGraphicsCaptureItemInterop>();
        windowSource=window!=nullptr;
        if(window) check_hresult(interop->CreateForWindow(window,guid_of<GraphicsCaptureItem>(),put_abi(item)));
        else {
            MONITORINFO mi{sizeof(mi)}; if(!GetMonitorInfo(handle,&mi)) throw hresult_error(E_INVALIDARG); monitor=mi.rcMonitor;
            check_hresult(interop->CreateForMonitor(handle,guid_of<GraphicsCaptureItem>(),put_abi(item)));
        }
        com_ptr<::IInspectable> inspectable; check_hresult(CreateDirect3D11DeviceFromDXGIDevice(gpu.device.as<IDXGIDevice>().get(),inspectable.put()));
        device=inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
        size=item.Size();
        pool=Direct3D11CaptureFramePool::CreateFreeThreaded(device,winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size);
        auto signal=ready; auto flag=ended;
        arrived=pool.FrameArrived([signal](auto const&,auto const&){SetEvent(signal->event);});
        closed=item.Closed([signal,flag](auto const&,auto const&){flag->store(true);SetEvent(signal->event);}); subscribed=true;
        session=pool.CreateCaptureSession(item); session.IsCursorCaptureEnabled(false); session.StartCapture();
    }
    ~EventCapture() {
        // Callbacks retain only their own signal/flag; no access to the destroyed renderer.
        try {if(subscribed){pool.FrameArrived(arrived);item.Closed(closed);} if(session)session.Close(); if(pool)pool.Close();} catch(...) {}
    }
    bool CopyLatest(GPU& gpu, POINT origin) {
        if(ended->load()) throw hresult_error(RO_E_CLOSED);
        Direct3D11CaptureFrame latest{nullptr};
        while(auto next=pool.TryGetNextFrame()){if(latest)latest.Close();latest=next;}
        if(!latest)return false;
        auto content=latest.ContentSize();
        if(content.Width!=size.Width||content.Height!=size.Height) {
            latest.Close(); if(content.Width<=0||content.Height<=0)return false;
            size=content; pool.Recreate(device,winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size); ++recreates; return false;
        }
        LONG x=windowSource?0:origin.x-monitor.left, y=windowSource?0:origin.y-monitor.top;
        auto access=latest.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        com_ptr<ID3D11Texture2D> texture; check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D),texture.put_void()));
        D3D11_TEXTURE2D_DESC desc{}; texture->GetDesc(&desc);
        if(x<0||y<0||x+gpu.renderWidth>UINT(content.Width)||y+gpu.renderHeight>UINT(content.Height)||x+gpu.renderWidth>desc.Width||y+gpu.renderHeight>desc.Height) {
            latest.Close(); throw hresult_error(E_BOUNDS);
        }
        D3D11_BOX box{UINT(x),UINT(y),0,UINT(x)+gpu.renderWidth,UINT(y)+gpu.renderHeight,1};
        gpu.context->CopySubresourceRegion(gpu.source.get(),0,0,0,0,texture.get(),0,&box); latest.Close(); return true;
    }
};

bool suspendRequested{}, rebuildRequested{}, dpiRequested{},sessionLocked{}; unsigned suspendEvents{},resumeEvents{},displayEvents{},dpiEvents{};
RECT dpiRect{}; HWND testOwner{},controlWindow{}; HINSTANCE appInstance{};
LRESULT CALLBACK StabilityProc(HWND h,UINT m,WPARAM w,LPARAM l) {
    if(h==outputWindow||h==controlWindow) {
        if(m==WM_WTSSESSION_CHANGE){
            if(w==WTS_SESSION_LOCK||w==WTS_CONSOLE_DISCONNECT)sessionLocked=true;
            if(w==WTS_SESSION_UNLOCK||w==WTS_CONSOLE_CONNECT){sessionLocked=false;rebuildRequested=true;}
            logFile<<"{\"session_event\":"<<w<<"}\n";logFile.flush();return 0;
        }
        if(m==WM_POWERBROADCAST) {
            // Synthetic tests target outputWindow; real events belong to the stable, registered controller.
            if(w==PBT_APMSUSPEND){suspendRequested=true;++suspendEvents;logFile<<"{\"power_event\":\"suspend\"}\n";logFile.flush();}
            if(w==PBT_APMRESUMEAUTOMATIC){suspendRequested=false;rebuildRequested=true;++resumeEvents;logFile<<"{\"power_event\":\"resume\"}\n";logFile.flush();}
            return TRUE;
        }
        if(m==WM_DISPLAYCHANGE){rebuildRequested=true;++displayEvents;return 0;}
        if(m==WM_DPICHANGED){dpiRect=*reinterpret_cast<RECT*>(l);dpiRequested=true;rebuildRequested=true;++dpiEvents;return 0;}
    }
    if(h==sourceWindow&&m==WM_PAINT) {
        PAINTSTRUCT ps{}; auto dc=BeginPaint(h,&ps); RECT r{};GetClientRect(h,&r);
        auto bg=CreateSolidBrush(dark?RGB(35,47,62):RGB(205,227,239));FillRect(dc,&r,bg);DeleteObject(bg);
        auto pen=CreatePen(PS_SOLID,3,dark?RGB(153,192,210):RGB(35,75,105));auto old=SelectObject(dc,pen);
        for(int x=-phase;x<r.right;x+=25){MoveToEx(dc,x,0,nullptr);LineTo(dc,x,r.bottom);}
        for(int y=-phase;y<r.bottom;y+=25){MoveToEx(dc,0,y,nullptr);LineTo(dc,r.right,y);}
        SelectObject(dc,old);DeleteObject(pen);EndPaint(h,&ps);return 0;
    }
    return Proc(h,m,w,l);
}
void Observe(std::string const& name,std::string const& json) {logFile<<"{\"observation\":\""<<name<<"\",\"value\":"<<json<<"}\n";logFile.flush();}
HWND MakeWindow(const wchar_t* title,DWORD ex,POINT p,UINT width,UINT height,HWND owner=nullptr) {
    auto h=CreateWindowEx(ex,L"Delo.StabilityProbe",title,WS_POPUP,p.x,p.y,width,height,owner,nullptr,appInstance,nullptr);
    if(!h)throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));return h;
}
void Place(HWND h,POINT p,UINT width,UINT height,HWND after=HWND_TOPMOST) {
    if(!SetWindowPos(h,after,p.x,p.y,width,height,SWP_NOACTIVATE|SWP_SHOWWINDOW))throw hresult_error(E_FAIL);
    ShowWindow(h,SW_SHOWNOACTIVATE);ShowWindow(h,SW_SHOWNOACTIVATE);
}
POINT ClampOrigin(POINT p,RECT r,UINT width,UINT height) {
    if(r.right-r.left<LONG(width)||r.bottom-r.top<LONG(height))throw hresult_error(E_BOUNDS);
    return {std::clamp(p.x,r.left,r.right-LONG(width)),std::clamp(p.y,r.top,r.bottom-LONG(height))};
}
bool InteractiveDesktop() {
    auto desk=OpenInputDesktop(0,FALSE,DESKTOP_READOBJECTS);if(!desk)return false;
    wchar_t name[128]{};DWORD needed{};bool ok=GetUserObjectInformation(desk,UOI_NAME,name,sizeof(name),&needed)&&_wcsicmp(name,L"Default")==0;
    CloseDesktop(desk);return ok;
}
struct Runtime {
    std::filesystem::path shader;std::unique_ptr<GPU> gpu;std::unique_ptr<EventCapture> capture;std::unique_ptr<ChangeDetector> detector;
    POINT origin{80,160};UINT width{Width},height{Height};HWND owner{};bool useWindowSource{},suspended{},fallback{},forceDenied{},sessionPaused{};
    ULONGLONG desktopCheck{};bool desktopReady{true};
    unsigned generation{},attempts{},renders{},copies{},errors{};ULONGLONG retryAt{};double lastRender{};
    PreciseTimer pacing;
    unsigned sourceUpdates{};double copyMs{},detectMs{},presentMs{};
    Runtime(std::filesystem::path p):shader(p){}
    void CloseGPU() {
        capture.reset();detector.reset();
        if(gpu){if(gpu->visual)gpu->visual->SetContent(nullptr);if(gpu->target)gpu->target->SetRoot(nullptr);if(gpu->composition)gpu->composition->Commit();gpu->context->ClearState();gpu->context->Flush();gpu.reset();}
    }
    ~Runtime(){CloseGPU();}
    void Safe() {capture.reset();fallback=true;if(IsWindow(outputWindow))ShowWindow(outputWindow,SW_HIDE);}
    void Rebuild() {
        Safe();CloseGPU();
        if(!IsWindow(outputWindow))outputWindow=MakeWindow(L"Delo recovery lens",WS_EX_TOOLWINDOW|WS_EX_NOREDIRECTIONBITMAP,origin,width,height,IsWindow(owner)?owner:nullptr);
        auto monitor=MonitorFromPoint(origin,MONITOR_DEFAULTTONEAREST);MONITORINFO mi{sizeof(mi)};if(!GetMonitorInfo(monitor,&mi))throw hresult_error(E_FAIL);
        origin=ClampOrigin(origin,mi.rcMonitor,width,height);
        if(forceDenied)throw hresult_error(E_ACCESSDENIED);
        DWORD actual{};
        if(!SetWindowDisplayAffinity(outputWindow,WDA_EXCLUDEFROMCAPTURE)||!GetWindowDisplayAffinity(outputWindow,&actual)||actual!=WDA_EXCLUDEFROMCAPTURE)throw hresult_error(E_ACCESSDENIED);
        gpu=std::make_unique<GPU>(shader);if(width!=Width||height!=Height)gpu->Resize(width,height);gpu->Attach(outputWindow);detector=std::make_unique<ChangeDetector>(*gpu);
        // Reposition our artificial background only. No user windows are changed.
        Place(sourceWindow,origin,width,height);InvalidateRect(sourceWindow,nullptr,FALSE);UpdateWindow(sourceWindow);
        SetWindowPos(outputWindow,HWND_TOPMOST,origin.x,origin.y,width,height,SWP_NOACTIVATE);
        capture=std::make_unique<EventCapture>(*gpu,monitor,useWindowSource?sourceWindow:nullptr);
        ++generation;attempts=0;retryAt=0; // Stay hidden until the first valid captured frame.
    }
    void Fault(HRESULT hr) {
        ++errors;Safe();++attempts;
        Observe("handled_fault","{\"hr\":"+std::to_string(uint32_t(hr))+",\"attempt\":"+std::to_string(attempts)+"}");
        retryAt=attempts<4?GetTickCount64()+(250ull<<(attempts-1)):0;
    }
    void Step() {
        if(suspendRequested){if(!suspended){Safe();CloseGPU();suspended=true;}return;}
        if(suspended){suspended=false;rebuildRequested=true;}
        if(GetTickCount64()>=desktopCheck){desktopReady=InteractiveDesktop();desktopCheck=GetTickCount64()+500;}
        if(sessionLocked||!desktopReady){if(!sessionPaused){Safe();CloseGPU();sessionPaused=true;}return;}
        if(sessionPaused){sessionPaused=false;rebuildRequested=true;}
        if(dpiRequested){dpiRequested=false;origin={dpiRect.left,dpiRect.top};width=UINT(dpiRect.right-dpiRect.left);height=UINT(dpiRect.bottom-dpiRect.top);}
        bool needed=rebuildRequested||(!IsWindow(outputWindow)&&!fallback)||(capture&&capture->ended->load());
        if(needed){rebuildRequested=false;attempts=0;retryAt=GetTickCount64();Safe();}
        try {
            if(retryAt&&GetTickCount64()>=retryAt)Rebuild();
            if(!capture||PreciseMilliseconds()-lastRender<1000.0/30)return;
            check_hresult(gpu->device->GetDeviceRemovedReason());
            auto copyStart=PreciseMilliseconds();auto copied=capture->CopyLatest(*gpu,origin);copyMs+=PreciseMilliseconds()-copyStart;
            if(copied){
                ++copies;auto detectStart=PreciseMilliseconds();auto changed=detector->Changed(*gpu);detectMs+=PreciseMilliseconds()-detectStart;if(!changed)return;
                lastRender=detectStart;
                auto presentStart=PreciseMilliseconds();gpu->Draw(false,true);gpu->Present();presentMs+=PreciseMilliseconds()-presentStart;++renders;
                if(fallback){Place(outputWindow,origin,width,height);fallback=false;}
            }
        }catch(hresult_error const& e){Fault(e.code());}
    }
    void Run(DWORD ms,bool animate=false) {
        auto end=PreciseMilliseconds()+ms,nextAnimation=PreciseMilliseconds();
        while(PreciseMilliseconds()<end) {
            MSG msg{};while(PeekMessage(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessage(&msg);}
            if(animate&&PreciseMilliseconds()>=nextAnimation){phase=(phase+3)%25;InvalidateRect(sourceWindow,nullptr,FALSE);UpdateWindow(sourceWindow);++sourceUpdates;nextAnimation+=1000.0/30;if(nextAnimation<PreciseMilliseconds())nextAnimation=PreciseMilliseconds()+1000.0/30;}
            Step();HANDLE signal=capture?capture->ready->event:nullptr;
            double timeout=50;auto now=PreciseMilliseconds();
            if(capture&&now-lastRender<1000.0/30)timeout=1000.0/30-(now-lastRender);
            if(animate)timeout=std::min(timeout,std::max(0.01,nextAnimation-now));
            pacing.Arm(timeout);HANDLE waits[]{pacing.timer.get(),signal};
            MsgWaitForMultipleObjectsEx(signal?2:1,waits,INFINITE,QS_ALLINPUT,MWMO_INPUTAVAILABLE);
        }
    }
    void Verify(std::string name) {
        Run(600,true);
        Check(name+"_running",capture&&gpu&&!fallback&&IsWindowVisible(outputWindow));if(!capture||!gpu||fallback)return;
        auto raw=gpu->Read(true);gpu->Draw(false,false);auto flat=gpu->Read();gpu->Draw(false,true);auto lens=gpu->Read();gpu->Present();
        auto ink=dark?0x99c0d2u:0x234b69u,bg=dark?0x232f3eu:0xcde3efu;
        auto count=[&](uint32_t color){return std::count_if(raw.begin(),raw.end(),[&](uint32_t p){return(p&0xffffff)==color;});};
        Check(name+"_known_source",count(ink)>1000&&count(bg)>10000);
        Check(name+"_refraction",AllChanged(flat,lens,70)>300);
        Check(name+"_center",raw[(height/2)*width+width/2]==lens[(height/2)*width+width/2]);
        DWORD affinity{};Check(name+"_exclusion",GetWindowDisplayAffinity(outputWindow,&affinity)&&affinity==WDA_EXCLUDEFROMCAPTURE&&Magenta(raw)==0);
        // WDA also excludes the lens from GDI GetPixel. Stop capture BEFORE lifting exclusion for a physical-output check.
        capture.reset();check_hresult(SetWindowDisplayAffinity(outputWindow,WDA_NONE)?S_OK:E_FAIL);DwmFlush();Pump(80);
        bool presented=true;int worst{};
        for(POINT local:{POINT{LONG(width/2),LONG(height/2)},POINT{14,120},POINT{LONG(width)-15,120}}){
            POINT screen{origin.x+local.x,origin.y+local.y};HDC dc=GetDC(nullptr);auto pixel=GetPixel(dc,screen.x,screen.y);ReleaseDC(nullptr,dc);
            auto p=lens[local.y*width+local.x];int delta=abs(int(GetRValue(pixel))-int((p>>16)&255))+abs(int(GetGValue(pixel))-int((p>>8)&255))+abs(int(GetBValue(pixel))-int(p&255));
            worst=std::max(worst,delta);presented=presented&&WindowFromPoint(screen)==outputWindow&&pixel!=CLR_INVALID&&delta<20;
        }
        Check(name+"_visible_center_and_edges",presented,std::to_string(worst));
        check_hresult(SetWindowDisplayAffinity(outputWindow,WDA_EXCLUDEFROMCAPTURE)?S_OK:E_FAIL);DwmFlush();Pump(80);
        capture=std::make_unique<EventCapture>(*gpu,MonitorFromPoint(origin,MONITOR_DEFAULTTONEAREST),useWindowSource?sourceWindow:nullptr);
    }
};
unsigned long long CpuTime(){FILETIME c{},e{},k{},u{};GetProcessTimes(GetCurrentProcess(),&c,&e,&k,&u);return (uint64_t(k.dwHighDateTime)<<32|k.dwLowDateTime)+(uint64_t(u.dwHighDateTime)<<32|u.dwLowDateTime);}
PROCESS_MEMORY_COUNTERS_EX Memory(){PROCESS_MEMORY_COUNTERS_EX m{};m.cb=sizeof(m);GetProcessMemoryInfo(GetCurrentProcess(),reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&m),sizeof(m));return m;}
DWORD Handles(){DWORD n{};GetProcessHandleCount(GetCurrentProcess(),&n);return n;}
void Measure(Runtime& rt,const char* name,DWORD ms,bool animate) {
    rt.Run(1000,animate);auto cpu=CpuTime(),start=GetTickCount64();auto renders=rt.renders,copies=rt.copies;auto m0=Memory();auto h=Handles();
    auto updates=rt.sourceUpdates;auto copyMs=rt.copyMs,detectMs=rt.detectMs,presentMs=rt.presentMs;
    rt.Run(ms,animate);auto elapsed=GetTickCount64()-start;auto m=Memory();SYSTEM_INFO info{};GetSystemInfo(&info);
    double cpuCore=double(CpuTime()-cpu)/10000.0/double(elapsed)*100.0;
    std::ostringstream s;s<<std::fixed<<std::setprecision(3)<<"{\"phase\":\""<<name<<"\",\"elapsed_ms\":"<<elapsed<<",\"cpu_one_core_percent\":"<<cpuCore<<",\"cpu_machine_percent\":"<<cpuCore/info.dwNumberOfProcessors<<",\"renders\":"<<rt.renders-renders<<",\"copies\":"<<rt.copies-copies<<",\"working_set_mib\":"<<double(m.WorkingSetSize)/1048576<<",\"private_mib\":"<<double(m.PrivateUsage)/1048576<<",\"private_delta_mib\":"<<(double(m.PrivateUsage)-double(m0.PrivateUsage))/1048576<<",\"handle_delta\":"<<int(Handles())-int(h)<<"}";
    Observe("load",s.str());
    Observe("pipeline","{\"phase\":\""+std::string(name)+"\",\"source_updates\":"+std::to_string(rt.sourceUpdates-updates)+",\"copy_ms\":"+std::to_string(rt.copyMs-copyMs)+",\"detect_ms\":"+std::to_string(rt.detectMs-detectMs)+",\"draw_present_ms\":"+std::to_string(rt.presentMs-presentMs)+"}");
    if(!animate)Check(std::string(name)+"_no_idle_redraw",rt.renders==renders,std::to_string(rt.renders-renders));
    else Check("moving_background_renders",rt.renders-renders>100,std::to_string(rt.renders-renders));
    if(std::string(name)=="profile_motion") {
        auto fps=double(rt.renders-renders)*1000/elapsed;
        auto sourceFps=double(rt.sourceUpdates-updates)*1000/elapsed;
        Check("profile_source_30hz",sourceFps>=29&&sourceFps<=31,std::to_string(sourceFps));
        Check("profile_render_at_least_28fps",fps>=28,std::to_string(fps));
    }
}
void GpuTiming(GPU& gpu) {
    std::vector<double> values;
    for(int i=0;i<40;++i){
        com_ptr<ID3D11Query> disjoint,start,end;D3D11_QUERY_DESC q{D3D11_QUERY_TIMESTAMP_DISJOINT,0};check_hresult(gpu.device->CreateQuery(&q,disjoint.put()));
        q.Query=D3D11_QUERY_TIMESTAMP;check_hresult(gpu.device->CreateQuery(&q,start.put()));check_hresult(gpu.device->CreateQuery(&q,end.put()));
        gpu.context->Begin(disjoint.get());gpu.context->End(start.get());gpu.Draw(false,true);gpu.context->End(end.get());gpu.context->End(disjoint.get());gpu.context->Flush();
        D3D11_QUERY_DATA_TIMESTAMP_DISJOINT d{};UINT64 a{},b{};auto deadline=GetTickCount64()+2000;
        while(gpu.context->GetData(disjoint.get(),&d,sizeof(d),0)==S_FALSE&&GetTickCount64()<deadline)Sleep(1);
        check_hresult(gpu.context->GetData(disjoint.get(),&d,sizeof(d),0));
        HRESULT ha{},hb{};
        do{ha=gpu.context->GetData(start.get(),&a,sizeof(a),0);hb=gpu.context->GetData(end.get(),&b,sizeof(b),0);if(ha==S_FALSE||hb==S_FALSE)Sleep(1);}while((ha==S_FALSE||hb==S_FALSE)&&GetTickCount64()<deadline);
        if(i==0)Observe("timestamp_diagnostic","{\"disjoint\":"+std::to_string(d.Disjoint)+",\"frequency\":"+std::to_string(d.Frequency)+",\"start_hr\":"+std::to_string(ha)+",\"end_hr\":"+std::to_string(hb)+"}");
        if(!d.Disjoint&&d.Frequency&&ha==S_OK&&hb==S_OK)values.push_back(double(b-a)*1000000.0/d.Frequency);
    }
    Check("gpu_timestamp_samples",values.size()>=30);if(values.empty())return;std::sort(values.begin(),values.end());
    Observe("shader_gpu_microseconds","{\"samples\":"+std::to_string(values.size())+",\"median\":"+std::to_string(values[values.size()/2])+",\"p95\":"+std::to_string(values[size_t(values.size()*.95)])+"}");
    com_ptr<IDXGIAdapter> adapter;check_hresult(gpu.device.as<IDXGIDevice>()->GetAdapter(adapter.put()));auto adapter3=adapter.try_as<IDXGIAdapter3>();
    if(adapter3){DXGI_QUERY_VIDEO_MEMORY_INFO local{},shared{};check_hresult(adapter3->QueryVideoMemoryInfo(0,DXGI_MEMORY_SEGMENT_GROUP_LOCAL,&local));check_hresult(adapter3->QueryVideoMemoryInfo(0,DXGI_MEMORY_SEGMENT_GROUP_NON_LOCAL,&shared));Observe("gpu_process_memory","{\"local_bytes\":"+std::to_string(local.CurrentUsage)+",\"nonlocal_bytes\":"+std::to_string(shared.CurrentUsage)+"}");}
}
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR arguments,int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);init_apartment(apartment_type::multi_threaded);appInstance=instance;
    wchar_t exe[MAX_PATH]{};GetModuleFileName(nullptr,exe,MAX_PATH);auto bin=std::filesystem::path(exe).parent_path();
    artifacts=bin/("stability-"+std::to_string(GetTickCount64()));std::filesystem::create_directories(artifacts);logFile.open(artifacts/"checks.jsonl");
    HPOWERNOTIFY powerRegistration{};
    try {
        WNDCLASS wc{};wc.lpfnWndProc=StabilityProc;wc.hInstance=instance;wc.lpszClassName=L"Delo.StabilityProbe";if(!RegisterClass(&wc))throw hresult_error(E_FAIL);
        controlWindow=MakeWindow(L"Delo power controller",WS_EX_TOOLWINDOW,{0,0},1,1);
        powerRegistration=RegisterSuspendResumeNotification(controlWindow,DEVICE_NOTIFY_WINDOW_HANDLE);
        check_hresult(powerRegistration?S_OK:HRESULT_FROM_WIN32(GetLastError()));Check("modern_standby_registered",powerRegistration!=nullptr);
        check_hresult(WTSRegisterSessionNotification(controlWindow,NOTIFY_FOR_THIS_SESSION)?S_OK:HRESULT_FROM_WIN32(GetLastError()));
        std::vector<RECT> monitors;EnumDisplayMonitors(nullptr,nullptr,[](HMONITOR,HDC,LPRECT r,LPARAM p)->BOOL{reinterpret_cast<std::vector<RECT>*>(p)->push_back(*r);return TRUE;},reinterpret_cast<LPARAM>(&monitors));
        Observe("environment","{\"monitor_count\":"+std::to_string(monitors.size())+",\"system_dpi\":"+std::to_string(GetDpiForSystem())+",\"pid\":"+std::to_string(GetCurrentProcessId())+"}");
        Runtime rt(bin.parent_path()/"Glass.hlsl");sourceWindow=MakeWindow(L"Delo artificial grid",WS_EX_TOOLWINDOW,rt.origin,Width,Height);
        rt.Rebuild();rt.Verify("initial");
        if(wcsstr(arguments,L"--manual")) {
            Observe("manual_ready","true");auto deadline=GetTickCount64()+600000;
            while(GetTickCount64()<deadline&&(resumeEvents==0||sessionLocked||!InteractiveDesktop()))rt.Run(200);
            rt.Run(2500,true); // Wait for fresh post-unlock compositor/capture frames, not a secure-desktop black frame.
            Observe("manual_events","{\"suspend\":"+std::to_string(suspendEvents)+",\"resume\":"+std::to_string(resumeEvents)+",\"display\":"+std::to_string(displayEvents)+"}");
            Check("real_suspend_received",suspendEvents>0);Check("real_resume_received",resumeEvents>0);rt.Verify("after_real_sleep");
        } else if(wcsstr(arguments,L"--profile")) {
            Measure(rt,"profile_idle",12000,false);
            Measure(rt,"profile_motion",12000,true);
            Measure(rt,"profile_idle_after",12000,false);
            rt.Verify("after_profile");
        } else if(wcsstr(arguments,L"--soak")) {
            // Five minutes in one process; retain resources across motion/idle samples.
            rt.Run(3000,true);rt.Run(1000);
            auto baseline=Memory();auto baselineHandles=Handles();auto generation=rt.generation;
            Observe("soak_started","true");
            for(int i=0;i<10;++i) {
                auto name=std::string("soak_")+std::to_string(i)+(i%2==0?"_motion":"_idle");
                Measure(rt,name.c_str(),30000,i%2==0);
                auto current=Memory();auto handles=Handles();
                Observe("soak_resources","{\"sample\":"+std::to_string(i)+",\"private_delta_mib\":"+std::to_string((double(current.PrivateUsage)-double(baseline.PrivateUsage))/1048576)+",\"handles\":"+std::to_string(handles)+",\"handle_delta\":"+std::to_string(int(handles)-int(baselineHandles))+"}");
                Check(name+"_running",rt.capture&&rt.gpu&&!rt.fallback&&IsWindowVisible(outputWindow));
                Check(name+"_no_unexpected_rebuild",rt.generation==generation);
                Check(name+"_handles_bounded",handles<=baselineHandles+20);
                // Regression guard, not proof against slow leaks.
                Check(name+"_private_memory_bounded",double(current.PrivateUsage)<=double(baseline.PrivateUsage)+32*1048576.0);
            }
            rt.Verify("after_soak");GpuTiming(*rt.gpu);
        } else {
        auto g=rt.generation;rt.capture->session.Close();rt.Fault(RO_E_CLOSED);rt.Verify("closed_session");Check("capture_generation_changed",rt.generation>g);
        g=rt.generation;rt.Fault(DXGI_ERROR_DEVICE_REMOVED);rt.Verify("injected_device_removed");Check("device_recreated",rt.generation>g);
        rt.forceDenied=true;rt.Fault(E_ACCESSDENIED);rt.Run(2400);Check("bounded_retry_hidden",rt.attempts==4&&!rt.capture&&!IsWindowVisible(outputWindow));
        auto attempts=rt.attempts;rt.Run(400);Check("no_retry_spin",rt.attempts==attempts);
        rt.forceDenied=false;rebuildRequested=true;rt.Verify("permission_restored");
        SendMessage(outputWindow,WM_POWERBROADCAST,PBT_APMSUSPEND,0);rt.Run(200);Check("synthetic_suspend_released",!rt.gpu&&!rt.capture&&!IsWindowVisible(outputWindow));
        auto renders=rt.renders;rt.Run(300);Check("suspended_no_render",rt.renders==renders);
        SendMessage(outputWindow,WM_POWERBROADCAST,PBT_APMRESUMEAUTOMATIC,0);rt.Verify("synthetic_resume");
        SendMessage(outputWindow,WM_DISPLAYCHANGE,32,MAKELPARAM(1920,1200));rt.Verify("synthetic_displaychange");
        // Actual HWND/texture resize, synthetic DPI notification; does not change OS settings.
        RECT suggested{160,200,660,575};SendMessage(outputWindow,WM_DPICHANGED,MAKELONG(144,144),reinterpret_cast<LPARAM>(&suggested));rt.Verify("synthetic_dpi_actual_resize");
        Check("resized_resources",rt.width==500&&rt.height==375&&rt.gpu&&rt.gpu->Read().size()==500*375);
        rt.width=Width;rt.height=Height;rt.origin={80,160};rebuildRequested=true;rt.Verify("size_restored");
        // Real capture-item resizing exercises ContentSize / FramePool.Recreate independently of monitor hardware.
        rt.useWindowSource=true;rebuildRequested=true;rt.Verify("hwnd_capture");
        Place(sourceWindow,rt.origin,520,420,outputWindow);rt.Run(700,true);Check("actual_capture_pool_resize",rt.capture&&rt.capture->recreates>0&&rt.capture->size.Width==520&&rt.capture->size.Height==420);
        DestroyWindow(sourceWindow);rt.Run(100);Check("actual_item_closed_safe",rt.fallback&&!IsWindowVisible(outputWindow));
        sourceWindow=MakeWindow(L"Delo recovered grid",WS_EX_TOOLWINDOW,rt.origin,Width,Height);rt.useWindowSource=false;rebuildRequested=true;rt.Verify("source_recreated");
        // Destroy a surrogate owner, never Explorer. Owned HWND destruction must not end the process.
        testOwner=MakeWindow(L"Delo surrogate owner",WS_EX_TOOLWINDOW,{20,20},20,20);rt.owner=testOwner;
        SetLastError(0);auto previousOwner=SetWindowLongPtr(outputWindow,GWLP_HWNDPARENT,reinterpret_cast<LONG_PTR>(testOwner));check_hresult(previousOwner||GetLastError()==0?S_OK:HRESULT_FROM_WIN32(GetLastError()));
        HWND oldOutput=outputWindow;DestroyWindow(testOwner);testOwner=nullptr;Check("surrogate_owner_destroyed_output",!IsWindow(oldOutput));rt.Verify("owner_loss_window_recreated");
        RECT negative{-1920,-200,0,1000};auto clamped=ClampOrigin({-3000,1500},negative,Width,Height);Check("negative_monitor_coordinates",clamped.x==-1920&&clamped.y==700);
        for(size_t i=0;i<monitors.size();++i){rt.origin={monitors[i].left+80,monitors[i].top+100};rebuildRequested=true;rt.Verify("physical_monitor_"+std::to_string(i));}
        rt.origin={LONG_MAX,LONG_MAX};rebuildRequested=true;rt.Verify("offscreen_recovered");
        auto m0=Memory();auto h0=Handles();
        for(int i=0;i<8;++i){dark=(i%2)!=0;rt.Fault(DXGI_ERROR_DEVICE_RESET);rt.Verify("recovery_cycle_"+std::to_string(i));}
        auto m1=Memory();Observe("recovery_resource_delta","{\"cycles\":8,\"private_mib\":"+std::to_string((double(m1.PrivateUsage)-double(m0.PrivateUsage))/1048576)+",\"handles\":"+std::to_string(int(Handles())-int(h0))+"}");
        Check("recovery_handles_bounded",Handles()<=h0+20);
        rt.origin={80,160};rebuildRequested=true;rt.Verify("before_load");
        Measure(rt,"idle_monitor_capture",12000,false);Measure(rt,"moving_background_30hz",12000,true);Measure(rt,"idle_after_motion",12000,false);
        GpuTiming(*rt.gpu);
        SendMessage(outputWindow,WM_POWERBROADCAST,PBT_APMSUSPEND,0);rt.Run(100);Measure(rt,"suspended_released",6000,false);
        }
    }catch(hresult_error const& e){Check("exception",false,std::to_string(uint32_t(e.code())));}catch(std::exception const& e){Check("exception",false,e.what());}
    if(powerRegistration)UnregisterSuspendResumeNotification(powerRegistration);if(controlWindow)WTSUnRegisterSessionNotification(controlWindow);
    if(IsWindow(controlWindow))DestroyWindow(controlWindow);if(IsWindow(outputWindow))DestroyWindow(outputWindow);if(IsWindow(sourceWindow))DestroyWindow(sourceWindow);if(IsWindow(testOwner))DestroyWindow(testOwner);
    logFile<<"{\"failed_checks\":"<<failures<<"}\n";return failures?1:0;
}
