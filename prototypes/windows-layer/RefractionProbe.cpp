#define DELO_PROBE_NO_MAIN
#include "NativeWindowProbe.cpp"
#include "RefractionEffect.h"
#include <winrt/Windows.Foundation.Collections.h>
#include <cmath>

// Shared window/pump/capture helpers above; the previous probe remains runnable.
bool gridShift{}, darkTheme{};
HWND inputWindow{};
std::string opticalStage;
winrt::com_ptr<ID2D1Factory> geometryFactory;

LRESULT CALLBACK RefractionProc(HWND window,UINT message,WPARAM w,LPARAM l) {
    if(message==WM_PAINT && window==patternWindow){
        PAINTSTRUCT paint{};HDC dc=BeginPaint(window,&paint);RECT rect{};GetClientRect(window,&rect);
        HBRUSH bg=CreateSolidBrush(darkTheme?RGB(35,47,62):RGB(205,227,239));FillRect(dc,&rect,bg);DeleteObject(bg);
        HPEN pen=CreatePen(PS_SOLID,3,darkTheme?RGB(153,192,210):RGB(35,75,105));auto old=SelectObject(dc,pen);
        int shift=gridShift?9:0;
        for(int x=shift;x<rect.right;x+=24){MoveToEx(dc,x,0,nullptr);LineTo(dc,x,rect.bottom);}
        for(int y=shift;y<rect.bottom;y+=24){MoveToEx(dc,0,y,nullptr);LineTo(dc,rect.right,y);}
        SelectObject(dc,old);DeleteObject(pen);EndPaint(window,&paint);return 0;
    }
    if(message==WM_LBUTTONDOWN && inputWindow)SetFocus(inputWindow);
    return WindowProc(window,message,w,l);
}

CompositionGeometricClip RoundedClip(Compositor const& compositor,float inset,float inner=-1) {
    auto rounded=[&](float n){
        winrt::com_ptr<ID2D1RoundedRectangleGeometry> shape;
        float radius=(std::max)(0.0f,36-n);
        check_hresult(geometryFactory->CreateRoundedRectangleGeometry({{n,n,320-n,240-n},radius,radius},shape.put()));
        return shape.as<ID2D1Geometry>();
    };
    auto outer=rounded(inset);winrt::com_ptr<ID2D1Geometry> result=outer;
    if(inner>=0){auto inside=rounded(inner);ID2D1Geometry* shapes[]{outer.get(),inside.get()};
        winrt::com_ptr<ID2D1GeometryGroup> group;
        check_hresult(geometryFactory->CreateGeometryGroup(D2D1_FILL_MODE_ALTERNATE,shapes,2,group.put()));result=group.as<ID2D1Geometry>();}
    auto path=compositor.CreatePathGeometry();path.Path(CompositionPath(make<GeometrySource>(result)));
    return compositor.CreateGeometricClip(path);
}

