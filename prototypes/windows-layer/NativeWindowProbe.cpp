// Diagnostic Win32 host. Only creates/changes its own windows; no Explorer hooks.
#include <windows.h>
#include <DispatcherQueue.h>
#include <windows.ui.composition.interop.h>
#include "BackdropEffect.cpp"
#include <dwmapi.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <fstream>
#include <filesystem>
#include <vector>
#include <string>

using namespace Windows::UI::Composition::Desktop;
HWND desktopHost{}, patternWindow{}, glassWindow{};
bool alternatePattern{};
std::ofstream report;
int failures{};

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM w, LPARAM l) {
    if (message == WM_ERASEBKGND) return 1;
    if (message == WM_PAINT) {
        PAINTSTRUCT paint{}; HDC dc = BeginPaint(window, &paint);
        if (window == patternWindow) {
            RECT area{}; GetClientRect(window, &area);
            HBRUSH brush = CreateSolidBrush(alternatePattern ? RGB(240,60,30) : RGB(20,170,230));
            FillRect(dc, &area, brush); DeleteObject(brush);
        }
        EndPaint(window, &paint); return 0;
    }
    return DefWindowProcW(window, message, w, l);
}

BOOL CALLBACK FindHost(HWND window, LPARAM) {
    if (FindWindowExW(window, nullptr, L"SHELLDLL_DefView", nullptr)) {
        desktopHost = window; return FALSE;
    }
    return TRUE;
}

void Pump(DWORD milliseconds) {
    auto until = GetTickCount64() + milliseconds;
    do {
        MSG message{};
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message); DispatchMessageW(&message);
        }
        Sleep(10);
    } while (GetTickCount64() < until);
    DwmFlush();
}

void Result(std::string const& name, bool passed, std::string const& detail = "") {
    report << "{\"check\":\"" << name << "\",\"passed\":" << (passed ? "true" : "false")
           << ",\"detail\":\"" << detail << "\"}\n"; report.flush();
    if (!passed) ++failures;
}

COLORREF Pixel(HWND window) {
    POINT point{150,100}; ClientToScreen(window, &point);
    HDC screen = GetDC(nullptr); COLORREF value = GetPixel(screen, point.x, point.y);
    ReleaseDC(nullptr, screen); return value;
}

void Pattern(bool alternate) {
    alternatePattern = alternate;
    InvalidateRect(patternWindow, nullptr, FALSE); UpdateWindow(patternWindow); Pump(300);
}

bool Different(COLORREF a, COLORREF b) {
    return a != CLR_INVALID && b != CLR_INVALID &&
        abs(int(GetRValue(a))-int(GetRValue(b))) + abs(int(GetGValue(a))-int(GetGValue(b))) +
        abs(int(GetBValue(a))-int(GetBValue(b))) > 60;
}

bool Gray(COLORREF color) {
    return color!=CLR_INVALID && abs(int(GetRValue(color))-int(GetGValue(color)))<=2 &&
        abs(int(GetGValue(color))-int(GetBValue(color)))<=2;
}

void Capture(std::filesystem::path const& path) {
    // Capture only our test surface, no full-desktop screenshots.
    RECT rect{}; GetWindowRect(glassWindow, &rect);
    int width = rect.right-rect.left, height = rect.bottom-rect.top;
    HDC screen = GetDC(nullptr), memory = CreateCompatibleDC(screen);
    BITMAPINFO info{}; info.bmiHeader = {sizeof(BITMAPINFOHEADER),width,-height,1,32,BI_RGB};
    void* pixels{}; HBITMAP bitmap = CreateDIBSection(screen,&info,DIB_RGB_COLORS,&pixels,nullptr,0);
    HGDIOBJ old = SelectObject(memory,bitmap);
    BitBlt(memory,0,0,width,height,screen,rect.left,rect.top,SRCCOPY);
    BITMAPFILEHEADER header{}; header.bfType=0x4d42; header.bfOffBits=sizeof(header)+sizeof(BITMAPINFOHEADER);
    header.bfSize=header.bfOffBits+width*height*4;
    std::ofstream output(path,std::ios::binary);
    output.write(reinterpret_cast<char*>(&header),sizeof(header));
    output.write(reinterpret_cast<char*>(&info.bmiHeader),sizeof(BITMAPINFOHEADER));
    output.write(static_cast<char*>(pixels),width*height*4);
    SelectObject(memory,old); DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(nullptr,screen);
}

