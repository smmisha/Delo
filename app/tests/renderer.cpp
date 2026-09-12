// Offscreen verification of the production GPU implementation, with synthetic data.
#include "../native/GlassRenderer.cpp"
#include <iostream>
#include <cmath>

void Require(bool ok,char const* name){if(!ok)throw std::runtime_error(name);std::cout<<"PASS "<<name<<'\n';}
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
    return 0;
}catch(std::exception const& error){std::cerr<<error.what()<<'\n';return 1;}catch(winrt::hresult_error const& error){std::cerr<<winrt::to_string(error.message())<<'\n';return 1;}}