ContainerVisual Material(Compositor const& compositor,bool refract,bool tint=false,bool internalControl=false) {
    opticalStage="rounded_clip";
    auto root=compositor.CreateContainerVisual();root.Size({320,240});root.Clip(RoundedClip(compositor,0));
    // Test whether a public VisualSurface can retain a live backdrop before
    // applying the affine transform. Direct affine+BackdropBrush is rejected.
    auto sourceVisual=compositor.CreateSpriteVisual();sourceVisual.Size({320,240});
    auto passFactory=compositor.CreateEffectFactory(make<OpacityNode>());auto pass=passFactory.CreateBrush();
    pass.SetSourceParameter(L"backdrop",compositor.CreateBackdropBrush());sourceVisual.Brush(pass);
    if(internalControl){
        sourceVisual.Brush(compositor.CreateColorBrush({255,205,227,239}));
        for(int coordinate=8;coordinate<320;coordinate+=24){
            auto stripe=compositor.CreateSpriteVisual();stripe.Size({3,240});stripe.Offset({float(coordinate),0,0});
            stripe.Brush(compositor.CreateColorBrush({255,35,75,105}));sourceVisual.Children().InsertAtTop(stripe);
        }
        for(int coordinate=8;coordinate<240;coordinate+=24){
            auto stripe=compositor.CreateSpriteVisual();stripe.Size({320,3});stripe.Offset({0,float(coordinate),0});
            stripe.Brush(compositor.CreateColorBrush({255,35,75,105}));sourceVisual.Children().InsertAtTop(stripe);
        }
    }
    root.Children().InsertAtBottom(sourceVisual);
    auto surface=compositor.CreateVisualSurface();surface.SourceVisual(sourceVisual);surface.SourceSize({320,240});
    auto surfaceBrush=compositor.CreateSurfaceBrush(surface);
    // Disjoint 1px rings approximate a smooth lens field without sampling one
    // refracted layer through another. Only documented Composition effects used.
    const int rings=refract?24:0;
    for(int i=0;i<=rings;++i){
        auto visual=compositor.CreateSpriteVisual();visual.Size({320,240});
        float depth=float(i)/24;
        float scale=refract?1+0.12f*(1-depth)*(1-depth):1;
        opticalStage="transform_factory";
        auto effect=compositor.CreateEffectFactory(make<TransformNode>(scale)).CreateBrush();
        opticalStage="source_brush";
        effect.SetSourceParameter(L"backdrop",surfaceBrush);opticalStage="visual_brush";visual.Brush(effect);
        opticalStage="ring_clip";
        visual.Clip(RoundedClip(compositor,float(i),i<rings?float(i+1):-1));root.Children().InsertAtTop(visual);
    }
    if(tint){
        auto shade=compositor.CreateSpriteVisual();shade.Size({320,240});
        shade.Brush(compositor.CreateColorBrush(darkTheme?Windows::UI::Color{95,24,35,50}:Windows::UI::Color{70,244,248,252}));root.Children().InsertAtTop(shade);
        auto rim=compositor.CreateSpriteVisual();rim.Size({320,240});rim.Clip(RoundedClip(compositor,0,1));
        auto gradient=compositor.CreateLinearGradientBrush();gradient.StartPoint({0,0});gradient.EndPoint({1,1});
        gradient.ColorStops().Append(compositor.CreateColorGradientStop(0,{220,255,255,255}));
        gradient.ColorStops().Append(compositor.CreateColorGradientStop(0.5f,{45,255,255,255}));
        gradient.ColorStops().Append(compositor.CreateColorGradientStop(1,{130,255,255,255}));rim.Brush(gradient);root.Children().InsertAtTop(rim);
    }
    return root;
}

void RedrawGrid(bool shift){gridShift=shift;InvalidateRect(patternWindow,nullptr,FALSE);UpdateWindow(patternWindow);Pump(250);}

std::vector<COLORREF> ReadPixels(){
    POINT p{};ClientToScreen(glassWindow,&p);HDC dc=GetDC(nullptr),memory=CreateCompatibleDC(dc);
    BITMAPINFO info{};info.bmiHeader={sizeof(BITMAPINFOHEADER),320,-240,1,32,BI_RGB};
    void* bytes{};HBITMAP bitmap=CreateDIBSection(dc,&info,DIB_RGB_COLORS,&bytes,nullptr,0);auto old=SelectObject(memory,bitmap);
    check_bool(BitBlt(memory,0,0,320,240,dc,p.x,p.y,SRCCOPY));std::vector<COLORREF> pixels;pixels.reserve(320*240);
    auto data=static_cast<unsigned char*>(bytes);for(int i=0;i<320*240;++i)pixels.push_back(RGB(data[i*4+2],data[i*4+1],data[i*4]));
    SelectObject(memory,old);DeleteObject(bitmap);DeleteDC(memory);ReleaseDC(nullptr,dc);return pixels;
}

