#pragma once

namespace delo {
// Power and session notifications can overlap and resume in either order. Demo
// mode blocks only the material; it must not pause or resume the task interface.
class CaptureSuspension {
public:
    enum class Cause { System, Session };
    enum class Transition { None, Suspend, Resume };

    Transition Update(Cause cause,bool suspended) noexcept {
        const bool before=PowerBlocked();
        (cause==Cause::System?systemSuspended_:sessionLocked_)=suspended;
        const bool after=PowerBlocked();
        if(before==after)return Transition::None;
        return after?Transition::Suspend:Transition::Resume;
    }
    void SetDemo(bool enabled) noexcept {demo_=enabled;}
    bool PowerBlocked() const noexcept {return systemSuspended_||sessionLocked_;}
    bool RendererBlocked() const noexcept {return PowerBlocked()||demo_;}
private:
    bool systemSuspended_{},sessionLocked_{},demo_{};
};
} // namespace delo
