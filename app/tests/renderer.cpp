// Offscreen verification of the production GPU implementation, with synthetic data.
#include "../native/GlassRenderer.cpp"
#include <iostream>
#include <cmath>

void Require(bool ok,char const* name){if(!ok)throw std::runtime_error(name);std::cout<<"PASS "<<name<<'\n';}
int pendingReads{};
HRESULT PendingRead(ID3D11DeviceContext*,ID3D11Query*,UINT64*){++pendingReads;return S_FALSE;}
HRESULT FailedRead(ID3D11DeviceContext*,ID3D11Query*,UINT64*){return DXGI_ERROR_DEVICE_REMOVED;}
bool AwaitComparison(delo::ChangeDetector& detector,delo::GPU& gpu){
    const auto end=GetTickCount64()+1000;bool changed{};
    do{changed=detector.Changed(gpu,false,false);if(!detector.pending)return changed;Sleep(1);}while(GetTickCount64()<end);
    throw std::runtime_error("GPU comparison test deadline");
}
void FillSource(delo::GPU& gpu,uint32_t color){
    std::vector<uint32_t> pixels(size_t(gpu.renderWidth)*gpu.renderHeight,color);
    gpu.context->UpdateSubresource(gpu.source.get(),0,nullptr,pixels.data(),gpu.renderWidth*4,0);
}
uint32_t ReferencePixel(delo::GPU& gpu,delo::ChangeDetector& detector){
    D3D11_TEXTURE2D_DESC desc{};detector.previous->GetDesc(&desc);desc.BindFlags=0;desc.Usage=D3D11_USAGE_STAGING;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
    winrt::com_ptr<ID3D11Texture2D> readback;winrt::check_hresult(gpu.device->CreateTexture2D(&desc,nullptr,readback.put()));
    gpu.context->CopyResource(readback.get(),detector.previous.get());D3D11_MAPPED_SUBRESOURCE map{};
    winrt::check_hresult(gpu.context->Map(readback.get(),0,D3D11_MAP_READ,0,&map));
    const auto pixel=*static_cast<uint32_t const*>(map.pData);gpu.context->Unmap(readback.get(),0);return pixel;
}
void CheckDeferredComparison(delo::GPU& gpu){
    // Only synthetic 16x16 crops: no HWND, WGC session, monitor or swapchain.
    gpu.Resize(16,16);delo::ChangeDetector detector(gpu);
    Require(!detector.Changed(gpu,true,false),"unpopulated first crop is not rendered");
    FillSource(gpu,0xff000000u);
    Require(detector.Changed(gpu,false,true),"first populated crop renders immediately");detector.Remember(gpu);
    Require(!detector.Changed(gpu,false,true)&&detector.pending,"unchanged crop queues one asynchronous comparison");
    const auto epoch=detector.queryVersion;auto query=detector.query;
    detector.pendingSince=GetTickCount64()-100;
    bool pendingSafe=true;pendingReads=0;
    for(int i=0;i<20;++i)pendingSafe&=!detector.Changed(gpu,false,false,PendingRead);
    Require(pendingSafe&&pendingReads==20,"pending GPU performs one readiness check per UI turn");
    Require(detector.pending&&detector.query.get()==query.get()&&detector.queryVersion==epoch,"pending comparison keeps its query and reference epoch");
    Require(ReferencePixel(gpu,detector)==0xff000000u,"pending comparison does not change displayed reference");
    // The first query compares A to A. B arrives after End, before CPU reads it.
    FillSource(gpu,0xff00ff00u);
    Require(!detector.Changed(gpu,false,true,PendingRead),"new crop does not wait for old query");
    Require(detector.sourceVersion>detector.queryVersion,"new crop is retained behind pending query");
    Require(AwaitComparison(detector,gpu),"old unchanged result rechecks final changed crop without another capture");
    detector.Remember(gpu);
    Require(ReferencePixel(gpu,detector)==0xff00ff00u,"reference becomes latest selected crop");
    Require(!detector.Changed(gpu,false,true),"identical capture is compared asynchronously");
    Require(!AwaitComparison(detector,gpu),"identical crop does not trigger redraw");
    detector.Changed(gpu,false,true);query=detector.query;
    detector.pendingSince=GetTickCount64()-11000;
    Require(detector.Changed(gpu,true,false),"forced theme or move redraw bypasses stale pending timeout");
    Require(!detector.pending&&detector.query.get()!=query.get(),"forced redraw abandons only the pending query");detector.Remember(gpu);
    detector.Changed(gpu,false,true);gpu.Resize(12,12);detector.Resize(gpu);
    Require(!detector.pending&&!detector.Changed(gpu,true,false),"resize cancels query and waits for new texture contents");
    FillSource(gpu,0xff0000ffu);
    Require(detector.Changed(gpu,true,true),"filled resize crop renders immediately");detector.Remember(gpu);
    Require(ReferencePixel(gpu,detector)==0xff0000ffu,"resized reference matches new crop");
    detector.Changed(gpu,false,true);bool removed{};
    try{detector.Changed(gpu,false,false,FailedRead);}catch(winrt::hresult_error const& e){removed=e.code()==DXGI_ERROR_DEVICE_REMOVED;}
    Require(removed,"failed query preserves device-removed HRESULT");
    detector.Changed(gpu,true,false);detector.Remember(gpu);detector.Changed(gpu,false,true);
    detector.pendingSince=GetTickCount64()-11000;bool timedOut{};
    try{detector.Changed(gpu,false,false,PendingRead);}catch(winrt::hresult_error const& e){timedOut=e.code()==HRESULT_FROM_WIN32(WAIT_TIMEOUT);}
    Require(timedOut,"stalled query has bounded timeout without a wait loop");
}
int wmain(int argc,wchar_t** argv){try{
    if(argc!=2)return 2;
    delo::GPU gpu(argv[1]);gpu.Resize(160,160);
    std::vector<uint32_t> pixels(160*160);
    // Linear ramp: Gaussian convolution preserves its slope away from boundaries.
    for(int y=0;y<160;++y)for(int x=0;x<160;++x){auto v=uint32_t(std::lround(x*255.0/159));pixels[y*160+x]=0xff000000u|v|(v<<8)|(v<<16);}
    gpu.context->UpdateSubresource(gpu.source.get(),0,nullptr,pixels.data(),160*4,0);
    D3D11_TEXTURE2D_DESC desc{};gpu.output->GetDesc(&desc);desc.BindFlags=0;desc.Usage=D3D11_USAGE_STAGING;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
    winrt::com_ptr<ID3D11Texture2D> readback;winrt::check_hresult(gpu.device->CreateTexture2D(&desc,nullptr,readback.put()));
    for(bool dark:{false,true}){
        gpu.Draw(dark);gpu.context->CopyResource(readback.get(),gpu.output.get());
        D3D11_MAPPED_SUBRESOURCE map{};winrt::check_hresult(gpu.context->Map(readback.get(),0,D3D11_MAP_READ,0,&map));
        auto pixel=[&](int x,int y){return reinterpret_cast<uint32_t*>(static_cast<unsigned char*>(map.pData)+y*map.RowPitch)[x];};
        Require((pixel(0,0)>>24)==0,"rounded corner is transparent");
        Require((pixel(80,80)>>24)==255,"material interior is opaque composite");
        const double tint=dark?24.0:244.0, mix=dark?.76:.72;
        auto red=[&](int x,int y){return int((pixel(x,y)>>16)&255);};
        Require(std::abs(red(80,80)-(80*255.0/159*(1-mix)+tint*mix))<2,"interior matches Gaussian ramp and theme tint");
        double distance=-4.5,band=1+distance/24,offset=14*band*band;
        double rim=std::exp(-std::abs(distance+.8)*.8);
        double highlight=(.6/std::sqrt(1.36))*rim*(dark?.12:.20)*255;
        double expected=(12+offset)*255.0/159*(1-mix)+tint*mix+highlight;
        Require(std::abs(red(12,80)-expected)<2,"optical edge refracts the blurred source inward");
        gpu.context->Unmap(readback.get(),0);
    }
    // A bright isolated line must become one smooth lobe, not displaced copies.
    std::fill(pixels.begin(),pixels.end(),0xff000000u);
    for(int y=0;y<160;++y)pixels[y*160+80]=0xffffffffu;
    gpu.context->UpdateSubresource(gpu.source.get(),0,nullptr,pixels.data(),160*4,0);gpu.Draw(false);
    gpu.context->CopyResource(readback.get(),gpu.output.get());D3D11_MAPPED_SUBRESOURCE map{};
    winrt::check_hresult(gpu.context->Map(readback.get(),0,D3D11_MAP_READ,0,&map));
    auto row=reinterpret_cast<uint32_t*>(static_cast<unsigned char*>(map.pData)+80*map.RowPitch);
    bool smooth=true;for(int x=65;x<80;++x)smooth &= ((row[x]>>16)&255)<=((row[x+1]>>16)&255);
    for(int x=80;x<95;++x)smooth &= ((row[x]>>16)&255)>=((row[x+1]>>16)&255);
    Require(smooth,"Gaussian impulse has no repeated outlines");gpu.context->Unmap(readback.get(),0);
    CheckDeferredComparison(gpu);
    return 0;
}catch(std::exception const& error){std::cerr<<error.what()<<'\n';return 1;}catch(winrt::hresult_error const& error){std::cerr<<winrt::to_string(error.message())<<'\n';return 1;}}
