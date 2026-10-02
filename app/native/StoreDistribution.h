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
#include <string>
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
// What Windows already knows about the answer, without showing the prompt: 1 allowed, 2 refused,
// 0 not asked yet or not known. `detail` names the raw status for the log. If this capability name is
// not accepted here, the answer stays 0 and the first-run explanation is shown, which does no harm.
inline int BorderlessAnswer(std::wstring& detail) {
    try {
        using namespace winrt::Windows::Security::Authorization::AppCapabilityAccess;
        switch (AppCapability::Create(L"graphicsCaptureWithoutBorder").CheckAccess()) {
            case AppCapabilityAccessStatus::Allowed: detail = L"allowed"; return 1;
            case AppCapabilityAccessStatus::DeniedByUser: detail = L"denied_by_user"; return 2;
            case AppCapabilityAccessStatus::DeniedBySystem: detail = L"denied_by_system"; return 2;
            case AppCapabilityAccessStatus::UserPromptRequired: detail = L"prompt_required"; return 0;
            case AppCapabilityAccessStatus::NotDeclaredByApp: detail = L"not_declared"; return 0;
            default: detail = L"unknown"; return 0;
        }
    } catch (...) { detail = L"unavailable"; return 0; }
}
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
