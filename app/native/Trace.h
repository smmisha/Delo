#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <filesystem>
#include <fstream>
#include <string>

namespace delo {
// The diagnostic log keeps at most two files: once the current one reaches the limit it becomes
// <name>.1<ext>, replacing the older one, and a new file starts. It never grows without bound.
class TraceLog {
    std::filesystem::path path_;std::ofstream out_;std::uintmax_t size_{},limit_{};
public:
    void Open(std::filesystem::path path,std::uintmax_t limit=1024*1024){
        path_=std::move(path);limit_=limit;std::error_code error;
        size_=std::filesystem::exists(path_,error)?std::filesystem::file_size(path_,error):0;
        out_.open(path_,std::ios::app|std::ios::binary);
    }
    explicit operator bool() const{return out_.is_open()&&out_.good();}
    std::filesystem::path Previous() const{auto previous=path_;previous.replace_extension(L".1"+path_.extension().wstring());return previous;}
    void Write(std::string const& line){
        if(!*this)return;
        if(size_>=limit_){
            out_.close();
            // If the file cannot be moved aside, keep appending rather than losing the log.
            if(MoveFileExW(path_.c_str(),Previous().c_str(),MOVEFILE_REPLACE_EXISTING))size_=0;
            out_.open(path_,std::ios::app|std::ios::binary);if(!out_)return;
        }
        out_<<line<<'\n';out_.flush();size_+=line.size()+1;
    }
};
}
