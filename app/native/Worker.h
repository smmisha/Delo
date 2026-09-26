#pragma once
#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>

namespace delo {
// Runs file writes one at a time, in order, on a background thread, so a slow disk never holds
// up the window thread. Jobs must not touch windows or WinRT objects; they report back by
// posting a message to the window thread.
class Worker {
    std::mutex mutex_;std::condition_variable wake_,idle_;std::deque<std::function<void()>> jobs_;
    bool stop_{},running_{};std::thread thread_;
    void Loop(){
        for(;;){
            std::function<void()> job;
            {std::unique_lock lock(mutex_);wake_.wait(lock,[this]{return stop_||!jobs_.empty();});if(jobs_.empty())return;job=std::move(jobs_.front());jobs_.pop_front();running_=true;}
            try{job();}catch(...){}
            {std::lock_guard lock(mutex_);running_=false;}
            idle_.notify_all();
        }
    }
public:
    Worker():thread_([this]{Loop();}){}
    Worker(Worker const&)=delete;Worker& operator=(Worker const&)=delete;
    ~Worker(){Close(std::chrono::seconds(10));}
    void Post(std::function<void()> job){{std::lock_guard lock(mutex_);jobs_.push_back(std::move(job));}wake_.notify_one();}
    // Lets queued writes finish, for at most `limit`, then stops. A write still running when time
    // is up is left to finish on its own; false says so.
    bool Close(std::chrono::milliseconds limit){
        if(!thread_.joinable())return true;
        std::unique_lock lock(mutex_);
        const bool done=idle_.wait_for(lock,limit,[this]{return jobs_.empty()&&!running_;});
        stop_=true;lock.unlock();wake_.notify_one();
        if(done)thread_.join();else thread_.detach();
        return done;
    }
};
}
