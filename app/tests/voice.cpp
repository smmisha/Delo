#define NOMINMAX
#include "../native/Voice.h"
#include <iostream>
void Require(bool value,char const* name){if(!value)throw std::runtime_error(name);std::cout<<"PASS "<<name<<'\n';}
delo::Voice::Update Finish(delo::Voice& voice){
    auto deadline=GetTickCount64()+30000;delo::Voice::Update result;
    while(voice.Busy()&&GetTickCount64()<deadline){for(auto& update:voice.Take())if(update.state=="result"||update.state=="error"||update.state=="cancelled")result=update;Sleep(20);}
    for(auto& update:voice.Take())if(update.state=="result"||update.state=="error"||update.state=="cancelled")result=update;
    Require(!voice.Busy(),"native worker finishes within timeout");return result;
}
int wmain(int argc,wchar_t** argv){try{
    if(argc!=4)throw std::runtime_error("runtime fixture temporary required");
    namespace fs=std::filesystem;fs::path runtime=argv[1],fixture=argv[2],temporary=argv[3];
    delo::Voice missing(runtime/L"missing",temporary);bool rejected=false;try{missing.Start("en");}catch(std::exception const& e){rejected=std::string(e.what())=="voiceMissing";}Require(rejected,"missing engine fails before recording");
    delo::Voice voice(runtime,temporary/L"Український каталог з пробілами");
    voice.Start("en",fixture);auto result=Finish(voice);
    Require(result.state=="result"&&result.text.find("milk")!=std::string::npos,"real recognition supports Unicode temporary paths");
    Require(!fs::exists(temporary/L"Український каталог з пробілами"/std::to_wstring(GetCurrentProcessId())),"audio and transcript cleaned after success");
    voice.Start("en",fixture);bool decoding=false;const auto deadline=GetTickCount64()+5000;
    while(!decoding&&GetTickCount64()<deadline){for(auto& update:voice.Take())decoding|=update.state=="transcribing";Sleep(10);}
    Require(decoding,"inference starts asynchronously");voice.Cancel();result=Finish(voice);Require(result.state=="cancelled","cancel terminates child inference");
    Require(!fs::exists(temporary/L"Український каталог з пробілами"/std::to_wstring(GetCurrentProcessId())),"audio and transcript cleaned after cancellation");
    voice.Start("en",fixture.parent_path()/L"missing.wav");result=Finish(voice);Require(result.state=="error","missing input does not return false success");
    return 0;
}catch(std::exception const& error){std::cerr<<error.what()<<'\n';return 1;}}