int DifferenceCount(std::vector<COLORREF> const& a,std::vector<COLORREF> const& b,bool edge){
    int count=0;
    for(int y=45;y<195;++y)for(int x=0;x<320;++x){
        bool region=edge?(x>=3&&x<22)||(x>=298&&x<317):(x>=60&&x<260);
        if(region&&Different(a[y*320+x],b[y*320+x]))++count;
    }
    return count;
}

DesktopWindowTarget Target(Compositor const& compositor){
    DesktopWindowTarget target{nullptr};
    check_hresult(compositor.as<ABI::Windows::UI::Composition::Desktop::ICompositorDesktopInterop>()->CreateDesktopWindowTarget(
        glassWindow,FALSE,reinterpret_cast<ABI::Windows::UI::Composition::Desktop::IDesktopWindowTarget**>(put_abi(target))));return target;
}

void ClosePair(DesktopWindowTarget& target){
    if(inputWindow){DestroyWindow(inputWindow);inputWindow=nullptr;}
    if(target){target.Root(nullptr);target.Close();target=nullptr;}
    if(glassWindow){DestroyWindow(glassWindow);glassWindow=nullptr;}
    if(patternWindow){DestroyWindow(patternWindow);patternWindow=nullptr;}
}

bool OpticalCase(Compositor const& compositor,std::filesystem::path const& output,bool desktop,bool dark){
    std::string name=std::string(desktop?"desktop":"topmost")+(dark?"_dark":"_light");
    DesktopWindowTarget target{nullptr};bool toggled=false;int before=failures;
    try{
        darkTheme=dark;patternWindow=CreateSurface(desktop,desktop,true);glassWindow=CreateSurface(desktop,false,false);
        target=Target(compositor);target.Root(Material(compositor,false));ShowPair(desktop);
        if(!desktop&&!dark){
            target.Root(Material(compositor,false,false,true));Pump(200);auto plain=ReadPixels();Capture(output/"internal_grid_plain.bmp");
            target.Root(Material(compositor,true,false,true));Pump(200);auto bent=ReadPixels();Capture(output/"internal_grid_lens.bmp");
            int displaced=DifferenceCount(plain,bent,true);
            Result("internal_grid_edge_displacement",displaced>300,"changed_edge_pixels="+std::to_string(displaced));
            target.Root(Material(compositor,false));Pump(100);
        }
        if(desktop){toggled=ToggleDesktop();Result(name+"_win_d",toggled);}
        RedrawGrid(false);auto reference=ReadPixels();Capture(output/(name+"_plain.bmp"));
        target.Root(Material(compositor,true));Pump(300);auto lens=ReadPixels();Capture(output/(name+"_lens.bmp"));
        int edge=DifferenceCount(reference,lens,true),center=DifferenceCount(reference,lens,false);
        Result(name+"_edge_displacement",edge>300,"changed_edge_pixels="+std::to_string(edge));
        Result(name+"_center_preserved",center<10,"changed_center_pixels="+std::to_string(center));
        RedrawGrid(true);auto changed=ReadPixels();
        Result(name+"_live_background",DifferenceCount(lens,changed,true)>300);
        target.Root(Material(compositor,true,true));Pump(250);Capture(output/(name+"_material.bmp"));
    }catch(hresult_error const& e){Result(name+"_exception",false,opticalStage+":"+std::to_string(e.code().value));}
    ClosePair(target);if(toggled)Result(name+"_win_d_restored",ToggleDesktop());
    return before==failures;
}

