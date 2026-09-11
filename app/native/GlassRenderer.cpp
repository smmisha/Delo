#include "GlassRenderer.h"
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>
#include <d2d1.h>
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

#include <atomic>
#include <chrono>
namespace delo { namespace {
using namespace winrt; using namespace winrt::Windows::Graphics::Capture;
struct GPU {
    UINT renderWidth{400}, renderHeight{300};
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    com_ptr<ID3D11VertexShader> vs;
    com_ptr<ID3D11PixelShader> glass, blurH, blurV;
    com_ptr<ID3D11Buffer> constants;
    com_ptr<ID3D11SamplerState> sampler;
    com_ptr<ID3D11Texture2D> source, output;
    com_ptr<ID3D11RenderTargetView> sourceRT, outputRT;
    com_ptr<ID3D11ShaderResourceView> sourceView;
    com_ptr<ID3D11Texture2D> blurTexture[2];
    com_ptr<ID3D11RenderTargetView> blurRT[2];
    com_ptr<ID3D11ShaderResourceView> blurView[2];
    com_ptr<IDXGISwapChain1> swap;
    com_ptr<IDCompositionDevice> composition;
    com_ptr<IDCompositionTarget> target;
    com_ptr<IDCompositionVisual> visual;
    struct Params { float geometry[4]{400,300,36,24}; float state[4]{0,0,0,14}; } params;

