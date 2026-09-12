#pragma once
#include <windows.h>
#include <array>
#include <atomic>
#include <cstdint>
#include <stdexcept>
#include <thread>
#include "LightshotTray.h"

namespace delo {
// Only modifier/trigger state is retained. No typed text is recorded or translated.
struct ScreenshotChord {
    std::array<bool,256> down{};
    DWORD extraHotkey{};
    bool Update(DWORD key,bool pressed,DWORD configured=0) {
        if(configured!=extraHotkey){down[extraHotkey&255]=false;extraHotkey=configured;}
        if(key!=DWORD(extraHotkey&255)&&key!='S'&&key!=VK_SNAPSHOT&&key!=VK_LWIN&&key!=VK_RWIN&&
           key!=VK_SHIFT&&key!=VK_LSHIFT&&key!=VK_RSHIFT&&
           key!=VK_CONTROL&&key!=VK_LCONTROL&&key!=VK_RCONTROL&&
           key!=VK_MENU&&key!=VK_LMENU&&key!=VK_RMENU)return false;
        const bool repeated=down[key];down[key]=pressed;
        if(!pressed||repeated)return false;
        if(key==VK_SNAPSHOT)return true;
        const bool win=down[VK_LWIN]||down[VK_RWIN];
        const bool shift=down[VK_SHIFT]||down[VK_LSHIFT]||down[VK_RSHIFT];
        const bool ctrl=down[VK_CONTROL]||down[VK_LCONTROL]||down[VK_RCONTROL];
        const bool alt=down[VK_MENU]||down[VK_LMENU]||down[VK_RMENU];
        const UINT modifiers=(alt?MOD_ALT:0)|(ctrl?MOD_CONTROL:0)|(shift?MOD_SHIFT:0)|(win?MOD_WIN:0);
        if(extraHotkey&&key==(extraHotkey&255)&&modifiers==(extraHotkey>>8))return true;
        return key=='S'&&win&&shift&&!ctrl&&!alt;
    }
};

class ScreenshotKeys {
public:
    static constexpr UINT PrepareMessage=WM_APP+44;
    static constexpr DWORD PrepareTimeoutMs=100;
    // Cold shell UIA enumeration measured 140 ms on Windows 11. Mouse preparation
    // needs that lookup plus capture shutdown; keyboard shortcuts need no UIA.
    static constexpr DWORD MousePrepareTimeoutMs=250;
    struct Counters {std::uint64_t requested{},prepared{},timeouts{},postFailures{},trayRequested{},trayPrepared{},skipped{};DWORD lastWaitMs{},installError{},mouseInstallError{};bool installed{},mouseInstalled{};DWORD lastPrepareStartMs{},lastPrepareWorkMs{};std::uint64_t latePrepared{};};
    explicit ScreenshotKeys(HWND host,LightshotTray* tray=nullptr):host_(host),tray_(tray) {
        started_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
        acknowledged_=CreateEventW(nullptr,FALSE,FALSE,nullptr);
        if(!started_||!acknowledged_){CloseEvents();throw std::runtime_error("Cannot create screenshot shortcut events");}
        try{thread_=std::thread([this]{Run();});}
        catch(...){CloseEvents();throw;}
        // Installation itself uses only user32; no GPU or WebView calls run here.
        WaitForSingleObject(started_,INFINITE);
    }
    ~ScreenshotKeys(){
        if(thread_.joinable()){PostThreadMessageW(threadId_,WM_QUIT,0,0);thread_.join();}
        CloseEvents();
    }
    ScreenshotKeys(ScreenshotKeys const&)=delete;
    ScreenshotKeys& operator=(ScreenshotKeys const&)=delete;
    bool Pending(std::uint64_t request)const {
        return request&&pending_.load()==request&&GetTickCount64()<deadline_.load();
    }
    // Called only by the host thread, after both capture sessions have stopped and
    // WDA_NONE plus DwmFlush succeeded. A late request must not acknowledge a new one.
    void Complete(std::uint64_t request,bool prepared=true) {
        if(!Pending(request))return;
        preparedOutcome_.store(prepared);completed_.store(request);SetEvent(acknowledged_);
    }
    POINT MousePoint()const{return {pointX_.load(),pointY_.load()};}
    ULONGLONG Deadline()const{return deadline_.load();}
    void RecordPrepareStarted(){lastPrepareStartMs_.store(DWORD(GetTickCount64()-requestStart_.load()));}
    void RecordPrepareFinished(std::uint64_t request,ULONGLONG start){
        lastPrepareWorkMs_.store(DWORD(GetTickCount64()-start));if(!Pending(request))++latePrepared_;
    }
    Counters GetCounters()const {
        return {requested_.load(),prepared_.load(),timeouts_.load(),postFailures_.load(),trayRequested_.load(),trayPrepared_.load(),skipped_.load(),lastWaitMs_.load(),installError_.load(),mouseInstallError_.load(),installed_.load(),mouseInstalled_.load(),lastPrepareStartMs_.load(),lastPrepareWorkMs_.load(),latePrepared_.load()};
    }
private:
    HWND host_{};LightshotTray* tray_{};HANDLE started_{},acknowledged_{};DWORD threadId_{};
    std::thread thread_;ScreenshotChord chord_;
    std::atomic<std::uint64_t> requested_{},prepared_{},timeouts_{},postFailures_{},pending_{},completed_{},deadline_{};
    std::atomic<ULONGLONG> requestStart_{};
    std::atomic<std::uint64_t> trayRequested_{},trayPrepared_{},skipped_{};
    std::atomic<std::uint64_t> latePrepared_{};std::atomic<DWORD> lastPrepareStartMs_{},lastPrepareWorkMs_{};
    std::atomic<LONG> pointX_{},pointY_{};
    std::atomic<DWORD> lastWaitMs_{},installError_{},mouseInstallError_{};std::atomic<bool> installed_{},mouseInstalled_{},preparedOutcome_{};
    inline static thread_local ScreenshotKeys* current_{};
    void CloseEvents(){if(started_)CloseHandle(started_);if(acknowledged_)CloseHandle(acknowledged_);started_=acknowledged_=nullptr;}
    void Prepare(bool mouse=false,POINT point={}) {
        const auto start=GetTickCount64(),request=requested_.fetch_add(1)+1;
        const auto timeout=mouse?MousePrepareTimeoutMs:PrepareTimeoutMs;
        if(mouse)++trayRequested_;
        pointX_.store(point.x);pointY_.store(point.y);preparedOutcome_.store(false);
        requestStart_.store(start);deadline_.store(start+timeout);completed_.store(0);ResetEvent(acknowledged_);pending_.store(request);
        if(!PostMessageW(host_,PrepareMessage,WPARAM(request),mouse?LightshotTray::QueryPoint:0)){
            ++postFailures_;pending_.store(0);return;
        }
        // Unlike an unbounded synchronous GPU call in the hook, this always releases
        // the original input after its bounded wait, including on a stuck host.
        while(completed_.load()!=request){
            const auto now=GetTickCount64();if(now>=start+timeout)break;
            if(WaitForSingleObject(acknowledged_,DWORD(start+timeout-now))!=WAIT_OBJECT_0)break;
        }
        if(completed_.load()==request){if(preparedOutcome_.load()){++prepared_;if(mouse)++trayPrepared_;}else ++skipped_;}
        else{++timeouts_;PostMessageW(host_,PrepareMessage,0,0);}
        pending_.store(0);lastWaitMs_.store(DWORD(GetTickCount64()-start));
    }
    static LRESULT CALLBACK Hook(int code,WPARAM kind,LPARAM value) {
        if(code==HC_ACTION&&current_){
            const auto& key=*reinterpret_cast<KBDLLHOOKSTRUCT const*>(value);
            const bool pressed=kind==WM_KEYDOWN||kind==WM_SYSKEYDOWN;
            if(current_->chord_.Update(key.vkCode,pressed,current_->tray_?current_->tray_->Hotkey():0))current_->Prepare();
        }
        // Never swallow, synthesize, or change an input event (including injected
        // events from accessibility tools). The OS keeps its normal screenshot action.
        return CallNextHookEx(nullptr,code,kind,value);
    }
    static LRESULT CALLBACK MouseHook(int code,WPARAM kind,LPARAM value){
        if(code==HC_ACTION&&kind==WM_LBUTTONDOWN&&current_&&current_->tray_&&current_->tray_->Running()){
            const auto point=reinterpret_cast<MSLLHOOKSTRUCT const*>(value)->pt;
            if(LightshotTray::IsTrayPoint(point))current_->Prepare(true,point);
        }
        return CallNextHookEx(nullptr,code,kind,value);
    }
    void Run() {
        current_=this;threadId_=GetCurrentThreadId();MSG message{};
        PeekMessageW(&message,nullptr,WM_USER,WM_USER,PM_NOREMOVE);
        // This is outside the callback: the current event's asynchronous key state is
        // not updated yet inside LowLevelKeyboardProc.
        RefreshModifiers();
        auto hook=SetWindowsHookExW(WH_KEYBOARD_LL,Hook,GetModuleHandleW(nullptr),0);
        if(!hook)installError_.store(GetLastError());
        auto mouseHook=tray_?SetWindowsHookExW(WH_MOUSE_LL,MouseHook,GetModuleHandleW(nullptr),0):nullptr;
        if(tray_&&!mouseHook)mouseInstallError_.store(GetLastError());mouseInstalled_.store(mouseHook!=nullptr);
        installed_.store(hook!=nullptr);SetEvent(started_);
        if(hook||mouseHook){
            const auto refresh=SetTimer(nullptr,0,500,nullptr);
            while(GetMessageW(&message,nullptr,0,0)>0){
                if(message.message==WM_TIMER&&message.wParam==refresh)RefreshModifiers();
                else{TranslateMessage(&message);DispatchMessageW(&message);}
            }
            if(refresh)KillTimer(nullptr,refresh);if(hook)UnhookWindowsHookEx(hook);if(mouseHook)UnhookWindowsHookEx(mouseHook);
        }
        installed_.store(false);mouseInstalled_.store(false);current_=nullptr;
    }
    void RefreshModifiers(){
        // Recover missed releases across a desktop/session switch. Generic modifier
        // slots must not stay latched when Windows sends a left/right key-up instead.
        chord_.down[VK_SHIFT]=chord_.down[VK_CONTROL]=chord_.down[VK_MENU]=false;
        for(int key:{VK_LWIN,VK_RWIN,VK_LSHIFT,VK_RSHIFT,VK_LCONTROL,VK_RCONTROL,VK_LMENU,VK_RMENU})
            chord_.down[key]=(GetAsyncKeyState(key)&0x8000)!=0;
    }
};
} // namespace delo
