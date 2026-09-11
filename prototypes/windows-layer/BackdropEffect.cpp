// Original adapter for documented D2D opacity / saturation controls. No hooks.
#include <windows.h>
#include <windows.graphics.effects.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Effects.h>
#include <winrt/Windows.UI.Composition.h>

using namespace winrt;
using namespace Windows::Graphics::Effects;
using namespace Windows::UI::Composition;
using Interop = ABI::Windows::Graphics::Effects::IGraphicsEffectD2D1Interop;

struct OpacityNode : implements<OpacityNode, IGraphicsEffect, IGraphicsEffectSource, Interop>
{
    bool grayscale{};
    explicit OpacityNode(bool desaturate=false) : grayscale(desaturate) {}
    hstring name{L"PassThrough"};
    CompositionEffectSourceParameter source{L"backdrop"};
    hstring Name(){return name;}
    void Name(hstring const& value){name=value;}
    HRESULT __stdcall GetEffectId(GUID* id) noexcept override {
        if(!id)return E_POINTER;
        *id=grayscale ? GUID{0x5cb2d9cf,0x327d,0x459f,{0xa0,0xce,0x40,0xc0,0xb2,0x08,0x6b,0xf7}} :
            GUID{0x811d79a4,0xde28,0x4454,{0x80,0x94,0xc6,0x46,0x85,0xf8,0xbd,0x4c}};return S_OK;
    }
    HRESULT __stdcall GetNamedPropertyMapping(LPCWSTR value,UINT* index,ABI::Windows::Graphics::Effects::GRAPHICS_EFFECT_PROPERTY_MAPPING* mapping) noexcept override {
        if(!index||!mapping)return E_POINTER;
        *index=0;*mapping=ABI::Windows::Graphics::Effects::GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT;
        return value && wcscmp(value,grayscale?L"Saturation":L"Opacity")==0 ? S_OK:E_INVALIDARG;
    }
    HRESULT __stdcall GetPropertyCount(UINT* count) noexcept override {if(!count)return E_POINTER;*count=1;return S_OK;}
    HRESULT __stdcall GetProperty(UINT index,ABI::Windows::Foundation::IPropertyValue** value) noexcept override {
        if(!value)return E_POINTER;*value=nullptr;if(index!=0)return E_INVALIDARG;
        try { auto property=Windows::Foundation::PropertyValue::CreateSingle(grayscale?0.0f:1.0f);return winrt::get_unknown(property)->QueryInterface(IID_PPV_ARGS(value)); }
        catch(...){return to_hresult();}
    }
    HRESULT __stdcall GetSource(UINT index,ABI::Windows::Graphics::Effects::IGraphicsEffectSource** value) noexcept override {
        if(!value)return E_POINTER;*value=nullptr;if(index!=0)return E_INVALIDARG;
        return winrt::get_unknown(source)->QueryInterface(IID_PPV_ARGS(value));
    }
    HRESULT __stdcall GetSourceCount(UINT* count) noexcept override {if(!count)return E_POINTER;*count=1;return S_OK;}
};
extern "C" __declspec(dllexport) HRESULT __stdcall CreateOpacityEffect(IInspectable** result) noexcept {
    if(!result)return E_POINTER;*result=nullptr;
    try{auto effect=make<OpacityNode>();*result=static_cast<IInspectable*>(detach_abi(effect));return S_OK;}catch(...){return to_hresult();}
}