bool TypeIntoOwnEdit(std::wstring const& text){
    for(int key:{VK_SHIFT,VK_CONTROL,VK_MENU,VK_LWIN,VK_RWIN})if(GetAsyncKeyState(key)&0x8000)return false;
    POINT p{20,15};ClientToScreen(inputWindow,&p);POINT previous{};GetCursorPos(&previous);SetCursorPos(p.x,p.y);
    INPUT click[2]{};for(auto& i:click)i.type=INPUT_MOUSE;click[0].mi.dwFlags=MOUSEEVENTF_LEFTDOWN;click[1].mi.dwFlags=MOUSEEVENTF_LEFTUP;
    UINT clicked=SendInput(2,click,sizeof(INPUT));if(clicked!=2){SendInput(1,&click[1],sizeof(INPUT));SetCursorPos(previous.x,previous.y);return false;}
    Pump(80);SetCursorPos(previous.x,previous.y);
    if(GetFocus()!=inputWindow)return false;
    for(wchar_t character:text){INPUT keys[2]{};for(auto& key:keys){key.type=INPUT_KEYBOARD;key.ki.wScan=character;key.ki.dwFlags=KEYEVENTF_UNICODE;}
        keys[1].ki.dwFlags|=KEYEVENTF_KEYUP;if(SendInput(2,keys,sizeof(INPUT))!=2){SendInput(1,&keys[1],sizeof(INPUT));return false;}}
    Pump(100);wchar_t buffer[128]{};GetWindowTextW(inputWindow,buffer,128);return text==buffer;
}

