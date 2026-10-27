#define NOMINMAX
#include "../native/Updater.h"
#include <iostream>
#include <fstream>
using namespace winrt::Windows::Data::Json;
int checks{};
void check(bool value,char const* name){if(!value)throw std::runtime_error(name);++checks;}
template<class F> void rejects(F action,char const* name){bool failed=false;try{action();}catch(...){failed=true;}check(failed,name);}
JsonObject release(){return JsonObject::Parse(LR"({"tag_name":"v0.3.8","assets":[{"name":"Delo-0.3.8-windows-x64-setup.exe","browser_download_url":"https://github.com/smmisha/Delo/releases/download/v0.3.8/Delo-0.3.8-windows-x64-setup.exe","size":3,"digest":"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]})");}
int wmain(int argc,wchar_t** argv){try{
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    auto valid=release();auto asset=delo::InstallerRelease(valid);check(asset.size==3&&asset.version==L"v0.3.8","release selection");
    for(auto tag:{L"v0.3.8-beta",L"v0.3.8/other",L"0.3",L"0.3.8.9",L"v.3.8",L"v0..8"}){auto invalid=release();invalid.SetNamedValue(L"tag_name",JsonValue::CreateStringValue(tag));rejects([&]{delo::InstallerRelease(invalid);},"invalid release tag rejected");}
    for(auto key:{L"draft",L"prerelease"}){auto invalid=release();invalid.SetNamedValue(key,JsonValue::CreateBooleanValue(true));rejects([&]{delo::InstallerRelease(invalid);},"nonproduction release rejected");}
    for(auto url:{L"http://github.com/smmisha/Delo/releases/download/v0.3.8/Delo-0.3.8-windows-x64-setup.exe",L"https://github.com/other/Delo/releases/download/v0.3.8/Delo-0.3.8-windows-x64-setup.exe"}){auto invalid=release();invalid.GetNamedArray(L"assets").GetObjectAt(0).SetNamedValue(L"browser_download_url",JsonValue::CreateStringValue(url));rejects([&]{delo::InstallerRelease(invalid);},"foreign asset rejected");}
    for(auto digest:{L"",L"sha256:bad",L"sha256:za7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}){auto invalid=release();invalid.GetNamedArray(L"assets").GetObjectAt(0).SetNamedValue(L"digest",JsonValue::CreateStringValue(digest));rejects([&]{delo::InstallerRelease(invalid);},"missing or invalid hash rejected");}
    for(auto size:{0.0,-1.0,1.5,double(delo::MaxUpdateBytes)+1}){auto invalid=release();invalid.GetNamedArray(L"assets").GetObjectAt(0).SetNamedValue(L"size",JsonValue::CreateNumberValue(size));rejects([&]{delo::InstallerRelease(invalid);},"invalid size rejected");}
    for(auto url:{L"http://github.com/test",L"https://github.com.evil.test/test",L"https://evil.test/test",L"https://user:password@github.com/test",L"https://github.com:444/test"})rejects([&]{delo::InstallerUrl(url);},"unsafe redirect rejected");
    check(delo::InstallerUrl(L"https://release-assets.githubusercontent.com/a?token=b").path==L"/a?token=b","GitHub signed redirect preserved");
    delo::UpdateHash hash;BYTE abc[]={'a','b','c'};hash.Add(abc,1);hash.Add(abc+1,2);check(hash.Finish()==asset.sha256,"streaming SHA-256 known vector");
    auto arguments=delo::InstallerArguments(L"C:\\test folder\\setup.log");check(arguments.find(L"/NORESTART")!=std::wstring::npos&&arguments.find(L"/DIR=")==std::wstring::npos&&arguments.find(L"/LOG=\"C:\\test folder\\setup.log\"")!=std::wstring::npos,"installer preserves registered directory and quotes paths");
    rejects([]{delo::InstallerArguments(L"C:\\test\" /DIR=elsewhere");},"installer argument injection rejected");
    if(argc>1){
        auto root=std::filesystem::absolute(argv[1]);std::filesystem::create_directories(root);
        delo::InstallerAsset checksumAsset{L"v0.3.6",L"https://github.com/smmisha/Delo/releases/download/v0.3.6/Delo-0.3.6-windows-x64-setup.exe.sha256",L"5312b1fdd6b14ba231489e8b4a2e384e293c619172c537401ed7cf2a7eeae721",100};
        std::atomic<bool> cancel{false};auto target=root/L"download.txt";
        delo::DownloadInstaller(checksumAsset,target,cancel,[](int){});check(std::filesystem::file_size(target)==100,"real HTTPS redirect download verified");
        rejects([&]{delo::DownloadInstaller(checksumAsset,target,cancel,[](int){});},"existing download file never overwritten");
        check(std::filesystem::file_size(target)==100,"existing file preserved");
        auto bad=checksumAsset;bad.sha256=std::wstring(64,L'0');auto badFile=root/L"invalid.txt";
        rejects([&]{delo::DownloadInstaller(bad,badFile,cancel,[](int){});},"checksum mismatch rejected after real download");check(!std::filesystem::exists(badFile),"checksum failure removes partial file");
        bad=checksumAsset;bad.size=101;rejects([&]{delo::DownloadInstaller(bad,badFile,cancel,[](int){});},"truncated download rejected");check(!std::filesystem::exists(badFile),"size mismatch leaves no partial file");
        cancel.store(true);rejects([&]{delo::DownloadInstaller(checksumAsset,badFile,cancel,[](int){});},"cancelled download stops");check(!std::filesystem::exists(badFile),"cancel leaves no partial file");
        std::filesystem::remove(target);
        auto old=root/L"download-12-34";auto other=root/L"unrelated";
        std::filesystem::create_directories(old);std::filesystem::create_directories(other);
        std::ofstream(old/L"Delo-setup.exe")<<"old";std::ofstream(old/L"setup.log")<<"log";std::ofstream(other/L"Delo-setup.exe")<<"keep";
        delo::CleanUpdateCache(root);check(!std::filesystem::exists(old),"prior staging files cleaned without recursion");check(std::filesystem::exists(other/L"Delo-setup.exe"),"unrelated cache directory preserved");
        std::filesystem::remove(other/L"Delo-setup.exe");std::filesystem::remove(other);
    }
    std::cout<<checks<<" updater checks PASS\n";return 0;
}catch(winrt::hresult_error const& e){std::cerr<<winrt::to_string(e.message())<<'\n';return 1;}catch(std::exception const& e){std::cerr<<e.what()<<'\n';return 1;}}
