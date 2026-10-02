#include "../native/CaptureSuspension.h"
#include <iostream>
#include <stdexcept>

using State=delo::CaptureSuspension;
using Cause=State::Cause;
using Transition=State::Transition;
unsigned checks{};
void Require(bool ok,char const* name){if(!ok)throw std::runtime_error(name);++checks;std::cout<<"PASS "<<name<<'\n';}

void TestLockThenSleep(){
    State state;
    Require(!state.PowerBlocked()&&!state.RendererBlocked(),"initial state allows capture");
    Require(state.Update(Cause::Session,true)==Transition::Suspend&&state.RendererBlocked(),"locking suspends the interface and renderer");
    Require(state.Update(Cause::System,true)==Transition::None&&state.RendererBlocked(),"sleep while locked does not send another interface suspend");
    Require(state.Update(Cause::System,false)==Transition::None&&state.PowerBlocked()&&state.RendererBlocked(),"automatic system resume keeps the locked renderer and interface suspended");
    Require(state.Update(Cause::Session,false)==Transition::Resume&&!state.RendererBlocked(),"unlock after system resume releases the final blocker");
}
void TestUnlockBeforeSystemResume(){
    State state;
    Require(state.Update(Cause::System,true)==Transition::Suspend,"system sleep suspends from an unlocked session");
    Require(state.Update(Cause::Session,true)==Transition::None,"lock during sleep keeps the effective suspend");
    Require(state.Update(Cause::Session,false)==Transition::None&&state.RendererBlocked(),"unlock before system resume does not restart capture");
    Require(state.Update(Cause::System,false)==Transition::Resume&&!state.PowerBlocked()&&!state.RendererBlocked(),"system resume after unlock releases the final blocker");
}
void TestDuplicateAndIndependentEvents(){
    State state;
    Require(state.Update(Cause::System,false)==Transition::None&&state.Update(Cause::Session,false)==Transition::None,"unmatched resume and unlock leave an active session unchanged");
    Require(state.Update(Cause::Session,true)==Transition::Suspend,"session lock alone suspends");
    Require(state.Update(Cause::Session,true)==Transition::None&&state.Update(Cause::System,false)==Transition::None&&state.RendererBlocked(),"duplicate lock and unrelated system resume cannot clear the session blocker");
    Require(state.Update(Cause::Session,false)==Transition::Resume,"session unlock alone resumes");
    Require(state.Update(Cause::Session,false)==Transition::None,"duplicate unlock does not send another resume");
    Require(state.Update(Cause::System,true)==Transition::Suspend&&state.Update(Cause::System,true)==Transition::None,"duplicate system suspend has one effective transition");
    Require(state.Update(Cause::System,false)==Transition::Resume&&state.Update(Cause::System,false)==Transition::None,"duplicate system resume has one effective transition");
}
void TestIndependentDemoBlocker(){
    State state;
    state.SetDemo(true);
    Require(!state.PowerBlocked()&&state.RendererBlocked(),"demo suspends only the renderer");
    Require(state.Update(Cause::System,false)==Transition::None&&state.RendererBlocked(),"unmatched system resume cannot clear demo suspension");
    Require(state.Update(Cause::Session,true)==Transition::Suspend,"session lock still suspends the interface during demo");
    Require(state.Update(Cause::Session,false)==Transition::Resume&&state.RendererBlocked(),"session unlock resumes the interface but retains demo material suspension");
    state.Update(Cause::System,true);
    state.SetDemo(false);
    Require(state.PowerBlocked()&&state.RendererBlocked(),"leaving demo does not clear system suspension");
    Require(state.Update(Cause::System,false)==Transition::Resume&&!state.RendererBlocked(),"system resume after leaving demo permits capture");
    state.Update(Cause::Session,true);
    state.SetDemo(true);
    state.SetDemo(false);
    Require(state.PowerBlocked()&&state.RendererBlocked(),"rolling back demo activation retains the session blocker");
    Require(state.Update(Cause::Session,false)==Transition::Resume&&!state.RendererBlocked(),"unlock after demo rollback permits capture");
}
int main(){try{
    TestLockThenSleep();TestUnlockBeforeSystemResume();TestDuplicateAndIndependentEvents();TestIndependentDemoBlocker();
    std::cout<<"PASS "<<checks<<" capture suspension checks\n";return 0;
}catch(std::exception const& error){std::cerr<<error.what()<<'\n';return 1;}}
