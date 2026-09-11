#pragma once
// Original descriptors for the public D2D affine effect and geometry interop.
#include <d2d1.h>
#include <windows.graphics.interop.h>
#include <winrt/Windows.Graphics.h>

struct TransformNode : winrt::implements<TransformNode, IGraphicsEffect, IGraphicsEffectSource, Interop> {
    float scale; hstring name{L"Lens"};
    CompositionEffectSourceParameter source{L"backdrop"};
    explicit TransformNode(float value):scale(value){}
    hstring Name(){return name;} void Name(hstring const& value){name=value;}
    HRESULT __stdcall GetEffectId(GUID* id) noexcept override {
        if(!id)return E_POINTER;
        *id={0x6aa97485,0x6354,0x4cfc,{0x90,0x8c,0xe4,0xa7,0x4f,0x62,0xc9,0x6c}};return S_OK;
    }
    HRESULT __stdcall GetNamedPropertyMapping(LPCWSTR name,UINT* index,ABI::Windows::Graphics::Effects::GRAPHICS_EFFECT_PROPERTY_MAPPING* mapping) noexcept override {
        if(!name||!index||!mapping)return E_POINTER;
        const wchar_t* names[]{L"InterpolationMode",L"BorderMode",L"TransformMatrix",L"Sharpness"};
        for(UINT i=0;i<4;++i)if(wcscmp(name,names[i])==0){*index=i;*mapping=ABI::Windows::Graphics::Effects::GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT;return S_OK;}
        return E_INVALIDARG;
    }
    HRESULT __stdcall GetPropertyCount(UINT* count) noexcept override {if(!count)return E_POINTER;*count=4;return S_OK;}
    HRESULT __stdcall GetProperty(UINT index,ABI::Windows::Foundation::IPropertyValue** value) noexcept override {
        if(!value)return E_POINTER;*value=nullptr;
        try {
            Windows::Foundation::IInspectable property{nullptr};
            if(index==0)property=Windows::Foundation::PropertyValue::CreateUInt32(1); // linear
            else if(index==1)property=Windows::Foundation::PropertyValue::CreateUInt32(0); // soft border
            else if(index==2){float matrix[]{scale,0,0,scale,160*(1-scale),120*(1-scale)};
                property=Windows::Foundation::PropertyValue::CreateSingleArray(matrix);}
            else if(index==3)property=Windows::Foundation::PropertyValue::CreateSingle(0);
            else return E_INVALIDARG;
            return winrt::get_unknown(property)->QueryInterface(IID_PPV_ARGS(value));
        }catch(...){return to_hresult();}
    }
    HRESULT __stdcall GetSourceCount(UINT* count) noexcept override {if(!count)return E_POINTER;*count=1;return S_OK;}
    HRESULT __stdcall GetSource(UINT index,ABI::Windows::Graphics::Effects::IGraphicsEffectSource** value) noexcept override {
        if(!value)return E_POINTER;*value=nullptr;if(index)return E_INVALIDARG;
        return winrt::get_unknown(source)->QueryInterface(IID_PPV_ARGS(value));
    }
};

struct GeometrySource : winrt::implements<GeometrySource, Windows::Graphics::IGeometrySource2D, ABI::Windows::Graphics::IGeometrySource2DInterop> {
    winrt::com_ptr<ID2D1Geometry> geometry;
    explicit GeometrySource(winrt::com_ptr<ID2D1Geometry> value):geometry(std::move(value)){}
    HRESULT __stdcall GetGeometry(ID2D1Geometry** value) noexcept override {if(!value)return E_POINTER;geometry.copy_to(value);return S_OK;}
    HRESULT __stdcall TryGetGeometryUsingFactory(ID2D1Factory*,ID2D1Geometry** value) noexcept override {return GetGeometry(value);}
};
