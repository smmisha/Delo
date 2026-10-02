#pragma once
#include <appmodel.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>
#include <atomic>
#include <future>
#include <stdexcept>
#include <thread>

namespace delo {
inline bool HasPackageIdentity() {
    UINT32 length{};
    return GetCurrentPackageFullName(&length, nullptr) == ERROR_INSUFFICIENT_BUFFER;
}
// Capture without the yellow border. A packaged app may drop the border only after the manifest
// declares graphicsCaptureWithoutBorder and the user agrees once to Windows' prompt; Windows remembers
// the answer, so later starts return at once. An unpackaged build needs neither. 0: not asked or not
// applicable, 1: granted, 2: refused or not available (Windows 10 has no such API: the border stays).
inline std::atomic<int> borderlessAccess{0};
inline bool BorderlessGranted() { return borderlessAccess.load() == 1; }
// The request can wait for the user, so it runs on its own thread and never blocks the host.
inline void RequestBorderlessCapture() {
    if (!HasPackageIdentity()) return;
    std::thread([] {
        try {
            winrt::init_apartment(winrt::apartment_type::multi_threaded);
            using namespace winrt::Windows::Graphics::Capture;
            auto status = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).get();
            borderlessAccess = status == winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus::Allowed ? 1 : 2;
        } catch (...) { borderlessAccess = 2; }
    }).detach();
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
