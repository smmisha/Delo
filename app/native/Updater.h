#pragma once
#include "Update.h"
#include <bcrypt.h>
#include <filesystem>
#include <functional>
#include <atomic>
#include <algorithm>
#include <cstdint>
#include <cwctype>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#pragma comment(lib,"Bcrypt.lib")

namespace delo {
constexpr std::uint64_t MaxUpdateBytes=512ULL*1024*1024;
struct InstallerAsset { std::wstring version,url,sha256; std::uint64_t size{}; };
inline bool ReleaseVersion(std::wstring const& value) {
    size_t start=(!value.empty()&&value[0]==L'v')?1:0;int dots=0,digits=0;
    for(size_t i=start;i<value.size();++i){auto c=value[i];if(c==L'.'){if(!digits||++dots>2)return false;digits=0;}else if(c>=L'0'&&c<=L'9'){if(++digits>5)return false;}else return false;}
    return dots==2&&digits>0;
}
inline bool Sha256Text(std::wstring const& value) {
    return value.size()==64&&std::all_of(value.begin(),value.end(),[](wchar_t c){return (c>=L'0'&&c<=L'9')||(c>=L'a'&&c<=L'f')||(c>=L'A'&&c<=L'F');});
}
// Metadata comes only from this repository's HTTPS release API. The page cannot supply a URL.
inline InstallerAsset InstallerRelease(winrt::Windows::Data::Json::JsonObject const& release) {
    InstallerAsset result;result.version=release.GetNamedString(L"tag_name",L"").c_str();
    if(!ReleaseVersion(result.version)||release.GetNamedBoolean(L"draft",false)||release.GetNamedBoolean(L"prerelease",false))throw std::runtime_error("Invalid update release");
    auto version=result.version;if(version[0]==L'v')version.erase(0,1);
    auto name=L"Delo-"+version+L"-windows-x64-setup.exe";
    auto expected=L"https://github.com/smmisha/Delo/releases/download/"+result.version+L"/"+name;
    for(auto const& item:release.GetNamedArray(L"assets")){
        auto asset=item.GetObject();if(asset.GetNamedString(L"name",L"")!=name)continue;
        result.url=asset.GetNamedString(L"browser_download_url",L"").c_str();auto digest=std::wstring(asset.GetNamedString(L"digest",L"").c_str());
        auto size=asset.GetNamedNumber(L"size",0);
        if(result.url!=expected||digest.substr(0,7)!=L"sha256:"||!Sha256Text(digest.substr(7))||!(size>0&&size<=double(MaxUpdateBytes))||size!=double(std::uint64_t(size)))throw std::runtime_error("Invalid update asset");
        result.sha256=digest.substr(7);std::transform(result.sha256.begin(),result.sha256.end(),result.sha256.begin(),::towlower);result.size=std::uint64_t(size);return result;
    }
    throw std::runtime_error("Release has no verified Windows installer");
}
class UpdateHash {
    BCRYPT_ALG_HANDLE algorithm{};BCRYPT_HASH_HANDLE hash{};std::vector<BYTE> object;
public:
    UpdateHash(){
        if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0)throw std::runtime_error("SHA-256 unavailable");
        DWORD size{},written{};
        if(BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<BYTE*>(&size),sizeof(size),&written,0)<0){BCryptCloseAlgorithmProvider(algorithm,0);throw std::runtime_error("SHA-256 unavailable");}
        object.resize(size);
        if(BCryptCreateHash(algorithm,&hash,object.data(),size,nullptr,0,0)<0){BCryptCloseAlgorithmProvider(algorithm,0);throw std::runtime_error("SHA-256 unavailable");}
    }
    ~UpdateHash(){if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);}
    UpdateHash(UpdateHash const&)=delete;UpdateHash& operator=(UpdateHash const&)=delete;
    void Add(BYTE* bytes,DWORD size){if(BCryptHashData(hash,bytes,size,0)<0)throw std::runtime_error("SHA-256 failed");}
    std::wstring Finish(){BYTE digest[32]{};if(BCryptFinishHash(hash,digest,sizeof(digest),0)<0)throw std::runtime_error("SHA-256 failed");std::wstring text;constexpr wchar_t hex[]=L"0123456789abcdef";for(auto b:digest){text+=hex[b>>4];text+=hex[b&15];}return text;}
};
struct UpdateUrl {std::wstring host,path;};
inline UpdateUrl InstallerUrl(std::wstring const& value) {
    URL_COMPONENTS parts{sizeof(parts)};parts.dwHostNameLength=parts.dwUrlPathLength=parts.dwExtraInfoLength=parts.dwUserNameLength=parts.dwPasswordLength=DWORD(-1);
    if(!WinHttpCrackUrl(value.c_str(),DWORD(value.size()),0,&parts)||parts.nScheme!=INTERNET_SCHEME_HTTPS||parts.nPort!=443||parts.dwUserNameLength||parts.dwPasswordLength)throw std::runtime_error("Unsafe update redirect");
    UpdateUrl result{std::wstring(parts.lpszHostName,parts.dwHostNameLength),std::wstring(parts.lpszUrlPath,parts.dwUrlPathLength)};
    if(parts.dwExtraInfoLength)result.path.append(parts.lpszExtraInfo,parts.dwExtraInfoLength);
    std::transform(result.host.begin(),result.host.end(),result.host.begin(),::towlower);
    if(result.host!=L"github.com"&&result.host!=L"release-assets.githubusercontent.com"&&result.host!=L"objects.githubusercontent.com"&&result.host!=L"github-releases.githubusercontent.com")throw std::runtime_error("Unsafe update host");
    return result;
}
// Stream the installer to a newly created file, never into memory. Check every redirect,
// exact byte count and GitHub's SHA-256 before it can be executed. Partial files are removed.
inline void DownloadInstaller(InstallerAsset const& asset,std::filesystem::path const& file,std::atomic<bool> const& cancel,std::function<void(int)> const& progress) {
    if(!Sha256Text(asset.sha256)||!asset.size||asset.size>MaxUpdateBytes)throw std::runtime_error("Invalid update download");
    struct CloseHttp{void operator()(void* h)const{if(h)WinHttpCloseHandle(h);}};using Http=std::unique_ptr<void,CloseHttp>;
    Http session{WinHttpOpen(L"Delo",WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,WINHTTP_NO_PROXY_NAME,WINHTTP_NO_PROXY_BYPASS,0)};
    if(!session||!WinHttpSetTimeouts(session.get(),5000,10000,15000,30000))throw std::runtime_error("Update connection failed");
    std::wstring url=asset.url;Http connection,request;auto started=GetTickCount64();
    auto check=[&]{if(cancel.load())throw std::runtime_error("Update cancelled");if(GetTickCount64()-started>15*60*1000)throw std::runtime_error("Update download timed out");};
    for(int redirect=0;;++redirect){
        check();auto parsed=InstallerUrl(url);
        connection.reset(WinHttpConnect(session.get(),parsed.host.c_str(),443,0));if(!connection)throw std::runtime_error("Update connection failed");
        request.reset(WinHttpOpenRequest(connection.get(),L"GET",parsed.path.c_str(),nullptr,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,WINHTTP_FLAG_SECURE));if(!request)throw std::runtime_error("Update request failed");
        DWORD disabled=WINHTTP_DISABLE_REDIRECTS;
        if(!WinHttpSetOption(request.get(),WINHTTP_OPTION_DISABLE_FEATURE,&disabled,sizeof(disabled))||!WinHttpSendRequest(request.get(),nullptr,0,WINHTTP_NO_REQUEST_DATA,0,0,0)||!WinHttpReceiveResponse(request.get(),nullptr))throw std::runtime_error("Update request failed");
        DWORD status{},size=sizeof(status);
        if(!WinHttpQueryHeaders(request.get(),WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,WINHTTP_HEADER_NAME_BY_INDEX,&status,&size,WINHTTP_NO_HEADER_INDEX))throw std::runtime_error("Update status unavailable");
        if(status==200)break;
        if(redirect>=5||(status!=301&&status!=302&&status!=303&&status!=307&&status!=308))throw std::runtime_error("Update download returned HTTP "+std::to_string(status));
        size=0;WinHttpQueryHeaders(request.get(),WINHTTP_QUERY_LOCATION,WINHTTP_HEADER_NAME_BY_INDEX,nullptr,&size,WINHTTP_NO_HEADER_INDEX);
        if(!size||size>32768)throw std::runtime_error("Invalid update redirect");
        std::vector<wchar_t> location(size/sizeof(wchar_t)+1);
        if(!WinHttpQueryHeaders(request.get(),WINHTTP_QUERY_LOCATION,WINHTTP_HEADER_NAME_BY_INDEX,location.data(),&size,WINHTTP_NO_HEADER_INDEX))throw std::runtime_error("Invalid update redirect");
        url=location.data();request.reset();connection.reset();
    }
    DWORD contentLength{},lengthSize=sizeof(contentLength);
    if(WinHttpQueryHeaders(request.get(),WINHTTP_QUERY_CONTENT_LENGTH|WINHTTP_QUERY_FLAG_NUMBER,WINHTTP_HEADER_NAME_BY_INDEX,&contentLength,&lengthSize,WINHTTP_NO_HEADER_INDEX)&&contentLength!=asset.size)throw std::runtime_error("Update size mismatch");
    HANDLE raw=CreateFileW(file.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_SEQUENTIAL_SCAN,nullptr);
    if(raw==INVALID_HANDLE_VALUE)throw std::runtime_error("Could not create update file");
    try{
        UpdateHash hash;std::vector<BYTE> buffer(64*1024);std::uint64_t total=0;int last=-1;
        for(;;){check();DWORD read{};if(!WinHttpReadData(request.get(),buffer.data(),DWORD(buffer.size()),&read))throw std::runtime_error("Update download interrupted");if(!read)break;
            total+=read;if(total>asset.size)throw std::runtime_error("Update size mismatch");DWORD written{};
            if(!WriteFile(raw,buffer.data(),read,&written,nullptr)||written!=read)throw std::runtime_error("Could not save update");hash.Add(buffer.data(),read);
            int percent=int(total*100/asset.size);if(percent!=last){progress(percent);last=percent;}
        }
        check();if(total!=asset.size||hash.Finish()!=asset.sha256)throw std::runtime_error("Update checksum mismatch");
        if(!FlushFileBuffers(raw))throw std::runtime_error("Could not finish update file");CloseHandle(raw);
    }catch(...){CloseHandle(raw);std::error_code ignored;std::filesystem::remove(file,ignored);throw;}
}
inline std::wstring InstallerArguments(std::filesystem::path const& log) {
    if(log.wstring().find_first_of(L"\"\r\n")!=std::wstring::npos)throw std::runtime_error("Invalid installer log path");
    return L"/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /LOG=\""+log.wstring()+L"\"";
}
// Keep only the current download. Remove known files in our own previous staging
// directories, without recursive deletion or following junctions. Locked setup files wait.
inline void CleanUpdateCache(std::filesystem::path const& root) {
    auto attributes=GetFileAttributesW(root.c_str());if(attributes==INVALID_FILE_ATTRIBUTES||(attributes&FILE_ATTRIBUTE_REPARSE_POINT))return;
    std::error_code error;std::filesystem::directory_iterator entries(root,error);
    for(auto end=std::filesystem::directory_iterator();!error&&entries!=end;entries.increment(error)){
        auto directory=entries->path();auto name=directory.filename().wstring();
        if(name.substr(0,9)!=L"download-"||name.size()==9||name.find_first_not_of(L"0123456789-",9)!=std::wstring::npos)continue;
        auto flags=GetFileAttributesW(directory.c_str());if(flags==INVALID_FILE_ATTRIBUTES||!(flags&FILE_ATTRIBUTE_DIRECTORY)||(flags&FILE_ATTRIBUTE_REPARSE_POINT))continue;
        for(auto file:{L"Delo-setup.exe",L"setup.log"}){std::error_code ignored;std::filesystem::remove(directory/file,ignored);}
        std::error_code ignored;std::filesystem::remove(directory,ignored);
    }
}
}
