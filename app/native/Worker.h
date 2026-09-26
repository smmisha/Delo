#pragma once
#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>

namespace delo {
// Runs file writes one at a time, in order, on a background thread, so a slow disk never holds
// up the window thread. Jobs must not touch windows or WinRT objects; they report back by
// posting a message to the window thread.
class Worker {
    // The thread owns a share of this state. When Close gives up on a write that is still running
    // and detaches, the thread keeps using its own share, never a destroyed Worker.
    struct State{std::mutex mutex;std::condition_variable wake,idle;std::deque<std::function<void()>> jobs;bool stop{},running{};};
    std::shared_ptr<State> state_=std::make_shared<State>();std::thread thread_;
    static void Loop(std::shared_ptr<State> const state){
        for(;;){
            std::function<void()> job;
            {std::unique_lock lock(state->mutex);state->wake.wait(lock,[&]{return state->stop||!state->jobs.empty();});if(state->jobs.empty())return;job=std::move(state->jobs.front());state->jobs.pop_front();state->running=true;}
            try{job();}catch(...){}
            {std::lock_guard lock(state->mutex);state->running=false;}
            state->idle.notify_all();
        }
    }
public:
    Worker():thread_(Loop,state_){}
    Worker(Worker const&)=delete;Worker& operator=(Worker const&)=delete;
    ~Worker(){Close(std::chrono::seconds(10));}
    void Post(std::function<void()> job){{std::lock_guard lock(state_->mutex);state_->jobs.push_back(std::move(job));}state_->wake.notify_one();}
    // Lets queued writes finish, for at most `limit`, then stops. A write still running when time
    // is up is left to finish on its own; false says so.
    bool Close(std::chrono::milliseconds limit){
        if(!thread_.joinable())return true;
        std::unique_lock lock(state_->mutex);
        const bool done=state_->idle.wait_for(lock,limit,[this]{return state_->jobs.empty()&&!state_->running;});
        state_->stop=true;lock.unlock();state_->wake.notify_one();
        if(done)thread_.join();else thread_.detach();
        return done;
    }
};
}