HWND CreateSurface(bool desktop, bool layered, bool pattern) {
    DWORD ex = WS_EX_TOOLWINDOW | (pattern ? 0 : WS_EX_NOREDIRECTIONBITMAP);
    if (layered) ex |= WS_EX_LAYERED;
    POINT position{GetSystemMetrics(SM_CXSCREEN)-450,120};
    if (pattern) { position.x-=20; position.y-=20; }
    if (desktop) ScreenToClient(desktopHost,&position);
    HWND window=CreateWindowExW(ex,L"Delo.NativeProbe",pattern?L"Delo controlled background":L"Delo native composition probe",
        desktop?WS_CHILD:WS_POPUP,position.x,position.y,pattern?360:320,pattern?280:240,
        desktop?desktopHost:nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    if(!window) throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
    if(layered) check_bool(SetLayeredWindowAttributes(window,0,255,LWA_ALPHA));
    return window;
}

void ShowPair(bool desktop) {
    ShowWindow(patternWindow,SW_SHOWNOACTIVATE); UpdateWindow(patternWindow);
    SetWindowPos(patternWindow,desktop?HWND_TOP:HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
    ShowWindow(glassWindow,SW_SHOWNOACTIVATE);
    SetWindowPos(glassWindow,desktop?HWND_TOP:HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
    Pump(300);
}

bool ToggleDesktop() {
    for (int key : {VK_SHIFT,VK_CONTROL,VK_MENU,VK_LWIN,VK_RWIN})
        if(GetAsyncKeyState(key)&0x8000) return false;
    INPUT input[4]{}; for(auto& i:input)i.type=INPUT_KEYBOARD;
    input[0].ki.wVk=VK_LWIN; input[1].ki.wVk='D'; input[2].ki.wVk='D'; input[3].ki.wVk=VK_LWIN;
    input[2].ki.dwFlags=input[3].ki.dwFlags=KEYEVENTF_KEYUP;
    UINT sent=SendInput(4,input,sizeof(INPUT));
    if(sent!=4) {
        INPUT release[2]{input[2],input[3]}; SendInput(2,release,sizeof(INPUT)); return false;
    }
    Pump(500); return true;
}

void RunCase(Compositor const& compositor, std::filesystem::path const& output, bool desktop, bool layered) {
    std::string name=desktop?(layered?"desktop_layered":"desktop_no_redirection"):"top_level";
    DesktopWindowTarget target{nullptr}; SpriteVisual root{nullptr}; bool desktopToggled=false;
    try {
        patternWindow=CreateSurface(desktop,desktop,true);
        glassWindow=CreateSurface(desktop,layered,false);
        Result(name+"_parent",desktop?GetParent(glassWindow)==desktopHost:GetAncestor(glassWindow,GA_ROOT)==glassWindow);
        BOOL enabled=TRUE; MARGINS margins{-1,-1,-1,-1};
        HRESULT hostResult=DwmSetWindowAttribute(glassWindow,17,&enabled,sizeof(enabled));
        HRESULT frameResult=DwmExtendFrameIntoClientArea(glassWindow,&margins);
        Result(name+"_dwm_setup",SUCCEEDED(hostResult)&&SUCCEEDED(frameResult),
            "host="+std::to_string(hostResult)+",frame="+std::to_string(frameResult));
        auto interop=compositor.as<ABI::Windows::UI::Composition::Desktop::ICompositorDesktopInterop>();
        check_hresult(interop->CreateDesktopWindowTarget(glassWindow,TRUE,reinterpret_cast<ABI::Windows::UI::Composition::Desktop::IDesktopWindowTarget**>(put_abi(target))));
        root=compositor.CreateSpriteVisual(); root.Size({320,240}); target.Root(root);
        root.Brush(compositor.CreateColorBrush({255,255,0,0})); ShowPair(desktop);
        if(desktop) {
            desktopToggled=ToggleDesktop(); Result(name+"_win_d_sent",desktopToggled);
        }
        COLORREF red=Pixel(glassWindow); Result(name+"_composition_red",red==RGB(255,0,0),std::to_string(red));
        // A transparent brush must expose the controlled external pattern.
        root.Brush(compositor.CreateColorBrush({0,0,0,0}));
        Pattern(false); auto clearA=Pixel(glassWindow); Pattern(true); auto clearB=Pixel(glassWindow);
        Result(name+"_transparent_control",Different(clearA,clearB),std::to_string(clearA)+","+std::to_string(clearB));
        for(bool host : {true,false}) {
            auto source=host?compositor.CreateHostBackdropBrush():compositor.CreateBackdropBrush();
            auto factory=compositor.CreateEffectFactory(make<OpacityNode>());
            auto effect=factory.CreateBrush(); effect.SetSourceParameter(L"backdrop",source); root.Brush(effect);
            Pattern(false); COLORREF first=Pixel(glassWindow);
            Capture(output/(name+(host?"_host_a.bmp":"_ordinary_a.bmp")));
            Pattern(true); COLORREF second=Pixel(glassWindow);
            Capture(output/(name+(host?"_host_b.bmp":"_ordinary_b.bmp")));
            Result(name+(host?"_host_backdrop":"_ordinary_backdrop"),Different(first,second),std::to_string(first)+","+std::to_string(second));
        }
        // A transparent window alone cannot turn the colored external surface gray.
        auto grayFactory=compositor.CreateEffectFactory(make<OpacityNode>(true));
        auto grayEffect=grayFactory.CreateBrush();
        grayEffect.SetSourceParameter(L"backdrop",compositor.CreateBackdropBrush()); root.Brush(grayEffect);
        Pattern(false); auto grayA=Pixel(glassWindow);
        Capture(output/(name+"_processed_a.bmp"));
        Pattern(true); auto grayB=Pixel(glassWindow);
        Capture(output/(name+"_processed_b.bmp"));
        Result(name+"_processed_external_backdrop",Gray(grayA)&&Gray(grayB)&&Different(grayA,grayB)&&
            grayA!=clearA&&grayB!=clearB,std::to_string(grayA)+","+std::to_string(grayB));
    } catch(hresult_error const& e) { Result(name+"_exception",false,"HRESULT="+std::to_string(e.code().value)); }
    if(target){target.Root(nullptr);target.Close();} root=nullptr;target=nullptr;
    if(glassWindow)DestroyWindow(glassWindow); glassWindow=nullptr;
    if(patternWindow)DestroyWindow(patternWindow); patternWindow=nullptr;
    if(desktopToggled) Result(name+"_win_d_restored",ToggleDesktop());
    Pump(100);
}

#ifndef DELO_PROBE_NO_MAIN
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int) {
    wchar_t module[MAX_PATH]{}; GetModuleFileNameW(nullptr,module,MAX_PATH);
    auto output=std::filesystem::path(module).parent_path();
    report.open(output/L"native-window.jsonl",std::ios::trunc);
    HWND previousForeground=GetForegroundWindow();
    try {
        EnumWindows(FindHost,0); if(!desktopHost) {Result("desktop_host",false);return 2;}
        SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(desktopHost));
        init_apartment(apartment_type::single_threaded);
        Windows::System::DispatcherQueueController queue{nullptr};
        DispatcherQueueOptions options{sizeof(options),DQTYPE_THREAD_CURRENT,DQTAT_COM_STA};
        check_hresult(CreateDispatcherQueueController(options,reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(put_abi(queue))));
        WNDCLASSW wc{};wc.lpfnWndProc=WindowProc;wc.hInstance=instance;wc.lpszClassName=L"Delo.NativeProbe";wc.hCursor=LoadCursor(nullptr,IDC_ARROW);
        check_bool(RegisterClassW(&wc));
        Compositor compositor;
        RunCase(compositor,output,false,false);
        RunCase(compositor,output,true,false);
        RunCase(compositor,output,true,true);
        compositor.Close();
        auto shutdown=queue.ShutdownQueueAsync();
        while(shutdown.Status()==Windows::Foundation::AsyncStatus::Started)Pump(10);
    } catch(hresult_error const& e) {Result("fatal",false,"HRESULT="+std::to_string(e.code().value));}
    if(IsWindow(previousForeground))SetForegroundWindow(previousForeground);
    report << "{\"failed_checks\":" << failures << "}\n";
    return failures?1:0;
}
#endif
