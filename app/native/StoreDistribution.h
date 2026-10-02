#pragma once
#include <appmodel.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Storage.h>
#include <future>
#include <stdexcept>

namespace delo {
inline bool HasPackageIdentity() {
    UINT32 length{};
    return GetCurrentPackageFullName(&length, nullptr) == ERROR_INSUFFICIENT_BUFFER;
}
struct StartupStatus { bool enabled{}, blocked{}; };
// StartupTask is asynchronous. Keep its blocking .get() calls off the host's STA.
inline StartupStatus PackageStartup(bool change = false, bool enabled = false) {
    return std::async(std::launch::async, [=] {
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        struct Apartment { ~Apartment() { winrt::uninit_apartment(); } } apartment;
        using namespace winrt::Windows::ApplicationModel;
        auto task = StartupTask::GetAsync(L"DeloStartup").get();
        auto state = task.State();
        // Other preferences also pass through this action. Leave an already matching
        // startup state alone, especially when Windows policy owns that state.
        if (change && enabled != (state == StartupTaskState::Enabled || state == StartupTaskState::EnabledByPolicy)) {
            if (enabled) {
                state = task.RequestEnableAsync().get();
                if (state != StartupTaskState::Enabled && state != StartupTaskState::EnabledByPolicy)
                    throw std::runtime_error("startupBlocked");
            } else {
                if (state == StartupTaskState::EnabledByPolicy)
                    throw std::runtime_error("startupBlocked");
                task.Disable();
                state = task.State();
            }
        }
        return StartupStatus{state == StartupTaskState::Enabled || state == StartupTaskState::EnabledByPolicy,
            state == StartupTaskState::DisabledByUser || state == StartupTaskState::DisabledByPolicy ||
            state == StartupTaskState::EnabledByPolicy};
    }).get();
}
}