    com_ptr<ID3DBlob> Compile(std::filesystem::path const& path, char const* entry, char const* model) {
        com_ptr<ID3DBlob> shader, errors;
        HRESULT hr=D3DCompileFromFile(path.c_str(),nullptr,D3D_COMPILE_STANDARD_FILE_INCLUDE,entry,model,D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,shader.put(),errors.put());
        if(FAILED(hr)&&errors) OutputDebugStringA(static_cast<char*>(errors->GetBufferPointer()));
        check_hresult(hr); return shader;
    }
    GPU(std::filesystem::path const& shader) {
        D3D_FEATURE_LEVEL level{};
        check_hresult(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,device.put(),&level,context.put()));
        auto dxgi=device.as<IDXGIDevice>(); com_ptr<IDXGIAdapter> adapter; check_hresult(dxgi->GetAdapter(adapter.put())); DXGI_ADAPTER_DESC desc{}; check_hresult(adapter->GetDesc(&desc));
        auto v=Compile(shader,"VS","vs_5_0"), p=Compile(shader,"Glass","ps_5_0");
        check_hresult(device->CreateVertexShader(v->GetBufferPointer(),v->GetBufferSize(),nullptr,vs.put()));
        check_hresult(device->CreatePixelShader(p->GetBufferPointer(),p->GetBufferSize(),nullptr,glass.put()));
        auto h=Compile(shader,"BlurH","ps_5_0"), b=Compile(shader,"BlurV","ps_5_0");
        check_hresult(device->CreatePixelShader(h->GetBufferPointer(),h->GetBufferSize(),nullptr,blurH.put()));
        check_hresult(device->CreatePixelShader(b->GetBufferPointer(),b->GetBufferSize(),nullptr,blurV.put()));
        D3D11_BUFFER_DESC cb{}; cb.ByteWidth=sizeof(Params); cb.BindFlags=D3D11_BIND_CONSTANT_BUFFER; check_hresult(device->CreateBuffer(&cb,nullptr,constants.put()));
        D3D11_SAMPLER_DESC ss{}; ss.Filter=D3D11_FILTER_MIN_MAG_MIP_LINEAR; ss.AddressU=ss.AddressV=ss.AddressW=D3D11_TEXTURE_ADDRESS_CLAMP; ss.MaxLOD=D3D11_FLOAT32_MAX;
        check_hresult(device->CreateSamplerState(&ss,sampler.put()));
        Resize(400,300);
    }
    void Resize(UINT width, UINT height) {
        if(!width||!height||width>8192||height>8192) throw hresult_error(E_INVALIDARG);
        context->ClearState();
        sourceView=nullptr; sourceRT=nullptr; outputRT=nullptr;
        source=nullptr; output=nullptr;
        for(int i=0;i<2;++i){blurView[i]=nullptr;blurRT[i]=nullptr;blurTexture[i]=nullptr;}
        renderWidth=width; renderHeight=height;
        params.geometry[0]=float(width); params.geometry[1]=float(height);
        if(swap) check_hresult(swap->ResizeBuffers(2,width,height,DXGI_FORMAT_UNKNOWN,0));
        D3D11_TEXTURE2D_DESC td{}; td.Width=width; td.Height=height; td.MipLevels=td.ArraySize=1; td.Format=DXGI_FORMAT_B8G8R8A8_UNORM; td.SampleDesc.Count=1; td.BindFlags=D3D11_BIND_RENDER_TARGET|D3D11_BIND_SHADER_RESOURCE;
        check_hresult(device->CreateTexture2D(&td,nullptr,source.put())); check_hresult(device->CreateTexture2D(&td,nullptr,output.put()));
        check_hresult(device->CreateRenderTargetView(source.get(),nullptr,sourceRT.put())); check_hresult(device->CreateRenderTargetView(output.get(),nullptr,outputRT.put()));
        check_hresult(device->CreateShaderResourceView(source.get(),nullptr,sourceView.put()));
        for(int i=0;i<2;++i){
            check_hresult(device->CreateTexture2D(&td,nullptr,blurTexture[i].put()));
            check_hresult(device->CreateRenderTargetView(blurTexture[i].get(),nullptr,blurRT[i].put()));
            check_hresult(device->CreateShaderResourceView(blurTexture[i].get(),nullptr,blurView[i].put()));
        }
    }
    void Draw(bool dark) {
        params.state[0]=1.f; params.state[2]=dark?1.f:0.f;
        context->UpdateSubresource(constants.get(),0,nullptr,&params,0,0);
        ID3D11ShaderResourceView* nullSRV=nullptr; context->PSSetShaderResources(0,1,&nullSRV);
        D3D11_VIEWPORT vp{0,0,float(renderWidth),float(renderHeight),0,1}; context->RSSetViewports(1,&vp);
        context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST); context->VSSetShader(vs.get(),nullptr,0);
        auto cb=constants.get(); context->PSSetConstantBuffers(0,1,&cb); auto sm=sampler.get(); context->PSSetSamplers(0,1,&sm);
        auto pass=[&](ID3D11PixelShader* shader,ID3D11ShaderResourceView* input,ID3D11RenderTargetView* targetRT){
            context->OMSetRenderTargets(1,&targetRT,nullptr);context->PSSetShader(shader,nullptr,0);
            context->PSSetShaderResources(0,1,&input);context->Draw(3,0);
            context->PSSetShaderResources(0,1,&nullSRV);context->OMSetRenderTargets(0,nullptr,nullptr);
        };
        pass(blurH.get(),sourceView.get(),blurRT[0].get());
        pass(blurV.get(),blurView[0].get(),blurRT[1].get());
        pass(glass.get(),blurView[1].get(),outputRT.get());
    }
    void Attach(HWND hwnd) {
        auto dxgi=device.as<IDXGIDevice>(); com_ptr<IDXGIAdapter> adapter; check_hresult(dxgi->GetAdapter(adapter.put())); com_ptr<IDXGIFactory2> factory; check_hresult(adapter->GetParent(__uuidof(IDXGIFactory2),factory.put_void()));
        DXGI_SWAP_CHAIN_DESC1 sd{}; sd.Width=renderWidth; sd.Height=renderHeight; sd.Format=DXGI_FORMAT_B8G8R8A8_UNORM; sd.SampleDesc.Count=1; sd.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT; sd.BufferCount=2; sd.SwapEffect=DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL; sd.Scaling=DXGI_SCALING_STRETCH; sd.AlphaMode=DXGI_ALPHA_MODE_PREMULTIPLIED;
        check_hresult(factory->CreateSwapChainForComposition(device.get(),&sd,nullptr,swap.put()));
        check_hresult(DCompositionCreateDevice(dxgi.get(),__uuidof(IDCompositionDevice),composition.put_void()));
        check_hresult(composition->CreateTargetForHwnd(hwnd,FALSE,target.put())); check_hresult(composition->CreateVisual(visual.put()));
        check_hresult(visual->SetContent(swap.get())); check_hresult(target->SetRoot(visual.get())); check_hresult(composition->Commit());
    }
    void Present() {
        com_ptr<ID3D11Texture2D> back; check_hresult(swap->GetBuffer(0,__uuidof(ID3D11Texture2D),back.put_void())); context->CopyResource(back.get(),output.get()); check_hresult(swap->Present(1,0));
    }
};

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
        D3D11_BLEND_DESC blend{};check_hresult(gpu.device->CreateBlendState(&blend,noWrite.put()));D3D11_QUERY_DESC q{D3D11_QUERY_OCCLUSION,0};check_hresult(gpu.device->CreateQuery(&q,query.put()));
        Resize(gpu);
    }
    // The reference frame mirrors the source crop, so a window resize only needs a new
    // texture — the shader, blend state and query outlive it.
    void Resize(GPU& gpu) {
        valid=false;view=nullptr;previous=nullptr;
        D3D11_TEXTURE2D_DESC desc{};gpu.source->GetDesc(&desc);desc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
        check_hresult(gpu.device->CreateTexture2D(&desc,nullptr,previous.put()));check_hresult(gpu.device->CreateShaderResourceView(previous.get(),nullptr,view.put()));
    }
    bool Changed(GPU& gpu) {
        bool changed=!valid;
        if(valid){
            auto& ctx=gpu.context;auto rt=gpu.outputRT.get();ctx->OMSetRenderTargets(1,&rt,nullptr);ctx->OMSetBlendState(noWrite.get(),nullptr,~0u);
            D3D11_VIEWPORT vp{0,0,float(gpu.renderWidth),float(gpu.renderHeight),0,1};ctx->RSSetViewports(1,&vp);ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            ctx->VSSetShader(gpu.vs.get(),nullptr,0);ctx->PSSetShader(shader.get(),nullptr,0);ID3D11ShaderResourceView* views[]{gpu.sourceView.get(),view.get()};ctx->PSSetShaderResources(0,2,views);
            ctx->Begin(query.get());ctx->Draw(3,0);ctx->End(query.get());ID3D11ShaderResourceView* none[2]{};ctx->PSSetShaderResources(0,2,none);ctx->OMSetRenderTargets(0,nullptr,nullptr);ctx->OMSetBlendState(nullptr,nullptr,~0u);
            UINT64 samples{};HRESULT hr{};auto deadline=GetTickCount64()+50;
            do{hr=ctx->GetData(query.get(),&samples,sizeof(samples),0);if(hr==S_FALSE)wait.Pause();}while(hr==S_FALSE&&GetTickCount64()<deadline);
            if(hr==S_FALSE)throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT));check_hresult(hr);changed=samples>0;
        }
        if(changed){gpu.context->CopyResource(previous.get(),gpu.source.get());valid=true;}return changed;
    }
};

