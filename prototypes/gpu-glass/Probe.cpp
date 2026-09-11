#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>
#include <dcomp.h>
#include <dwmapi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <filesystem>
#include <fstream>
#include <vector>
#include <sstream>
#include <algorithm>

using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
constexpr UINT Width = 400, Height = 300;
using Pixels = std::vector<uint32_t>;
HWND sourceWindow{}, outputWindow{};
bool dark{}; int phase{}, failures{};
std::ofstream logFile;
std::filesystem::path artifacts;

void Check(std::string const& name, bool ok, std::string const& detail = "") {
    logFile << "{\"check\":\"" << name << "\",\"passed\":" << (ok ? "true" : "false")
            << ",\"detail\":\"" << detail << "\"}\n"; logFile.flush();
    if (!ok) ++failures;
}
void Pump(DWORD ms) {
    auto end = GetTickCount64() + ms;
    do { MSG m{}; while (PeekMessage(&m, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&m); DispatchMessage(&m); } Sleep(5); } while (GetTickCount64() < end);
}
LRESULT CALLBACK Proc(HWND hwnd, UINT msg, WPARAM w, LPARAM l) {
    if (msg == WM_ERASEBKGND) return 1;
    if (msg == WM_PAINT) {
        PAINTSTRUCT ps{}; auto dc = BeginPaint(hwnd, &ps);
        if (hwnd == sourceWindow) {
            RECT r{}; GetClientRect(hwnd, &r);
            auto bg = CreateSolidBrush(dark ? RGB(35,47,62) : RGB(205,227,239)); FillRect(dc, &r, bg); DeleteObject(bg);
            auto pen = CreatePen(PS_SOLID, 3, dark ? RGB(153,192,210) : RGB(35,75,105)); auto old = SelectObject(dc, pen);
            for (int x = -phase; x < int(Width); x += 25) { MoveToEx(dc,x,0,nullptr); LineTo(dc,x,Height); }
            for (int y = -phase; y < int(Height); y += 25) { MoveToEx(dc,0,y,nullptr); LineTo(dc,Width,y); }
            SelectObject(dc, old); DeleteObject(pen);
        }
        EndPaint(hwnd, &ps); return 0;
    }
    return DefWindowProc(hwnd,msg,w,l);
}
void Save(std::string const& name, Pixels const& pixels) {
    BITMAPFILEHEADER fh{}; fh.bfType=0x4d42; fh.bfOffBits=54; fh.bfSize=54+Width*Height*4;
    BITMAPINFOHEADER ih{sizeof(ih), LONG(Width), -LONG(Height), 1, 32, BI_RGB};
    std::ofstream file(artifacts / (name+".bmp"), std::ios::binary);
    file.write(reinterpret_cast<char*>(&fh),sizeof(fh)); file.write(reinterpret_cast<char*>(&ih),sizeof(ih));
    file.write(reinterpret_cast<char const*>(pixels.data()),pixels.size()*4);
}
int Difference(Pixels const& a, Pixels const& b, bool edge) {
    int changed{};
    for (UINT y=65; y<Height-65; ++y) for (UINT x=0; x<Width; ++x) {
        bool in = edge ? ((x>=10&&x<32)||(x>=Width-32&&x<Width-10)) : (x>=90&&x<Width-90);
        if (!in) continue;
        int d{}; for(int s=0;s<24;s+=8) d+=abs(int((a[y*Width+x]>>s)&255)-int((b[y*Width+x]>>s)&255));
        if(d>70) ++changed;
    }
    return changed;
}

struct GPU {
    UINT renderWidth{Width}, renderHeight{Height};
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    com_ptr<ID3D11VertexShader> vs;
    com_ptr<ID3D11PixelShader> grid, glass;
    com_ptr<ID3D11Buffer> constants;
    com_ptr<ID3D11SamplerState> sampler;
    com_ptr<ID3D11Texture2D> source, output, staging;
    com_ptr<ID3D11RenderTargetView> sourceRT, outputRT;
    com_ptr<ID3D11ShaderResourceView> sourceView;
    com_ptr<IDXGISwapChain1> swap;
    com_ptr<IDCompositionDevice> composition;
    com_ptr<IDCompositionTarget> target;
    com_ptr<IDCompositionVisual> visual;
    struct Params { float geometry[4]{float(Width),float(Height),44,24}; float state[4]{0,0,0,14}; } params;

