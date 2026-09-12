#pragma once
#include <windows.h>
#include <tlhelp32.h>
#include <UIAutomation.h>
#include <wrl/client.h>
#pragma comment(lib,"OleAut32.lib")
#include <atomic>
#include <array>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <thread>

namespace delo {
// Read-only compatibility with Lightshot. UI Automation runs on its own MTA worker,
// never on a keyboard/mouse hook or on the renderer's UI thread.
class LightshotTray {
public:
    static constexpr LPARAM QueryPoint=1,PointMatches=2,PointDoesNotMatch=3;
    LightshotTray(HWND host,UINT message):host_(host),message_(message),thread_([this]{Run();}){}
    ~LightshotTray(){
        {std::lock_guard<std::mutex> lock(mutex_);stopping_=true;}
        wake_.notify_one();thread_.join();
    }
    LightshotTray(LightshotTray const&)=delete;
    LightshotTray& operator=(LightshotTray const&)=delete;
    DWORD Hotkey()const{return running_.load()?configured_.load():0;}
    DWORD ConfiguredHotkey()const{return configured_.load();}
    bool Running()const{return running_.load();}
    bool AutomationReady()const{return automationReady_.load();}
    DWORD LastQueryMs()const{return lastQueryMs_.load();}
    bool LastQueryMatched()const{return lastQueryMatched_.load();}
    void Query(std::uint64_t request,POINT point,ULONGLONG deadline){
        {std::lock_guard<std::mutex> lock(mutex_);request_=request;point_=point;deadline_=deadline;}
        wake_.notify_one();
    }
    static bool IsTrayPoint(POINT point){
        const auto hit=WindowFromPoint(point),root=GetAncestor(hit,GA_ROOT);
        if(!root||!IsWindowVisible(root))return false;
        wchar_t name[96]{};GetClassNameW(root,name,96);
        if(wcscmp(name,L"Shell_TrayWnd")==0||wcscmp(name,L"Shell_SecondaryTrayWnd")==0){
            // The taskbar root also contains Start and application buttons. Only
            // its notification area can contain Lightshot; leave other clicks alone.
            const auto notify=FindWindowExW(root,nullptr,L"TrayNotifyWnd",nullptr);
            RECT bounds{};return notify&&GetWindowRect(notify,&bounds)&&PtInRect(&bounds,point);
        }
        return wcscmp(name,L"TopLevelWindowForOverflowXamlIsland")==0||wcscmp(name,L"NotifyIconOverflowWindow")==0;
    }
private:
    HWND host_{};UINT message_{};std::mutex mutex_;std::condition_variable wake_;
    bool stopping_{};std::uint64_t request_{};POINT point_{};ULONGLONG deadline_{};
    std::atomic<DWORD> configured_{};std::atomic<bool> running_{},automationReady_{};
    std::atomic<DWORD> lastQueryMs_{};std::atomic<bool> lastQueryMatched_{};
    std::thread thread_;
    static DWORD ReadHotkey(){
        HKEY key{};
        if(RegOpenKeyExW(HKEY_CURRENT_USER,L"Software\\Skillbrains\\Lightshot",0,KEY_QUERY_VALUE,&key)!=ERROR_SUCCESS)return 0;
        auto read=[&](wchar_t const* name,DWORD& value){DWORD size=sizeof(value);return RegGetValueW(key,nullptr,name,RRF_RT_REG_DWORD,nullptr,&value,&size)==ERROR_SUCCESS;};
        DWORD enabled{},keyCode{},modifiers{};
        const bool valid=read(L"Hotkey_main_enabled",enabled)&&read(L"Hotkey_main_vk",keyCode)&&read(L"Hotkey_main_mod",modifiers);
        RegCloseKey(key);
        return valid&&enabled&&keyCode>0&&keyCode<255&&!(modifiers&~15u)?keyCode|(modifiers<<8):0;
    }
    static HANDLE FindLightshot(){
        const auto snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);if(snapshot==INVALID_HANDLE_VALUE)return nullptr;
        PROCESSENTRY32W process{sizeof(process)};HANDLE found{};DWORD ownSession{};
        ProcessIdToSessionId(GetCurrentProcessId(),&ownSession);
        if(Process32FirstW(snapshot,&process))do{
            if(_wcsicmp(process.szExeFile,L"Lightshot.exe")!=0)continue;
            DWORD session{};if(!ProcessIdToSessionId(process.th32ProcessID,&session)||session!=ownSession)continue;
            found=OpenProcess(SYNCHRONIZE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,process.th32ProcessID);
            if(found&&SameUser(found))break;
            if(found){CloseHandle(found);found=nullptr;}
        }while(Process32NextW(snapshot,&process));
        CloseHandle(snapshot);return found;
    }
    static bool SameUser(HANDLE process){
        HANDLE own{},other{};
        if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&own))return false;
        if(!OpenProcessToken(process,TOKEN_QUERY,&other)){CloseHandle(own);return false;}
        alignas(TOKEN_USER) std::array<BYTE,sizeof(TOKEN_USER)+SECURITY_MAX_SID_SIZE> ownUser{},otherUser{};
        DWORD size{};
        const bool same=GetTokenInformation(own,TokenUser,ownUser.data(),DWORD(ownUser.size()),&size)&&
            GetTokenInformation(other,TokenUser,otherUser.data(),DWORD(otherUser.size()),&size)&&
            EqualSid(reinterpret_cast<TOKEN_USER*>(ownUser.data())->User.Sid,reinterpret_cast<TOKEN_USER*>(otherUser.data())->User.Sid);
        CloseHandle(other);CloseHandle(own);return same;
    }
    bool Matches(IUIAutomation2* automation,IUIAutomationCacheRequest* cache,POINT point,ULONGLONG deadline){
        if(!automation||!cache||GetTickCount64()>=deadline||!IsTrayPoint(point))return false;
        // Windows 11 can return only the overflow root from ElementFromPoint even
        // while its descendants expose the correct icon rectangles. Search that
        // small shell subtree with cached properties instead of relying on hit-test.
        const auto root=GetAncestor(WindowFromPoint(point),GA_ROOT);
        Microsoft::WRL::ComPtr<IUIAutomationElement> container;
        Microsoft::WRL::ComPtr<IUIAutomationCondition> condition;
        Microsoft::WRL::ComPtr<IUIAutomationElementArray> elements;
        if(FAILED(automation->ElementFromHandleBuildCache(root,cache,container.GetAddressOf()))||GetTickCount64()>=deadline||
           FAILED(automation->CreateTrueCondition(condition.GetAddressOf()))||
           FAILED(container->FindAllBuildCache(TreeScope_Descendants,condition.Get(),cache,elements.GetAddressOf())))return false;
        int count{};if(FAILED(elements->get_Length(&count)))return false;
        for(int index=0;index<count&&GetTickCount64()<deadline;++index){
            Microsoft::WRL::ComPtr<IUIAutomationElement> element;
            if(FAILED(elements->GetElement(index,element.GetAddressOf())))continue;
            BSTR name{};RECT bounds{};BOOL offscreen=TRUE;
            const auto named=element->get_CachedName(&name);
            const auto located=element->get_CachedBoundingRectangle(&bounds);
            const auto visible=element->get_CachedIsOffscreen(&offscreen);
            const bool match=SUCCEEDED(named)&&name&&_wcsnicmp(name,L"Lightshot",9)==0&&
                (name[9]==L'\0'||name[9]==L' ')&&SUCCEEDED(located)&&SUCCEEDED(visible)&&!offscreen&&PtInRect(&bounds,point);
            if(name)SysFreeString(name);
            if(match)return true;
        }
        return false;
    }
    void Run(){
        const auto apartment=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
        HANDLE process{};
        {
            Microsoft::WRL::ComPtr<IUIAutomation2> automation;
            Microsoft::WRL::ComPtr<IUIAutomationCacheRequest> cache;
            if(SUCCEEDED(apartment)&&SUCCEEDED(CoCreateInstance(__uuidof(CUIAutomation8),nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(automation.GetAddressOf())))){
                const bool ready=SUCCEEDED(automation->put_ConnectionTimeout(50))&&SUCCEEDED(automation->put_TransactionTimeout(50))&&
                    SUCCEEDED(automation->CreateCacheRequest(cache.GetAddressOf()))&&
                    SUCCEEDED(cache->AddProperty(UIA_NamePropertyId))&&SUCCEEDED(cache->AddProperty(UIA_BoundingRectanglePropertyId))&&SUCCEEDED(cache->AddProperty(UIA_IsOffscreenPropertyId));
                automationReady_.store(ready);if(!ready){cache.Reset();automation.Reset();}
            }
            auto refresh=GetTickCount64();
            for(;;){
                if(GetTickCount64()>=refresh){
                    configured_.store(ReadHotkey());
                    if(process&&WaitForSingleObject(process,0)!=WAIT_TIMEOUT){CloseHandle(process);process=nullptr;}
                    if(!process)process=FindLightshot();running_.store(process!=nullptr);refresh=GetTickCount64()+500;
                }
                std::uint64_t request{};POINT point{};ULONGLONG deadline{};
                {
                    std::unique_lock<std::mutex> lock(mutex_);
                    const auto now=GetTickCount64();
                    wake_.wait_for(lock,std::chrono::milliseconds(refresh>now?refresh-now:0),[&]{return stopping_||request_!=0;});
                    if(stopping_)break;
                    request=request_;point=point_;deadline=deadline_;request_=0;
                }
                if(!request)continue;
                const auto queryStart=GetTickCount64();
                const bool matches=running_.load()&&Matches(automation.Get(),cache.Get(),point,deadline);
                lastQueryMs_.store(DWORD(GetTickCount64()-queryStart));lastQueryMatched_.store(matches);
                if(GetTickCount64()<deadline)PostMessageW(host_,message_,WPARAM(request),matches?PointMatches:PointDoesNotMatch);
            }
        }
        if(process)CloseHandle(process);if(SUCCEEDED(apartment))CoUninitialize();
    }
};
} // namespace delo