struct Signal {
    HANDLE event=CreateEvent(nullptr,FALSE,FALSE,nullptr);
    Signal(){if(!event)throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));}
    ~Signal(){if(event)CloseHandle(event);}
};
struct EventCapture {
    GraphicsCaptureItem item{nullptr}; Direct3D11CaptureFramePool pool{nullptr}; GraphicsCaptureSession session{nullptr};
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice device{nullptr};
    winrt::Windows::Graphics::SizeInt32 size{};
    std::shared_ptr<Signal> ready=std::make_shared<Signal>();
    event_token arrived{},closed{}; bool subscribed{}; std::shared_ptr<std::atomic_bool> ended=std::make_shared<std::atomic_bool>(false);
    com_ptr<ID3D11Texture2D> latestTexture; RECT monitor{}; unsigned recreates{};
    EventCapture(GPU& gpu, HMONITOR handle) {
        auto interop=get_activation_factory<GraphicsCaptureItem,IGraphicsCaptureItemInterop>();
        MONITORINFO mi{sizeof(mi)};
        if(!GetMonitorInfo(handle,&mi))throw hresult_error(E_INVALIDARG);
        monitor=mi.rcMonitor;
        check_hresult(interop->CreateForMonitor(handle,guid_of<GraphicsCaptureItem>(),put_abi(item)));
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
    bool CopyLatest(GPU& gpu, POINT origin, bool force) {
        if(ended->load()) throw hresult_error(RO_E_CLOSED);
        Direct3D11CaptureFrame latest{nullptr};
        while(auto next=pool.TryGetNextFrame()){if(latest)latest.Close();latest=next;}
        if(!latest&&!force)return false; if(!latest&&!latestTexture)return false;
        auto content=latest?latest.ContentSize():size;
        if(content.Width!=size.Width||content.Height!=size.Height) {
            latest.Close(); if(content.Width<=0||content.Height<=0)return false;
            latestTexture=nullptr; size=content; pool.Recreate(device,winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size); ++recreates; return false;
        }
        LONG x=origin.x-monitor.left, y=origin.y-monitor.top;
        if(latest) { auto access=latest.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        com_ptr<ID3D11Texture2D> texture; check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D),texture.put_void()));
        D3D11_TEXTURE2D_DESC captured{}; texture->GetDesc(&captured);
        if(!latestTexture) {
            captured.BindFlags=0; captured.MiscFlags=0; captured.CPUAccessFlags=0;
            captured.Usage=D3D11_USAGE_DEFAULT;
            check_hresult(gpu.device->CreateTexture2D(&captured,nullptr,latestTexture.put()));
        }
        gpu.context->CopyResource(latestTexture.get(),texture.get());
        } auto texture=latestTexture; D3D11_TEXTURE2D_DESC desc{}; texture->GetDesc(&desc);
        // A straddling window uses neutral material outside the chosen monitor.
        const float neutral[]{0.12f,0.16f,0.21f,1.f};
        gpu.context->ClearRenderTargetView(gpu.sourceRT.get(),neutral);
        LONG left=std::max(0L,x), top=std::max(0L,y);
        LONG right=std::min<LONG>(x+LONG(gpu.renderWidth),std::min<LONG>(content.Width,LONG(desc.Width)));
        LONG bottom=std::min<LONG>(y+LONG(gpu.renderHeight),std::min<LONG>(content.Height,LONG(desc.Height)));
        if(right>left&&bottom>top) {
            D3D11_BOX box{UINT(left),UINT(top),0,UINT(right),UINT(bottom),1};
            gpu.context->CopySubresourceRegion(gpu.source.get(),0,UINT(left-x),UINT(top-y),0,texture.get(),0,&box);
        }
        if(latest)latest.Close(); return true;
    }
};
} // namespace