    com_ptr<ID3DBlob> Compile(std::filesystem::path const& path, char const* entry, char const* model) {
        com_ptr<ID3DBlob> shader, errors;
        HRESULT hr=D3DCompileFromFile(path.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,entry,model,D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,shader.put(),errors.put());
        if(FAILED(hr)&&errors) { std::ofstream f(artifacts / "shader-error.txt"); f.write((char*)errors->GetBufferPointer(),errors->GetBufferSize()); }
        check_hresult(hr); return shader;
    }
    GPU(std::filesystem::path const& shader) {
        D3D_FEATURE_LEVEL level{};
        check_hresult(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,device.put(),&level,context.put()));
        auto dxgi=device.as<IDXGIDevice>(); com_ptr<IDXGIAdapter> adapter; check_hresult(dxgi->GetAdapter(adapter.put())); DXGI_ADAPTER_DESC desc{}; check_hresult(adapter->GetDesc(&desc));
        Check("hardware_device",level>=D3D_FEATURE_LEVEL_11_0,to_string(desc.Description));
        auto v=Compile(shader,"VS","vs_5_0"), g=Compile(shader,"Grid","ps_5_0"), p=Compile(shader,"Glass","ps_5_0");
        check_hresult(device->CreateVertexShader(v->GetBufferPointer(),v->GetBufferSize(),nullptr,vs.put()));
        check_hresult(device->CreatePixelShader(g->GetBufferPointer(),g->GetBufferSize(),nullptr,grid.put()));
        check_hresult(device->CreatePixelShader(p->GetBufferPointer(),p->GetBufferSize(),nullptr,glass.put()));
        D3D11_BUFFER_DESC cb{}; cb.ByteWidth=sizeof(Params); cb.BindFlags=D3D11_BIND_CONSTANT_BUFFER; check_hresult(device->CreateBuffer(&cb,nullptr,constants.put()));
        D3D11_SAMPLER_DESC ss{}; ss.Filter=D3D11_FILTER_MIN_MAG_MIP_LINEAR; ss.AddressU=ss.AddressV=ss.AddressW=D3D11_TEXTURE_ADDRESS_CLAMP; ss.MaxLOD=D3D11_FLOAT32_MAX;
        check_hresult(device->CreateSamplerState(&ss,sampler.put()));
        Resize(Width,Height);
    }
    void Resize(UINT width, UINT height) {
        if(!width||!height||width>8192||height>8192) throw hresult_error(E_INVALIDARG);
        context->ClearState();
        sourceView=nullptr; sourceRT=nullptr; outputRT=nullptr;
        source=nullptr; output=nullptr; staging=nullptr;
        renderWidth=width; renderHeight=height;
        params.geometry[0]=float(width); params.geometry[1]=float(height);
        if(swap) check_hresult(swap->ResizeBuffers(2,width,height,DXGI_FORMAT_UNKNOWN,0));
        D3D11_TEXTURE2D_DESC td{}; td.Width=width; td.Height=height; td.MipLevels=td.ArraySize=1; td.Format=DXGI_FORMAT_B8G8R8A8_UNORM; td.SampleDesc.Count=1; td.BindFlags=D3D11_BIND_RENDER_TARGET|D3D11_BIND_SHADER_RESOURCE;
        check_hresult(device->CreateTexture2D(&td,nullptr,source.put())); check_hresult(device->CreateTexture2D(&td,nullptr,output.put()));
        check_hresult(device->CreateRenderTargetView(source.get(),nullptr,sourceRT.put())); check_hresult(device->CreateRenderTargetView(output.get(),nullptr,outputRT.put()));
        check_hresult(device->CreateShaderResourceView(source.get(),nullptr,sourceView.put()));
        td.BindFlags=0; td.Usage=D3D11_USAGE_STAGING; td.CPUAccessFlags=D3D11_CPU_ACCESS_READ; check_hresult(device->CreateTexture2D(&td,nullptr,staging.put()));
    }
    void Draw(bool sourcePass, bool lens) {
        params.state[0]=lens?1.f:0.f; params.state[1]=float(phase); params.state[2]=dark?1.f:0.f;
        context->UpdateSubresource(constants.get(),0,nullptr,&params,0,0);
        ID3D11ShaderResourceView* nullSRV=nullptr; context->PSSetShaderResources(0,1,&nullSRV);
        auto rt=sourcePass?sourceRT.get():outputRT.get(); context->OMSetRenderTargets(1,&rt,nullptr);
        D3D11_VIEWPORT vp{0,0,float(renderWidth),float(renderHeight),0,1}; context->RSSetViewports(1,&vp);
        context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST); context->VSSetShader(vs.get(),nullptr,0); context->PSSetShader(sourcePass?grid.get():glass.get(),nullptr,0);
        auto cb=constants.get(); context->PSSetConstantBuffers(0,1,&cb); auto sm=sampler.get(); context->PSSetSamplers(0,1,&sm);
        if(!sourcePass) { auto srv=sourceView.get(); context->PSSetShaderResources(0,1,&srv); }
        context->Draw(3,0); context->PSSetShaderResources(0,1,&nullSRV); context->OMSetRenderTargets(0,nullptr,nullptr);
    }
    Pixels Read(bool readSource=false) {
        context->CopyResource(staging.get(),readSource?source.get():output.get());
        D3D11_MAPPED_SUBRESOURCE map{}; check_hresult(context->Map(staging.get(),0,D3D11_MAP_READ,0,&map));
        Pixels result(size_t(renderWidth)*renderHeight);
        for(UINT y=0;y<renderHeight;++y) memcpy(result.data()+y*renderWidth,(char*)map.pData+y*map.RowPitch,renderWidth*4);
        context->Unmap(staging.get(),0); return result;
    }
    void Attach(HWND hwnd) {
        auto dxgi=device.as<IDXGIDevice>(); com_ptr<IDXGIAdapter> adapter; check_hresult(dxgi->GetAdapter(adapter.put())); com_ptr<IDXGIFactory2> factory; check_hresult(adapter->GetParent(__uuidof(IDXGIFactory2),factory.put_void()));
        DXGI_SWAP_CHAIN_DESC1 sd{}; sd.Width=renderWidth; sd.Height=renderHeight; sd.Format=DXGI_FORMAT_B8G8R8A8_UNORM; sd.SampleDesc.Count=1; sd.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT; sd.BufferCount=2; sd.SwapEffect=DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL; sd.Scaling=DXGI_SCALING_STRETCH; sd.AlphaMode=DXGI_ALPHA_MODE_PREMULTIPLIED;
        check_hresult(factory->CreateSwapChainForComposition(device.get(),&sd,nullptr,swap.put()));
        check_hresult(DCompositionCreateDevice(dxgi.get(),__uuidof(IDCompositionDevice),composition.put_void()));
        check_hresult(composition->CreateTargetForHwnd(hwnd,TRUE,target.put())); check_hresult(composition->CreateVisual(visual.put()));
        check_hresult(visual->SetContent(swap.get())); check_hresult(target->SetRoot(visual.get())); check_hresult(composition->Commit());
    }
    void Present() {
        com_ptr<ID3D11Texture2D> back; check_hresult(swap->GetBuffer(0,__uuidof(ID3D11Texture2D),back.put_void())); context->CopyResource(back.get(),output.get()); check_hresult(swap->Present(1,0));
    }
};

