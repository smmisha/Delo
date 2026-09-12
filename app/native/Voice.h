#pragma once
#include <windows.h>
#include <mmsystem.h>
#include <filesystem>
#include <fstream>
#include <thread>
#include <mutex>
#include <atomic>
#include <vector>
#include <string>
#include <stdexcept>
#include <algorithm>
#include <cmath>
#pragma comment(lib,"winmm.lib")

namespace delo {
// Owns one microphone/inference session. Worker never touches HWNDs, COM or task data.
class Voice {
public:
    struct Update {std::string state,text,error;};
    Voice(std::filesystem::path runtime,std::filesystem::path temporary):runtime_(std::move(runtime)),temporary_(std::move(temporary)){}
    ~Voice(){Cancel();if(worker_.joinable())worker_.join();}
    bool Busy() const{return busy_;}
    void Stop(){stop_=true;}
    void Cancel(){cancel_=true;stop_=true;}
    std::vector<Update> Take(){std::lock_guard<std::mutex> lock(mutex_);auto result=std::move(updates_);updates_.clear();return result;}
    void Start(std::string language,std::filesystem::path fixture={}){
        if(busy_)throw std::runtime_error("voiceBusy");
        if(worker_.joinable())worker_.join();
        if(language!="ru"&&language!="uk"&&language!="en")throw std::runtime_error("voiceLanguage");
        if(!std::filesystem::exists(runtime_/L"whisper-cli.exe")||!std::filesystem::exists(runtime_/L"ggml-small-q5_1.bin"))throw std::runtime_error("voiceMissing");
        Take();cancel_=false;stop_=false;busy_=true;
        try{worker_=std::thread([this,language,fixture]{Run(language,fixture);});}catch(...){busy_=false;throw;}
    }
private:
    std::filesystem::path runtime_,temporary_;
    std::thread worker_;
    std::mutex mutex_;
    std::vector<Update> updates_;
    std::atomic<bool> busy_{false},cancel_{false},stop_{false};
    void Publish(std::string state,std::string text={},std::string error={}){std::lock_guard<std::mutex> lock(mutex_);updates_.push_back({std::move(state),std::move(text),std::move(error)});}
    struct Handle {HANDLE value{};~Handle(){if(value&&value!=INVALID_HANDLE_VALUE)CloseHandle(value);}operator HANDLE()const{return value;}};
    struct Capture {
        HWAVEIN device{};WAVEHDR header{};bool prepared{};
        ~Capture(){if(device){waveInReset(device);if(prepared)waveInUnprepareHeader(device,&header,sizeof(header));waveInClose(device);}}
    };
    std::vector<short> Record(){
        // One bounded buffer also captures the final partial block when Stop resets it.
        std::vector<short> samples(16000*60);
        Handle done{CreateEventW(nullptr,FALSE,FALSE,nullptr)};
        if(!done.value)throw std::runtime_error("voiceMic");
        Capture capture;WAVEFORMATEX format{WAVE_FORMAT_PCM,1,16000,32000,2,16,0};
        if(waveInOpen(&capture.device,WAVE_MAPPER,&format,reinterpret_cast<DWORD_PTR>(done.value),0,CALLBACK_EVENT)!=MMSYSERR_NOERROR)throw std::runtime_error("voiceMic");
        capture.header.lpData=reinterpret_cast<LPSTR>(samples.data());capture.header.dwBufferLength=DWORD(samples.size()*sizeof(short));
        if(waveInPrepareHeader(capture.device,&capture.header,sizeof(WAVEHDR))!=MMSYSERR_NOERROR)throw std::runtime_error("voiceMic");capture.prepared=true;
        if(waveInAddBuffer(capture.device,&capture.header,sizeof(WAVEHDR))!=MMSYSERR_NOERROR||waveInStart(capture.device)!=MMSYSERR_NOERROR)throw std::runtime_error("voiceMic");
        Publish("recording");const auto start=GetTickCount64();
        while(!stop_&&!(capture.header.dwFlags&WHDR_DONE)&&GetTickCount64()-start<60000)WaitForSingleObject(done,25);
        waveInReset(capture.device);
        samples.resize(capture.header.dwBytesRecorded/sizeof(short));
        if(cancel_)return {};
        if(samples.size()<8000)throw std::runtime_error("voiceNoSpeech");
        double energy=0;for(auto sample:samples)energy+=double(sample)*sample;
        if(std::sqrt(energy/samples.size())<12)throw std::runtime_error("voiceNoSpeech");
        return samples;
    }
    static void WriteWave(std::filesystem::path const& path,std::vector<short> const& samples){
        std::ofstream out(path,std::ios::binary|std::ios::trunc);
        auto u32=[&](DWORD n){out.write(reinterpret_cast<char*>(&n),4);};auto u16=[&](WORD n){out.write(reinterpret_cast<char*>(&n),2);};
        DWORD bytes=DWORD(samples.size()*sizeof(short));out.write("RIFF",4);u32(bytes+36);out.write("WAVEfmt ",8);u32(16);u16(1);u16(1);u32(16000);u32(32000);u16(2);u16(16);out.write("data",4);u32(bytes);out.write(reinterpret_cast<char const*>(samples.data()),bytes);
        if(!out)throw std::runtime_error("voiceFailed");
    }
    static std::wstring Quote(std::filesystem::path const& path){return L"\""+path.wstring()+L"\"";}
    void Run(std::string const& language,std::filesystem::path const& fixture) noexcept {
        std::filesystem::path work;
        try{
            if(cancel_)throw std::runtime_error("voiceCancelled");
            // Fixed private per-process directory; never accept a path from production UI.
            work=temporary_/std::to_wstring(GetCurrentProcessId());std::filesystem::create_directories(work);
            auto wav=work/L"input.wav",output=work/L"result",transcript=work/L"result.txt";
            std::error_code ignored;std::filesystem::remove(transcript,ignored);
            if(fixture.empty()){auto samples=Record();if(!cancel_)WriteWave(wav,samples);}
            else std::filesystem::copy_file(fixture,wav,std::filesystem::copy_options::overwrite_existing);
            if(cancel_)throw std::runtime_error("voiceCancelled");
            Publish("transcribing");
            auto exe=runtime_/L"whisper-cli.exe";
            auto command=Quote(exe)+L" -m "+Quote(runtime_/L"ggml-small-q5_1.bin")+L" -f "+Quote(wav)+L" -of "+Quote(output)+L" -otxt -np -nt -ng -t 8 -bs 1 -bo 1 -l "+std::wstring(language.begin(),language.end());
            Handle job{CreateJobObjectW(nullptr,nullptr)};if(!job.value)throw std::runtime_error("voiceFailed");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))throw std::runtime_error("voiceFailed");
            STARTUPINFOW startup{sizeof(startup)};PROCESS_INFORMATION info{};
            if(!CreateProcessW(exe.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW|CREATE_SUSPENDED|BELOW_NORMAL_PRIORITY_CLASS,nullptr,runtime_.c_str(),&startup,&info))throw std::runtime_error("voiceFailed");
            Handle process{info.hProcess},thread{info.hThread};
            if(!AssignProcessToJobObject(job,process)||ResumeThread(thread)==DWORD(-1)){TerminateProcess(process,1);WaitForSingleObject(process,5000);throw std::runtime_error("voiceFailed");}
            auto start=GetTickCount64();
            while(WaitForSingleObject(process,25)==WAIT_TIMEOUT){
                if(cancel_||GetTickCount64()-start>120000){TerminateJobObject(job,1);WaitForSingleObject(process,5000);throw std::runtime_error(cancel_?"voiceCancelled":"voiceTimeout");}
            }
            DWORD exitCode{};GetExitCodeProcess(process,&exitCode);
            if(cancel_)throw std::runtime_error("voiceCancelled");
            if(exitCode||!std::filesystem::exists(transcript)||std::filesystem::file_size(transcript)>64000)throw std::runtime_error("voiceFailed");
            std::ifstream input(transcript,std::ios::binary);std::string text{std::istreambuf_iterator<char>(input),{}};
            if(text.rfind("\xef\xbb\xbf",0)==0)text.erase(0,3);
            auto first=text.find_first_not_of(" \t\r\n"),last=text.find_last_not_of(" \t\r\n");
            if(first==std::string::npos)throw std::runtime_error("voiceNoSpeech");
            Publish("result",text.substr(first,last-first+1));
        }catch(std::exception const& error){Publish(cancel_?"cancelled":"error",{},error.what());}
        catch(...){Publish(cancel_?"cancelled":"error",{},"voiceFailed");}
        if(!work.empty()){std::error_code ignored;std::filesystem::remove_all(work,ignored);}
        busy_=false;
    }
};
}