struct GlassRenderer::Impl {
    HWND host;
    std::filesystem::path shader;
    std::unique_ptr<GPU> gpu;
    std::unique_ptr<EventCapture> capture;
    std::unique_ptr<ChangeDetector> detector;
    HMONITOR monitor{};
    POINT origin{};
    UINT width{},height{};
    bool dark{}, suspended{}, frozen{}, dirty{true}, ready{}, ticking{}, resetPending{};
    unsigned attempts{};
    ULONGLONG retryAt{}, captureStarted{};
    std::string error;
    Counters counts;
    Impl(HWND h,std::filesystem::path p):host(h),shader(std::move(p)){}
    ~Impl(){Close();}
    void Close() noexcept {
        ready=false; capture.reset();detector.reset();
        if(gpu) {
            if(gpu->target)gpu->target->SetRoot(nullptr);
            if(gpu->composition)gpu->composition->Commit();
            gpu->context->ClearState();gpu->context->Flush();gpu.reset();
        }
    }
    void Reset() {Close(); attempts=0; retryAt=0; dirty=true;}
    // WGC/DComp calls can pump a nested window message. Resume and display-change
    // messages received from that nested loop must not destroy gpu/capture while Tick
    // is dereferencing them. Defer the teardown until the outer Tick has unwound.
    void ScheduleReset() {if(ticking)resetPending=true;else Reset();}
    // The corner radius is clamped against the shorter side, so it is recomputed on
    // every size change, not only when the renderer is built.
    void ApplyGeometry() {
        if(!gpu)return;
        auto scale=float(GetDpiForWindow(host))/96.f;
        gpu->params.geometry[2]=std::min(36.f*scale,float(std::min(width,height))/2.f-8.f);
        gpu->params.geometry[3]=24.f*scale;gpu->params.state[3]=14.f*scale;
    }
    void Scale(float x, float y) {
        if(!gpu||!gpu->visual||!gpu->composition)return;
        D2D_MATRIX_3X2_F m{x,0,0,y,0,0};
        if(FAILED(gpu->visual->SetTransform(m)))return;
        gpu->composition->Commit();
    }
    // While frozen the held frame keeps its old pixel size, so a resize gesture would
    // expose bare desktop along the new edges. Scaling the composition visual stretches
    // the material to the window instead; the next live frame replaces it exactly.
    void Stretch() {
        if(!frozen||!gpu)return;
        RECT rect{};if(!GetClientRect(host,&rect))return;
        if(!gpu->renderWidth||!gpu->renderHeight||rect.right<=0||rect.bottom<=0)return;
        Scale(float(rect.right)/float(gpu->renderWidth),float(rect.bottom)/float(gpu->renderHeight));
    }
    void Fault(HRESULT hr) {
        Close();++counts.errors;++attempts;
        std::ostringstream message;message<<"Glass renderer HRESULT 0x"<<std::hex<<uint32_t(hr);
        error=message.str();OutputDebugStringA((error+"\n").c_str());
        retryAt=GetTickCount64()+(250ull<<std::min(attempts-1,3u));
    }
    void Build() {
        DWORD affinity{};
        if(!SetWindowDisplayAffinity(host,WDA_EXCLUDEFROMCAPTURE)||
           !GetWindowDisplayAffinity(host,&affinity)||affinity!=WDA_EXCLUDEFROMCAPTURE)
            throw hresult_error(E_ACCESSDENIED);
        if(!GraphicsCaptureSession::IsSupported())throw hresult_error(E_NOTIMPL);
        gpu=std::make_unique<GPU>(shader);gpu->Resize(width,height);ApplyGeometry();
        gpu->Attach(host);detector=std::make_unique<ChangeDetector>(*gpu);
        capture=std::make_unique<EventCapture>(*gpu,monitor);
        ++counts.recoveries;captureStarted=GetTickCount64();dirty=true;
    }
    void Tick() {
        if(ticking)return;
        ticking=true;
        struct TickExit {
            Impl* self;
            ~TickExit(){self->ticking=false;if(self->resetPending){self->resetPending=false;self->Reset();}}
        } exit{this};
        if(resetPending){resetPending=false;Reset();}
        // Frozen returns before the size/monitor check on purpose: a Reset here would
        // tear the swapchain down mid-gesture and the window would go blank.
        if(frozen||suspended||!IsWindow(host)||!IsWindowVisible(host)||IsIconic(host))return;
        RECT rect{};if(!GetClientRect(host,&rect))return;
        UINT w=UINT(rect.right),h=UINT(rect.bottom);if(!w||!h)return;
        POINT position{};if(!ClientToScreen(host,&position))return;
        auto m=MonitorFromWindow(host,MONITOR_DEFAULTTONEAREST);
        bool moved=origin.x!=position.x||origin.y!=position.y;
        origin=position;
        // A new monitor means a new capture session, so that still goes through Reset.
        // A size change does not: the session is monitor-wide and size-independent, and
        // rebuilding the D3D device plus the WGC session for it cost a visible flash of
        // the opaque fallback on every resize.
        if(m!=monitor){width=w;height=h;monitor=m;Reset();}
        else if(w!=width||h!=height){
            width=w;height=h;
            if(gpu){
                try{gpu->Resize(width,height);ApplyGeometry();detector->Resize(*gpu);dirty=true;}
                catch(hresult_error const& e){Fault(e.code());}
                catch(std::exception const&){Fault(E_FAIL);}
            }
        }
        try {
            if(!gpu){if(attempts>=4||GetTickCount64()<retryAt)return;Build();}
            check_hresult(gpu->device->GetDeviceRemovedReason());
            if(!ready&&GetTickCount64()-captureStarted>10000)throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT));
            DWORD affinity{};
            if(!GetWindowDisplayAffinity(host,&affinity)||affinity!=WDA_EXCLUDEFROMCAPTURE)
                throw hresult_error(E_ACCESSDENIED);
            if(capture->CopyLatest(*gpu,origin,moved||dirty)) {
                ++counts.copied;
                bool changed=detector->Changed(*gpu);
                if(changed||dirty) {
                    gpu->Draw(dark);gpu->Present();++counts.rendered;
                    ready=true;dirty=false;attempts=0;error.clear();
                }
            }
        }catch(hresult_error const& e){Fault(e.code());}
         catch(std::exception const&){Fault(E_FAIL);}
    }
};
GlassRenderer::GlassRenderer(HWND host,std::filesystem::path shaderPath)
    :impl_(std::make_unique<Impl>(host,std::move(shaderPath))){}
