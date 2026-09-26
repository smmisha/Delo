#include "../native/Store.h"
#include "../native/Hotkey.h"
#include "../native/Trace.h"
#include "../native/Worker.h"
#include <atomic>
#include <vector>
#include <iostream>
#include <thread>
void Require(bool value,char const* name){if(!value)throw std::runtime_error(name);std::cout<<"PASS "<<name<<'\n';}
void TestRollback(std::filesystem::path const& dir){
    auto key=ParseHotkey(L"ctrl+Alt+n");Require(key.key==L'N'&&(key.modifiers&MOD_CONTROL)&&(key.modifiers&MOD_ALT),"case insensitive hotkey");
    for(auto value:{L"Ctrl+A+B",L"Ctrl+Ctrl+A",L"Ctrl+",L"A",L"Ctrl++A"}){bool failed=false;try{ParseHotkey(value);}catch(...){failed=true;}Require(failed,"invalid hotkey rejected");}
    Require(std::wstring(TrayLabel(L"uk",2))==L"Нове завдання"&&std::wstring(TrayLabel(L"en",3))==L"Exit"&&std::wstring(TrayLabel(L"ru",1))==L"Показать список","tray languages");
    auto path=dir/L"rollback.json";delo::Store store(path);delo::JsonObject state;
    state.Insert(L"v",delo::JsonValue::CreateNumberValue(1));store.Save(state,0);
    auto before=delo::ReadBytes(path);auto temp=path;temp+=L".tmp";
    winrt::handle locked{CreateFileW(temp.c_str(),GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr)};
    Require(locked.get()!=INVALID_HANDLE_VALUE,"write failure fixture locked");
    bool rejected=false;try{store.Save(state,1);}catch(...){rejected=true;}
    Require(rejected&&store.Revision()==1&&delo::ReadBytes(path)==before,"failed write leaves state and revision intact");
    locked.close();store.Save(state,1);auto prior=store.Revision();store.RestoreBackup();
    Require(store.Revision()>prior,"restoration advances revision for other windows");
    auto backup=path;backup+=L".bak";delo::AtomicWrite(backup,"broken",false);before=delo::ReadBytes(path);rejected=false;
    try{store.RestoreBackup();}catch(...){rejected=true;}
    Require(rejected&&delo::ReadBytes(path)==before,"invalid backup cannot replace current data");
}
// A scanner or indexer can hold the data file for a few milliseconds right after it was
// written; replacing it then fails with a sharing violation. That must not fail the save.
void TestTransientLock(std::filesystem::path const& dir){
    auto path=dir/L"held.json";delo::AtomicWrite(path,"one",false);
    winrt::handle held{CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr)};
    Require(held.get()!=INVALID_HANDLE_VALUE,"transient lock fixture held");
    std::thread release([&]{Sleep(150);held.close();});
    bool saved=true;try{delo::AtomicWrite(path,"two");}catch(...){saved=false;}
    release.join();
    Require(saved&&delo::ReadBytes(path)=="two","a data file held for a moment no longer fails the save");
    winrt::handle stuck{CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr)};
    bool rejected=false;std::string message;try{delo::AtomicWrite(path,"three");}catch(std::exception const& error){rejected=true;message=error.what();}
    Require(rejected&&delo::ReadBytes(path)=="two","a file held past the retries still rejects the save and keeps the data");
    Require(message.rfind("Atomic data replacement failed (",0)==0,"a persistent failure reports its system error code");
}
// The host writes off the window thread: Prepare must not change anything, only Commit after a
// confirmed write adopts the state, and a stale revision is still refused at Prepare.
void TestSplitSave(std::filesystem::path const& dir){
    delo::Store store(dir/L"split.json");delo::JsonObject state;state.Insert(L"v",delo::JsonValue::CreateNumberValue(1));
    auto bytes=store.Prepare(state,0);
    Require(store.Revision()==0&&!store.State()&&!std::filesystem::exists(store.Path()),"prepare changes nothing");
    delo::AtomicWrite(store.Path(),bytes);Require(store.Commit(state)==1&&store.State().GetNamedNumber(L"v")==1,"commit after the write adopts the state");
    delo::Store reread(dir/L"split.json");reread.Load();Require(reread.Revision()==1,"prepared bytes carry the next revision");
    bool conflict=false;try{store.Prepare(state,0);}catch(std::exception const& e){conflict=std::string(e.what())=="conflict";}
    Require(conflict,"prepare refuses a stale revision");
    // Restoration is split the same way: preparing it changes nothing.
    delo::AtomicWrite(store.BackupPath(),bytes,false);auto current=delo::ReadBytes(store.Path());
    auto restored=store.PrepareRestore(delo::ReadBytes(store.BackupPath()));
    Require(restored.revision==2&&store.Revision()==1&&delo::ReadBytes(store.Path())==current,"prepare restore changes nothing");
    delo::Store::PreserveDamaged(store.Path());delo::AtomicWrite(store.Path(),restored.bytes,false);store.CommitRestore(restored);
    delo::Store reloaded(store.Path());reloaded.Load();Require(store.Revision()==2&&reloaded.Revision()==2,"committed restore matches the file");
}
// Writes run in the order they were posted, off the calling thread, and Close lets queued work
// finish before returning.
void TestWorker(){
    std::vector<int> order;std::mutex guard;std::atomic<DWORD> thread{0};
    {delo::Worker worker;for(int i=0;i<20;++i)worker.Post([&,i]{if(i==0){Sleep(50);thread=GetCurrentThreadId();}std::lock_guard lock(guard);order.push_back(i);});
     Require(worker.Close(std::chrono::seconds(5)),"close waits for queued writes");}
    bool ordered=order.size()==20;for(int i=0;ordered&&i<20;++i)ordered=order[i]==i;
    Require(ordered,"writes keep their order");Require(thread!=0&&thread!=GetCurrentThreadId(),"writes run off the calling thread");
    // A write that outlives Close finishes on its own after the Worker is gone; its thread must
    // not reach into the destroyed Worker (it used to).
    auto finished=std::make_shared<std::atomic<bool>>(false);
    {delo::Worker slow;slow.Post([finished]{Sleep(300);*finished=true;});Require(!slow.Close(std::chrono::milliseconds(50)),"close reports a write still running");}
    Sleep(700);Require(*finished,"a write left running finishes after its worker is destroyed");
}
// The diagnostic log keeps two files at most.
void TestTraceRotation(std::filesystem::path const& dir){
    auto path=dir/L"native.jsonl";{delo::TraceLog log;log.Open(path,100);for(int i=0;i<30;++i)log.Write("{\"event\":\"line-"+std::to_string(i)+"\"}");}
    auto previous=dir/L"native.1.jsonl";
    Require(std::filesystem::exists(previous)&&std::filesystem::file_size(path)<=100+32&&std::filesystem::file_size(previous)<=100+32,"log rotates at the limit");
    std::size_t files=0;for(auto const& entry:std::filesystem::directory_iterator(dir))if(entry.path().filename().wstring().rfind(L"native",0)==0)++files;
    Require(files==2,"only one previous log is kept");
    auto last=delo::ReadBytes(path);Require(last.find("line-29")!=std::string::npos,"newest line is in the current log");
    {delo::TraceLog log;log.Open(path,100);log.Write("{\"event\":\"reopened\"}");}
    Require(delo::ReadBytes(path).find("reopened")!=std::string::npos,"reopening continues within the limit");
}
int wmain(int argc,wchar_t** argv){try{winrt::init_apartment();if(argc!=2)throw std::runtime_error("Test output directory required");auto path=std::filesystem::path(argv[1])/std::to_wstring(GetCurrentProcessId())/L"tasks.json";TestRollback(path.parent_path());TestTransientLock(path.parent_path());TestSplitSave(path.parent_path());TestWorker();{auto logs=path.parent_path()/L"logs";std::filesystem::create_directories(logs);TestTraceRotation(logs);}delo::Store store(path);store.Load();Require(!store.State()&&store.Revision()==0,"empty store");delo::JsonObject a;a.Insert(L"title",delo::JsonValue::CreateStringValue(L"Тест / Тест / Test"));Require(store.Save(a,0)==1,"first acknowledged write");delo::Store reread(path);reread.Load();Require(reread.State().GetNamedString(L"title")==L"Тест / Тест / Test","unicode survives reload");bool conflict=false;try{store.Save(a,0);}catch(std::exception const& e){conflict=std::string(e.what())=="conflict";}Require(conflict&&store.Revision()==1,"stale revision rejected");delo::JsonObject b;b.Insert(L"title",delo::JsonValue::CreateStringValue(L"second"));store.Save(b,1);auto backup=path;backup+=L".bak";Require(std::filesystem::exists(backup),"backup retained");delo::AtomicWrite(path,"{broken",false);delo::Store damaged(path);bool failed=false;try{damaged.Load();}catch(...){failed=true;}Require(failed&&damaged.Blocked(),"corruption blocks writes");failed=false;try{damaged.Save(a,0);}catch(...){failed=true;}Require(failed&&delo::ReadBytes(path)=="{broken","damaged data not overwritten");damaged.RestoreBackup();Require(damaged.State().GetNamedString(L"title")==L"Тест / Тест / Test","explicit backup recovery");bool preserved=false;for(auto const& entry:std::filesystem::directory_iterator(path.parent_path()))if(entry.path().filename().wstring().find(L".damaged-")!=std::wstring::npos)preserved=true;Require(preserved,"damaged original retained");return 0;}catch(std::exception const& e){std::cerr<<e.what()<<'\n';return 1;}catch(winrt::hresult_error const& e){std::cerr<<winrt::to_string(e.message())<<'\n';return 1;}}
