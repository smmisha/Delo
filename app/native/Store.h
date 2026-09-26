#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <algorithm>
#include <windows.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <filesystem>
#include <fstream>
#include <stdexcept>

namespace delo {
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValue;
using winrt::Windows::Data::Json::JsonValueType;
inline std::string ReadBytes(std::filesystem::path const& path) {
    if(std::filesystem::file_size(path)>16*1024*1024)throw std::runtime_error("Data file exceeds 16 MiB");
    std::ifstream f(path,std::ios::binary);if(!f)throw std::runtime_error("Cannot read data file");
    return {std::istreambuf_iterator<char>(f),std::istreambuf_iterator<char>()};
}
inline void AtomicWrite(std::filesystem::path const& path,std::string const& bytes,bool backup=true) {
    std::filesystem::create_directories(path.parent_path());auto temp=path;temp+=L".tmp";
    winrt::handle file{CreateFileW(temp.c_str(),GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr)};
    if(file.get()==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot open temporary data file");
    DWORD written{};
    if(bytes.size()>16*1024*1024||!WriteFile(file.get(),bytes.data(),DWORD(bytes.size()),&written,nullptr)||written!=bytes.size()||!FlushFileBuffers(file.get()))throw std::runtime_error("Data write failed");
    file.close();auto bak=path;bak+=L".bak";
    // A scanner or indexer can hold the data file for a few milliseconds right after it was
    // written, and replacing it then fails with a sharing violation. That passes by itself,
    // so retry briefly (about half a second in all) before reporting a failed save. The
    // existence check is repeated on every attempt: a replacement that failed half way can
    // leave the target absent, and the next attempt then has to move the file into place.
    // The system error code stays in the message so a persistent failure says what it was.
    BOOL ok=FALSE;DWORD code=0;
    for(int attempt=0;attempt<8;++attempt){
        ok=std::filesystem::exists(path)?ReplaceFileW(path.c_str(),temp.c_str(),backup?bak.c_str():nullptr,REPLACEFILE_IGNORE_MERGE_ERRORS,nullptr,nullptr):MoveFileExW(temp.c_str(),path.c_str(),MOVEFILE_WRITE_THROUGH);
        if(ok)break;
        code=GetLastError();
        if(code!=ERROR_SHARING_VIOLATION&&code!=ERROR_LOCK_VIOLATION&&code!=ERROR_ACCESS_DENIED&&code!=ERROR_UNABLE_TO_REMOVE_REPLACED&&code!=ERROR_UNABLE_TO_MOVE_REPLACEMENT&&code!=ERROR_UNABLE_TO_MOVE_REPLACEMENT_2)break;
        if(attempt<7)Sleep(20*(attempt+1));
    }
    if(!ok)throw std::runtime_error("Atomic data replacement failed ("+std::to_string(code)+")");
}
class Store {
    std::filesystem::path path_;JsonObject state_{nullptr};uint64_t revision_{};bool blocked_{};
    static JsonObject ParseBytes(std::string const& bytes) {
        auto root=JsonObject::Parse(winrt::to_hstring(bytes));
        if(root.GetNamedNumber(L"format",0)!=1||!root.HasKey(L"state")||root.GetNamedValue(L"state").ValueType()!=JsonValueType::Object)throw std::runtime_error("Unsupported or damaged data format");
        auto revision=root.GetNamedNumber(L"revision",-1);
        if(revision<0||revision>9007199254740000.0||revision!=double(uint64_t(revision)))throw std::runtime_error("Invalid data revision");
        return root;
    }
    static JsonObject Parse(std::filesystem::path const& path){return ParseBytes(ReadBytes(path));}
public:
    explicit Store(std::filesystem::path path):path_(std::move(path)){}
    void Load(){if(!std::filesystem::exists(path_))return;try{auto root=Parse(path_);state_=root.GetNamedObject(L"state");revision_=uint64_t(root.GetNamedNumber(L"revision"));}catch(...){blocked_=true;throw;}}
    JsonObject State() const{return state_;}uint64_t Revision() const{return revision_;}bool Blocked()const{return blocked_;}
    // A save in three steps, so the disk write can happen off the window thread: Prepare checks
    // the revision and serializes, the caller writes the bytes to Path() with AtomicWrite, and
    // Commit adopts the state only after that write succeeded. The caller must not prepare
    // another save until this one is committed or abandoned.
    std::string Prepare(JsonObject const& state,uint64_t expected) const {
        if(blocked_)throw std::runtime_error("Data is damaged; restore backup before saving");
        if(expected!=revision_)throw std::runtime_error("conflict");
        JsonObject root;root.Insert(L"format",JsonValue::CreateNumberValue(1));root.Insert(L"revision",JsonValue::CreateNumberValue(double(revision_+1)));root.Insert(L"state",state);
        return winrt::to_string(root.Stringify());
    }
    uint64_t Commit(JsonObject const& state){state_=state;return ++revision_;}
    std::filesystem::path const& Path() const{return path_;}
    uint64_t Save(JsonObject const& state,uint64_t expected){auto bytes=Prepare(state,expected);AtomicWrite(path_,bytes);return Commit(state);}
    // Backup restoration in the same steps as a save, so its disk work can happen off the window
    // thread: the caller reads BackupPath(), PrepareRestore validates it and builds the restored
    // file (nothing changes yet), the caller keeps the damaged file with PreserveDamaged and
    // writes the bytes with AtomicWrite(Path(),bytes,false), and CommitRestore adopts the result.
    struct Restore{std::string bytes;JsonObject state{nullptr};uint64_t revision{};};
    std::filesystem::path BackupPath() const{auto bak=path_;bak+=L".bak";return bak;}
    Restore PrepareRestore(std::string const& backup) const {
        auto root=ParseBytes(backup);auto restoredRevision=std::max(revision_,uint64_t(root.GetNamedNumber(L"revision")))+1;
        root.Insert(L"revision",JsonValue::CreateNumberValue(double(restoredRevision)));
        return {winrt::to_string(root.Stringify()),root.GetNamedObject(L"state"),restoredRevision};
    }
    static void PreserveDamaged(std::filesystem::path const& path){if(std::filesystem::exists(path)){auto corrupt=path;corrupt+=L".damaged-"+std::to_wstring(GetTickCount64());std::filesystem::copy_file(path,corrupt);}}
    void CommitRestore(Restore const& restored){blocked_=false;state_=restored.state;revision_=restored.revision;}
    void RestoreBackup(){auto restored=PrepareRestore(ReadBytes(BackupPath()));PreserveDamaged(path_);AtomicWrite(path_,restored.bytes,false);CommitRestore(restored);}
};
}