GlassRenderer::~GlassRenderer()=default;
void GlassRenderer::Tick(){impl_->Tick();}
// Tick picks the new client size up by itself and resizes the textures in place, so this
// only has to ask for a redraw. A full teardown is Rebuild, for when the capture session
// itself is no longer valid.
void GlassRenderer::Resize(){impl_->dirty=true;}
void GlassRenderer::Rebuild(){impl_->ScheduleReset();}
void GlassRenderer::Stretch(){impl_->Stretch();}
void GlassRenderer::SetDark(bool dark){if(impl_->dark!=dark){impl_->dark=dark;impl_->dirty=true;}}
void GlassRenderer::Freeze(bool frozen){if(impl_->frozen==frozen)return;impl_->frozen=frozen;if(!frozen){impl_->Scale(1.f,1.f);impl_->dirty=true;}}
void GlassRenderer::Suspend(bool suspended){if(impl_->suspended!=suspended){impl_->suspended=suspended;impl_->ScheduleReset();}}
bool GlassRenderer::Healthy()const{return impl_->ready;}
std::string GlassRenderer::LastError()const{return impl_->error;}
GlassRenderer::Counters GlassRenderer::GetCounters()const{return impl_->counts;}
HANDLE GlassRenderer::EventHandle()const{return impl_->capture?impl_->capture->ready->event:nullptr;}
} // namespace delo