struct CaptureSource {
    GraphicsCaptureItem item{nullptr}; Direct3D11CaptureFramePool pool{nullptr}; GraphicsCaptureSession session{nullptr};
    CaptureSource(GPU& gpu, HWND hwnd) {
        if(!GraphicsCaptureSession::IsSupported()) throw hresult_error(E_NOTIMPL);
        auto interop=get_activation_factory<GraphicsCaptureItem,IGraphicsCaptureItemInterop>();
        check_hresult(interop->CreateForWindow(hwnd,guid_of<GraphicsCaptureItem>(),put_abi(item)));
        auto size=item.Size(); Check("capture_size",size.Width==Width&&size.Height==Height,std::to_string(size.Width)+"x"+std::to_string(size.Height));
        if(size.Width!=Width||size.Height!=Height) throw hresult_error(E_INVALIDARG);
        com_ptr<::IInspectable> inspectable; check_hresult(CreateDirect3D11DeviceFromDXGIDevice(gpu.device.as<IDXGIDevice>().get(),inspectable.put()));
        auto runtimeDevice=inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
        pool=Direct3D11CaptureFramePool::CreateFreeThreaded(runtimeDevice,winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size);
        session=pool.CreateCaptureSession(item); session.IsCursorCaptureEnabled(false); session.StartCapture();
    }
    ~CaptureSource() { if(session) session.Close(); if(pool) pool.Close(); }
    void Update(GPU& gpu) {
        // Discard old frames before invalidating our source; never reuse a stale frame as a live result.
        while(auto old=pool.TryGetNextFrame()) old.Close();
        InvalidateRect(sourceWindow,nullptr,FALSE); UpdateWindow(sourceWindow);
        auto end=GetTickCount64()+3000;
        while(GetTickCount64()<end) {
            Pump(20);
            if(auto frame=pool.TryGetNextFrame()) {
                auto access=frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
                com_ptr<ID3D11Texture2D> texture; check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D),texture.put_void()));
                D3D11_BOX box{0,0,0,Width,Height,1}; gpu.context->CopySubresourceRegion(gpu.source.get(),0,0,0,0,texture.get(),0,&box);
                frame.Close(); return;
            }
        }
        throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT));
    }
};