void InteractionCase(Compositor const& compositor,std::filesystem::path const& output){
    DesktopWindowTarget target{nullptr};bool toggled=false;
    try{
        darkTheme=false;patternWindow=CreateSurface(true,true,true);glassWindow=CreateSurface(true,false,false);
        target=Target(compositor);target.Root(Material(compositor,true,true));ShowPair(true);RedrawGrid(false);
        // Preserve the same HWND, compositor target and material across all transitions.
        for(int round=0;round<2;++round)for(bool desktop:{false,true}){
            std::string name="round_"+std::to_string(round)+(desktop?"_desktop":"_topmost");
            RECT bounds{};GetWindowRect(glassWindow,&bounds);SetLastError(0);
            if(desktop){
                SetWindowPos(glassWindow,HWND_NOTOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
                SetWindowLongPtrW(glassWindow,GWL_STYLE,(GetWindowLongPtrW(glassWindow,GWL_STYLE)&~WS_POPUP)|WS_CHILD);
                SetLastError(0);SetParent(glassWindow,desktopHost);DWORD error=GetLastError();if(error)throw hresult_error(HRESULT_FROM_WIN32(error));
            }else{
                SetLastError(0);SetParent(glassWindow,nullptr);DWORD error=GetLastError();if(error)throw hresult_error(HRESULT_FROM_WIN32(error));
                SetWindowLongPtrW(glassWindow,GWL_STYLE,(GetWindowLongPtrW(glassWindow,GWL_STYLE)&~WS_CHILD)|WS_POPUP);
            }
            POINT position{bounds.left,bounds.top};if(desktop)ScreenToClient(desktopHost,&position);
            check_bool(SetWindowPos(glassWindow,desktop?HWND_TOP:HWND_TOPMOST,position.x,position.y,320,240,SWP_FRAMECHANGED|SWP_SHOWWINDOW|SWP_NOACTIVATE));Pump(150);
            Result(name+"_parent",desktop?GetParent(glassWindow)==desktopHost:GetAncestor(glassWindow,GA_ROOT)==glassWindow);
            Result(name+"_topmost_flag",bool(GetWindowLongPtrW(glassWindow,GWL_EXSTYLE)&WS_EX_TOPMOST)==!desktop);
            if(desktop){toggled=ToggleDesktop();Result(name+"_win_d",toggled);}
            // Keep a controlled pattern in the same layer for optical validation.
            if(!desktop){SetParent(patternWindow,nullptr);SetWindowLongPtrW(patternWindow,GWL_STYLE,WS_POPUP);
                SetWindowPos(patternWindow,HWND_TOPMOST,bounds.left-20,bounds.top-20,360,280,SWP_FRAMECHANGED|SWP_SHOWWINDOW|SWP_NOACTIVATE);
                SetWindowPos(glassWindow,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
            }else{SetWindowLongPtrW(patternWindow,GWL_STYLE,WS_CHILD);SetParent(patternWindow,desktopHost);
                POINT pp{bounds.left-20,bounds.top-20};ScreenToClient(desktopHost,&pp);
                SetWindowPos(patternWindow,glassWindow,pp.x,pp.y,360,280,SWP_FRAMECHANGED|SWP_SHOWWINDOW|SWP_NOACTIVATE);}
            RedrawGrid(false);auto a=ReadPixels();RedrawGrid(true);auto b=ReadPixels();Result(name+"_material_live",DifferenceCount(a,b,true)>300);
            inputWindow=CreateWindowExW(0,L"EDIT",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL,40,100,240,36,glassWindow,nullptr,GetModuleHandleW(nullptr),nullptr);
            if(!inputWindow)throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
            SendMessageW(inputWindow,WM_SETFONT,reinterpret_cast<WPARAM>(GetStockObject(DEFAULT_GUI_FONT)),TRUE);
            Result(name+"_click_and_keyboard",TypeIntoOwnEdit(L"Delo input"));Capture(output/(name+"_input.bmp"));
            DestroyWindow(inputWindow);inputWindow=nullptr;
            if(toggled){Result(name+"_win_d_restored",ToggleDesktop());toggled=false;}
        }
    }catch(hresult_error const& e){Result("interaction_exception",false,std::to_string(e.code().value));}
    ClosePair(target);if(toggled)Result("interaction_restore",ToggleDesktop());
}

int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int){
    wchar_t module[MAX_PATH]{};GetModuleFileNameW(nullptr,module,MAX_PATH);auto output=std::filesystem::path(module).parent_path();
    report.open(output/L"refraction.jsonl",std::ios::trunc);HWND previous=GetForegroundWindow();
    try{
        EnumWindows(FindHost,0);if(!desktopHost){Result("desktop_host",false);return 2;}
        SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(desktopHost));init_apartment(apartment_type::single_threaded);
        Windows::System::DispatcherQueueController queue{nullptr};DispatcherQueueOptions options{sizeof(options),DQTYPE_THREAD_CURRENT,DQTAT_COM_STA};
        check_hresult(CreateDispatcherQueueController(options,reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(put_abi(queue))));
        check_hresult(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED,geometryFactory.put()));
        WNDCLASSW wc{};wc.lpfnWndProc=RefractionProc;wc.hInstance=instance;wc.lpszClassName=L"Delo.NativeProbe";wc.hCursor=LoadCursor(nullptr,IDC_ARROW);check_bool(RegisterClassW(&wc));
        Compositor compositor;
        for(bool backdrop:{false,true}){
            std::string label=backdrop?"affine_backdrop_binding":"affine_color_binding";
            try{auto factory=compositor.CreateEffectFactory(make<TransformNode>(1.12f));auto brush=factory.CreateBrush();
                CompositionBrush source=backdrop?compositor.CreateBackdropBrush().as<CompositionBrush>():compositor.CreateColorBrush({255,255,0,0}).as<CompositionBrush>();
                brush.SetSourceParameter(L"backdrop",source);Result(label,true);
            }catch(hresult_error const& e){Result(label,false,std::to_string(e.code().value));}
        }
        bool optical=true;for(bool desktop:{false,true})for(bool dark:{false,true}) optical=OpticalCase(compositor,output,desktop,dark)&&optical;
        if(optical)InteractionCase(compositor,output);else Result("interaction_skipped_optics_failed",false);
        compositor.Close();auto shutdown=queue.ShutdownQueueAsync();while(shutdown.Status()==Windows::Foundation::AsyncStatus::Started)Pump(10);
    }catch(hresult_error const& e){Result("fatal",false,std::to_string(e.code().value));}
    if(IsWindow(previous))SetForegroundWindow(previous);report<<"{\"failed_checks\":"<<failures<<"}\n";return failures?1:0;
}
