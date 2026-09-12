#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <filesystem>
#include <memory>
#include <string>
#include <cstdint>

namespace delo {
inline constexpr UINT GlassFrameReadyMessage=WM_APP+42;
class GlassRenderer {
public:
    struct Counters {
        std::uint64_t copied{}, rendered{}, recoveries{}, errors{};
        LONG cropX{},cropY{};
        UINT width{},height{};
        double lastSubmitMs{},lastRenderWorkMs{};
    };
    GlassRenderer(HWND host, std::filesystem::path shaderPath);
    ~GlassRenderer();
    GlassRenderer(GlassRenderer const&) = delete;
    GlassRenderer& operator=(GlassRenderer const&) = delete;
    void Tick();
    // Geometry changed: resize the textures and redraw in the same UI turn.
    void Resize();
    // Tears the renderer down so the capture session and GPU resources are rebuilt.
    void Rebuild();
    // Keeps the held frame covering the window while capture is paused.
    void Stretch();
    void SetDark(bool dark);
    // Holds the last presented frame for the duration of a move/resize gesture.
    // Unlike Suspend this keeps the GPU resources and the capture session alive,
    // so releasing the window resumes live refraction without a rebuild.
    void Freeze(bool frozen);
    // Stops monitor capture while retaining the material and Composition resources.
    // Restore display exclusion on every widget before resuming any renderer.
    void PauseCapture(bool paused);
    void Suspend(bool suspended);
    // Writes the composed material to a PNG straight off the GPU. The window excludes
    // itself from screen capture — otherwise the glass would sample its own output — so
    // normal live screen grabs omit it; this reads the source of truth instead.
    void SaveMaterial(std::filesystem::path const& destination);
    bool Healthy() const;
    std::string LastError() const;
    Counters GetCounters() const;
    HANDLE EventHandle() const;
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
}