#ifndef DELO_GPU_NO_MAIN
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR arguments,int) {
    init_apartment(apartment_type::multi_threaded); SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    wchar_t exe[MAX_PATH]{}; GetModuleFileName(nullptr,exe,MAX_PATH); auto bin=std::filesystem::path(exe).parent_path();
    bool external=wcsstr(arguments,L"--external")!=nullptr;
    artifacts=bin / (std::string(external?"external-":"internal-")+std::to_string(GetTickCount64())); std::filesystem::create_directories(artifacts); logFile.open(artifacts/"checks.jsonl");
    HWND previous=GetForegroundWindow();
    try {
        GPU gpu(bin.parent_path()/"Glass.hlsl");
        WNDCLASS wc{}; wc.lpfnWndProc=Proc; wc.hInstance=instance; wc.lpszClassName=L"Delo.GPUProbe"; if(!RegisterClass(&wc)) check_hresult(HRESULT_FROM_WIN32(GetLastError()));
        sourceWindow=CreateWindowEx(WS_EX_TOOLWINDOW,wc.lpszClassName,L"Delo owned capture source",WS_POPUP,120,160,Width,Height,nullptr,nullptr,instance,nullptr);
        outputWindow=CreateWindowEx(WS_EX_TOOLWINDOW|WS_EX_NOREDIRECTIONBITMAP,wc.lpszClassName,L"Delo GPU refraction",WS_POPUP,560,160,Width,Height,nullptr,nullptr,instance,nullptr);
        if(!sourceWindow||!outputWindow) throw hresult_error(E_FAIL);
        if(external) { ShowWindow(sourceWindow,SW_SHOWNOACTIVATE); ShowWindow(sourceWindow,SW_SHOWNOACTIVATE); SetWindowPos(sourceWindow,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE); }
        gpu.Attach(outputWindow); ShowWindow(outputWindow,SW_SHOWNOACTIVATE); ShowWindow(outputWindow,SW_SHOWNOACTIVATE); SetWindowPos(outputWindow,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
        Pump(200);
        std::unique_ptr<CaptureSource> capture; if(external) capture=std::make_unique<CaptureSource>(gpu,sourceWindow);
        for(bool theme:{false,true}) {
            dark=theme; phase=0; std::string name=std::string(external?"external_":"internal_")+(dark?"dark":"light");
            if(capture) capture->Update(gpu); else gpu.Draw(true,false);
            auto raw=gpu.Read(true); Save(name+"_source",raw);
            gpu.Draw(false,false); auto identity=gpu.Read(); Save(name+"_identity",identity);
            gpu.Draw(false,true); auto lens=gpu.Read(); Save(name+"_lens",lens); gpu.Present(); Pump(200);
            int edge=Difference(identity,lens,true), center=Difference(identity,lens,false);
            Check(name+"_edge_displacement",edge>300,std::to_string(edge)); Check(name+"_center_preserved",center==0,std::to_string(center));
            Check(name+"_identity_source",Difference(raw,identity,false)==0);
            Check(name+"_alpha",(lens[0]>>24)==0&&(lens[(Height/2)*Width+Width/2]>>24)==255);
            phase=9; if(capture) capture->Update(gpu); else gpu.Draw(true,false);
            auto rawMoved=gpu.Read(true); gpu.Draw(false,true); auto moved=gpu.Read(); Save(name+"_moved",moved); gpu.Present(); Pump(200);
            Check(name+"_live_source",Difference(raw,rawMoved,false)>300); Check(name+"_live_lens",Difference(lens,moved,false)>300);
            // Sample opaque parts of our own output only: center AND refracted edges.
            bool presented=true; int maxDifference=0;
            for(POINT local : {POINT{200,150}, POINT{14,120}, POINT{22,132}, POINT{378,132}, POINT{385,120}}) {
                POINT p=local; ClientToScreen(outputWindow,&p);
                if(GetAncestor(WindowFromPoint(p),GA_ROOT)!=outputWindow) { presented=false; break; }
                HDC dc=GetDC(nullptr); COLORREF color=GetPixel(dc,p.x,p.y); ReleaseDC(nullptr,dc);
                auto expected=moved[local.y*Width+local.x]; int d=abs(int(GetRValue(color))-int((expected>>16)&255))+abs(int(GetGValue(color))-int((expected>>8)&255))+abs(int(GetBValue(color))-int(expected&255));
                maxDifference=std::max(maxDifference,d); presented=presented&&color!=CLR_INVALID&&d<15;
            }
            Check(name+"_presented_center_and_edges",presented,std::to_string(maxDifference));
            if(capture) {
                SetWindowPos(outputWindow,HWND_TOPMOST,120,160,0,0,SWP_NOSIZE|SWP_NOACTIVATE); Pump(150);
                POINT p{200,150}; ClientToScreen(sourceWindow,&p);
                Check(name+"_source_occluded_by_output",GetAncestor(WindowFromPoint(p),GA_ROOT)==outputWindow);
                phase=0; capture->Update(gpu); auto occluded=gpu.Read(true);
                int feedback=Difference(raw,occluded,false)+Difference(raw,occluded,true);
                Check(name+"_capture_excludes_output",feedback==0,std::to_string(feedback));
                gpu.Draw(false,true); auto overlay=gpu.Read(); Save(name+"_occluded_lens",overlay); gpu.Present(); Pump(100);
                Check(name+"_occluded_source_updated",Difference(rawMoved,occluded,false)>300);
                SetWindowPos(outputWindow,HWND_TOPMOST,560,160,0,0,SWP_NOSIZE|SWP_NOACTIVATE); Pump(100);
            }
        }
        Check("device_not_removed",SUCCEEDED(gpu.device->GetDeviceRemovedReason()));
    } catch(hresult_error const& e) { std::ostringstream s; s<<"HRESULT 0x"<<std::hex<<uint32_t(e.code()); Check("exception",false,s.str()); }
      catch(std::exception const&) { Check("exception",false,"standard_exception"); }
    if(outputWindow) DestroyWindow(outputWindow); if(sourceWindow) DestroyWindow(sourceWindow); if(IsWindow(previous)) SetForegroundWindow(previous);
    logFile<<"{\"failed_checks\":"<<failures<<"}\n"; logFile.close(); return failures?1:0;
}
#endif
