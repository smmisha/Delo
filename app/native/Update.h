#pragma once
#include <windows.h>
#include <winhttp.h>
#include <cwchar>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#pragma comment(lib,"Winhttp.lib")

namespace delo {
// N13: one HTTPS GET, run on a worker thread. Throws on any failure; the body is capped at 1 MiB.
// Only the request line and a User-Agent leave the computer: no tasks, no identifiers.
inline std::string HttpsGet(wchar_t const* host,wchar_t const* path,DWORD& status){
    struct Close{void operator()(void* handle)const{if(handle)WinHttpCloseHandle(handle);}};
    using Handle=std::unique_ptr<void,Close>;
    auto failed=[](char const* what){return std::runtime_error(std::string(what)+" ("+std::to_string(GetLastError())+")");};
    Handle session{WinHttpOpen(L"Delo",WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,WINHTTP_NO_PROXY_NAME,WINHTTP_NO_PROXY_BYPASS,0)};
    if(!session)throw failed("WinHttpOpen failed");
    WinHttpSetTimeouts(session.get(),5000,5000,10000,10000);
    Handle connection{WinHttpConnect(session.get(),host,INTERNET_DEFAULT_HTTPS_PORT,0)};
    if(!connection)throw failed("WinHttpConnect failed");
    Handle request{WinHttpOpenRequest(connection.get(),L"GET",path,nullptr,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,WINHTTP_FLAG_SECURE)};
    if(!request)throw failed("WinHttpOpenRequest failed");
    constexpr wchar_t headers[]=L"Accept: application/vnd.github+json\r\n";
    if(!WinHttpSendRequest(request.get(),headers,DWORD(-1L),WINHTTP_NO_REQUEST_DATA,0,0,0)||!WinHttpReceiveResponse(request.get(),nullptr))throw failed("Update request failed");
    DWORD size=sizeof(status);status=0;
    if(!WinHttpQueryHeaders(request.get(),WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,WINHTTP_HEADER_NAME_BY_INDEX,&status,&size,WINHTTP_NO_HEADER_INDEX))throw failed("Update status unavailable");
    std::string body;
    for(;;){
        DWORD available=0;if(!WinHttpQueryDataAvailable(request.get(),&available))throw failed("Update read failed");
        if(!available)break;
        if(body.size()+available>1024*1024)throw std::runtime_error("Update response too large");
        std::string chunk(available,'\0');DWORD read=0;
        if(!WinHttpReadData(request.get(),chunk.data(),available,&read))throw failed("Update read failed");
        if(!read)break;body.append(chunk.data(),read);
    }
    return body;
}
// The product version from this executable's VERSIONINFO, as "major.minor.patch".
inline std::wstring OwnVersion(){
    wchar_t path[4096]{};if(!GetModuleFileNameW(nullptr,path,DWORD(std::size(path))))return L"0.0.0";
    DWORD ignored{};const DWORD size=GetFileVersionInfoSizeW(path,&ignored);if(!size)return L"0.0.0";
    std::vector<BYTE> data(size);if(!GetFileVersionInfoW(path,0,size,data.data()))return L"0.0.0";
    VS_FIXEDFILEINFO* info{};UINT length{};
    if(!VerQueryValueW(data.data(),L"\\",reinterpret_cast<void**>(&info),&length)||!info)return L"0.0.0";
    return std::to_wstring(HIWORD(info->dwProductVersionMS))+L"."+std::to_wstring(LOWORD(info->dwProductVersionMS))+L"."+std::to_wstring(HIWORD(info->dwProductVersionLS));
}
// "v0.3.1" against "0.3.0": true only when the tag is a readable, strictly higher version.
inline std::vector<unsigned long> VersionParts(std::wstring text){
    if(!text.empty()&&(text[0]==L'v'||text[0]==L'V'))text.erase(0,1);
    std::vector<unsigned long> parts;size_t position=0;
    while(parts.size()<3){
        const size_t end=text.find(L'.',position);
        auto piece=text.substr(position,end==std::wstring::npos?std::wstring::npos:end-position);
        if(piece.empty()||piece[0]<L'0'||piece[0]>L'9')return {};
        try{parts.push_back(std::stoul(piece));}catch(...){return {};}
        if(end==std::wstring::npos)break;position=end+1;
    }
    while(parts.size()<3)parts.push_back(0);
    return parts;
}
inline bool NewerVersion(std::wstring const& tag,std::wstring const& current){
    auto a=VersionParts(tag),b=VersionParts(current);
    return !a.empty()&&!b.empty()&&a>b;
}
}
