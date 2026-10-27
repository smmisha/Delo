// Exercise the real FinishDownload path with this executable as a controlled installer.
#include "../native/Host.cpp"
#include <iostream>

int wmain(int argc,wchar_t** argv){
    if(argc>1&&std::wstring_view(argv[1])==L"/VERYSILENT"){
        wchar_t name[128]{};
        if(!GetEnvironmentVariableW(L"DELO_UPDATER_WAIT_EVENT",name,128))return 2;
        winrt::handle release{OpenEventW(SYNCHRONIZE,FALSE,name)};
        return release&&WaitForSingleObject(release.get(),10000)==WAIT_OBJECT_0?37:3;
    }
    try{
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        auto name=L"Local\\DeloUpdaterWait-"+std::to_wstring(GetCurrentProcessId());
        winrt::handle release{CreateEventW(nullptr,TRUE,FALSE,name.c_str())};
        winrt::handle probe{CreateEventW(nullptr,TRUE,FALSE,nullptr)};
        if(!release||!probe)throw std::runtime_error("Could not create test events");
        if(!SetEnvironmentVariableW(L"DELO_UPDATER_WAIT_EVENT",name.c_str()))throw std::runtime_error("Could not set child event");
        control=CreateWindowExW(0,L"STATIC",L"Updater wait test",0,0,0,0,0,HWND_MESSAGE,nullptr,nullptr,nullptr);
        if(!control)throw std::runtime_error("Could not create message target");
        wchar_t executable[32768]{};GetModuleFileNameW(nullptr,executable,32768);
        netWorker=std::make_unique<delo::Worker>();
        auto job=new DownloadJob{};job->ok=true;job->cancel=updateCancel;job->file=executable;job->asset.version=L"v0.3.8";
        FinishDownload(job);
        const bool installing=updatePhase==L"installing";
        netWorker->Post([event=probe.get()]{SetEvent(event);});
        const bool responsive=WaitForSingleObject(probe.get(),1000)==WAIT_OBJECT_0;
        SetEvent(release.get()); // Always release the child before checking assertions.
        bool completed=false;DWORD code=0;MSG message{};
        const auto end=GetTickCount64()+5000;
        while(GetTickCount64()<end){
            if(PeekMessageW(&message,control,InstallerDone,InstallerDone,PM_REMOVE)){completed=true;code=DWORD(message.wParam);break;}
            Sleep(10);
        }
        const bool closed=netWorker->Close(std::chrono::seconds(5));netWorker.reset();
        DestroyWindow(control);control=nullptr;SetEnvironmentVariableW(L"DELO_UPDATER_WAIT_EVENT",nullptr);
        int failed=0;
        auto check=[&](bool ok,char const* label){std::cout<<(ok?"PASS ":"FAIL ")<<label<<'\n';if(!ok)++failed;};
        check(installing,"real host launches the controlled installer");
        check(responsive,"network queue remains responsive while installer is waiting");
        check(completed&&code==37,"installer completion reports its real exit code");
        check(closed,"network worker closes cleanly");
        return failed?1:0;
    }catch(std::exception const& e){std::cerr<<e.what()<<'\n';return 1;}
}
