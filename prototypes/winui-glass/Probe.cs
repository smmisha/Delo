using System.Runtime.InteropServices;
using System.Text.Json;
using LiquidGlassWinUI;
using Microsoft.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Graphics;
using Color = Windows.UI.Color;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(parameters =>
        {
            SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
            _ = new ProbeApp();
        });
    }
}

internal sealed class ClearBackdrop : SystemBackdrop
{
    readonly Windows.UI.Composition.Compositor compositor = new();
    protected override void OnTargetConnected(ICompositionSupportsSystemBackdrop target, XamlRoot root)
    {
        target.SystemBackdrop = compositor.CreateColorBrush(Colors.Transparent);
    }
    protected override void OnTargetDisconnected(ICompositionSupportsSystemBackdrop target) => target.SystemBackdrop = null;
}

internal sealed class ProbeApp : Application
{
    readonly string output = System.IO.Path.Combine(AppContext.BaseDirectory, "artifacts", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff"));
    StreamWriter? log;
    Window? window;
    nint hwnd, pattern, previous;
    nint osQueue;
    Canvas scene = new();
    Canvas inside = new();
    Border glass = new() { Width = 320, Height = 240 };
    int failures;
    bool dark, shifted;
    readonly bool standardHost = Environment.GetCommandLineArgs().Contains("--standard-host");
    readonly bool directGlass = Environment.GetCommandLineArgs().Contains("--direct-glass");
    int frames;
    readonly Native.WndProc callback;
    public ProbeApp() { callback = PatternProc; UnhandledException += (_, e) => { Record("unhandled", false, e.Exception.ToString()); e.Handled = true; Finish(); }; }

    void Record(string check, bool passed, string detail = "")
    {
        log?.WriteLine(JsonSerializer.Serialize(new { check, passed, detail })); log?.Flush();
        if (!passed) failures++;
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        Directory.CreateDirectory(output); log = new StreamWriter(System.IO.Path.Combine(output, "winui-glass.jsonl"), false);
        previous = Native.GetForegroundWindow();
        try
        {
            if (Windows.System.DispatcherQueue.GetForCurrentThread() is null)
                Marshal.ThrowExceptionForHR(Native.CreateDispatcherQueueController(new Native.QueueOptions { Size = 12, ThreadType = 2, ApartmentType = 2 }, out osQueue));
            window = new Window { Title = "Delo WinUI HLSL probe" };
            if (!standardHost) window.SystemBackdrop = new ClearBackdrop();
            hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);
            window.Content = scene;
            Microsoft.UI.Xaml.Media.CompositionTarget.Rendering += (_, _) => frames++;
            if (window.AppWindow.Presenter is OverlappedPresenter presenter)
            {
                presenter.IsResizable = false;
                presenter.SetBorderAndTitleBar(false, false);
                presenter.IsAlwaysOnTop = true;
            }
            scene.Children.Add(inside); scene.Children.Add(glass);
            window.AppWindow.ResizeClient(new SizeInt32(400, 300));
            Native.SetWindowPos(hwnd, new nint(-1), 120, 160, 400, 300, 0x0010);
            int enabled = 1; var margins = new Native.Margins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
            int host = standardHost ? 0 : Native.DwmSetWindowAttribute(hwnd, 17, ref enabled, 4);
            int frame = standardHost ? 0 : Native.DwmExtendFrameIntoClientArea(hwnd, ref margins);
            Record("window_setup", host == 0 && frame == 0, $"host={host},frame={frame}");
            var wc = new Native.WindowClass { Proc = callback, Instance = Native.GetModuleHandle(null), Name = "Delo.WinUIProbe.Pattern" };
            if (Native.RegisterClass(ref wc) == 0) throw new System.ComponentModel.Win32Exception();
            pattern = Native.CreateWindowEx(0x80, wc.Name, "Delo controlled external grid", 0x80000000, 100, 140, 440, 340, 0, 0, wc.Instance, 0);
            if (pattern == 0) throw new System.ComponentModel.Win32Exception();
            Native.ShowWindow(pattern, 4); Native.ShowWindow(pattern, 4); Native.SetWindowPos(pattern, hwnd, 100, 140, 440, 340, 0x0010);
            window.Activate(); Native.ShowWindow(hwnd, 5); Native.SetWindowPos(hwnd, new nint(-1), 120, 160, 400, 300, 0x0010);
            Record("visible_windows", Native.IsWindowVisible(hwnd) && Native.IsWindowVisible(pattern));
            await Task.Delay(600);
            Record("layout", true, $"scene={scene.ActualWidth}x{scene.ActualHeight}; glass={glass.ActualWidth}x{glass.ActualHeight}; scale={scene.XamlRoot.RasterizationScale}; thread={Environment.CurrentManagedThreadId}");
            glass.Background = new SolidColorBrush(Colors.Red); await Task.Delay(400); var red = Capture("control_red");
            glass.Background = new SolidColorBrush(Colors.Lime); await Task.Delay(400); var green = Capture("control_green");
            bool colorsValid = (red[red.Length / 2 + 120] & 0xffffff) == 0xff0000 && (green[green.Length / 2 + 120] & 0xffffff) == 0x00ff00;
            Record("xaml_color_control", colorsValid);
            if (!colorsValid) throw new InvalidOperationException("Screen capture did not reproduce the XAML color control.");
            uint dpi = Native.GetDpiForWindow(hwnd);
            Record("window_dpi", Math.Abs(scene.XamlRoot.RasterizationScale * 96 - dpi) < 1, $"dpi={dpi}");
            dark = Environment.GetCommandLineArgs().Contains("--dark");
            Record("configuration", true, $"standardHost={standardHost}; directGlass={directGlass}; dark={dark}; external={Environment.GetCommandLineArgs().Contains("--external")}; package=1.0.3");
            await RunOptics(!Environment.GetCommandLineArgs().Contains("--external"));
            Record("native_runtime_loaded", System.Diagnostics.Process.GetCurrentProcess().Modules.Cast<System.Diagnostics.ProcessModule>().Any(m => m.ModuleName == "CustomEffectRuntimeNative.dll"));
            var modules = System.Diagnostics.Process.GetCurrentProcess().Modules.Cast<System.Diagnostics.ProcessModule>()
                .Where(m => m.ModuleName is "wuceffectsi.dll" or "dwmcorei.dll" or "Microsoft.UI.Xaml.dll" or "CustomEffectRuntimeNative.dll")
                .Select(m => new { m.ModuleName, version = m.FileVersionInfo.FileVersion });
            File.WriteAllText(System.IO.Path.Combine(output, "modules.json"), JsonSerializer.Serialize(modules, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception e) { Record("exception", false, e.ToString()); }
        finally { Finish(); }
    }

    LiquidGlassBrush Lens(bool refract) => new()
    {
        BlurAmount = 0, BloomAmount = 0, Brightness = 0, Contrast = 1, Saturation = 1,
        Temperature = 0, Exposure = 1, Vibrance = 0, TintA = 0, TintR = 255, TintG = 255, TintB = 255,
        RefThickness = 28, RefFactor = refract ? 2.2 : 1, RefDispersion = 0,
        RefFresnelFactor = 0, GlareFactor = 0, GlareOppositeFactor = 0, Magnification = 1,
        ShapeRadius = 0.3, ShapeRoundness = 2
    };

    async Task SetLens(bool refract)
    {
        var brush = Lens(refract); glass.Background = brush;
        await Task.Delay(100);
        if (directGlass)
        {
            const System.Reflection.BindingFlags flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            var effect = (CompositionEffectBrush?)typeof(LiquidGlassBrush).GetField("_glassBrush", flags)?.GetValue(brush);
            var source = (CompositionBackdropBrush?)typeof(LiquidGlassBrush).GetField("_backdropBrush", flags)?.GetValue(brush);
            if (effect is null || source is null) throw new InvalidOperationException("Direct shader diagnostic could not access connected brushes.");
            effect.SetSourceParameter("Backdrop", source);
        }
        await Task.Delay(600);
    }

    void InternalGrid()
    {
        inside.Children.Clear(); inside.Width = 320; inside.Height = 240;
        inside.Background = new SolidColorBrush(dark ? Color.FromArgb(255,35,47,62) : Color.FromArgb(255,205,227,239));
        var ink = new SolidColorBrush(dark ? Color.FromArgb(255,153,192,210) : Color.FromArgb(255,35,75,105));
        int shift = shifted ? 7 : 0;
        for (int p = shift; p < 320; p += 20) { var line = new Rectangle { Width = 2, Height = 240, Fill = ink }; Canvas.SetLeft(line, p); inside.Children.Add(line); }
        for (int p = shift; p < 240; p += 20) { var line = new Rectangle { Width = 320, Height = 2, Fill = ink }; Canvas.SetTop(line, p); inside.Children.Add(line); }
    }

    async Task RunOptics(bool internalSource)
    {
        string name = (internalSource ? "internal" : "external") + (dark ? "_dark" : "_light");
        shifted = false; InternalGrid(); inside.Visibility = internalSource ? Visibility.Visible : Visibility.Collapsed;
        Native.InvalidateRect(pattern, 0, false); Native.UpdateWindow(pattern);
        glass.Background = null; await Task.Delay(200); var uncovered = Capture(name + "_uncovered");
        shifted = true; InternalGrid(); Native.InvalidateRect(pattern, 0, false); Native.UpdateWindow(pattern);
        await Task.Delay(300); var sourceMoved = Capture(name + "_uncovered_moved");
        bool sourceValid = Changed(uncovered, sourceMoved, false) > 300;
        Record(name + "_uncovered_live_control", sourceValid);
        if (!sourceValid) return;
        shifted = false; InternalGrid(); Native.InvalidateRect(pattern, 0, false); Native.UpdateWindow(pattern); await Task.Delay(200);
        await SetLens(false);
        Record(name + "_shader_initialization", LiquidGlassBrush.LastError is null, LiquidGlassBrush.LastError ?? "");
        if (LiquidGlassBrush.LastError is not null) { Capture(name + "_failure"); return; }
        var baseline = Capture(name + "_identity");
        await SetLens(true); var refracted = Capture(name + "_lens");
        int edge = Changed(baseline, refracted, true), center = Changed(baseline, refracted, false);
        Record(name + "_edge_refraction", edge > 300, $"changed={edge}");
        Record(name + "_center_preserved", center < 100, $"changed={center}");
        shifted = true; InternalGrid(); Native.InvalidateRect(pattern, 0, false); Native.UpdateWindow(pattern); await Task.Delay(300);
        Record(name + "_render_state", true, $"frames={frames}; thread={Environment.CurrentManagedThreadId}; inside={inside.ActualWidth}x{inside.ActualHeight}; lineX={Canvas.GetLeft(inside.Children[0])}");
        var moved = Capture(name + "_moved");
        int live = Changed(refracted, moved, false);
        Record(name + "_live_source", live > 300, $"changed={live}");
        // A flat/white surface must not pass merely because the rim changes.
        Record(name + "_source_detail", baseline.Distinct().Count() >= 3, $"colors={baseline.Distinct().Count()},uncoveredColors={uncovered.Distinct().Count()}");
    }

    uint[] Capture(string name)
    {
        Native.SetForegroundWindow(hwnd);
        Native.SetWindowPos(hwnd, new nint(-1), 0, 0, 0, 0, 0x0013);
        Native.DwmFlush();
        Native.GetClientRect(hwnd, out var bounds); var point = new Native.Point(); Native.ClientToScreen(hwnd, ref point);
        var middle = new Native.Point { X = point.X + bounds.Right / 2, Y = point.Y + bounds.Bottom / 2 };
        nint hit = Native.WindowFromPoint(middle);
        var hitTitle = new System.Text.StringBuilder(256); Native.GetWindowText(Native.GetAncestor(hit, 2), hitTitle, 256);
        Native.GetWindowThreadProcessId(hit, out uint hitPid);
        if (Native.GetAncestor(hit, 2) != hwnd)
            throw new InvalidOperationException($"Capture is not over the probe HWND: origin={point.X},{point.Y}; size={bounds.Right},{bounds.Bottom}; hit={hit}; own={hwnd}; pattern={pattern}; hitPid={hitPid}; ownPid={Environment.ProcessId}; title={hitTitle}");
        int width = bounds.Right, height = bounds.Bottom;
        nint screen = Native.GetDC(0), memory = Native.CreateCompatibleDC(screen);
        var info = new Native.BitmapInfo { Header = new Native.BitmapHeader { Size = 40, Width = width, Height = -height, Planes = 1, Bits = 32 } };
        nint bitmap = Native.CreateDIBSection(screen, ref info, 0, out nint bytes, 0, 0), old = Native.SelectObject(memory, bitmap);
        try
        {
            if (!Native.BitBlt(memory, 0, 0, width, height, screen, point.X, point.Y, 0x40CC0020)) throw new System.ComponentModel.Win32Exception();
            byte[] data = new byte[width * height * 4]; Marshal.Copy(bytes, data, 0, data.Length);
            using var writer = new BinaryWriter(File.Create(System.IO.Path.Combine(output, name + ".bmp")));
            writer.Write((ushort)0x4D42); writer.Write(54 + data.Length); writer.Write(0); writer.Write(54);
            writer.Write(40); writer.Write(width); writer.Write(-height); writer.Write((ushort)1); writer.Write((ushort)32);
            writer.Write(0); writer.Write(data.Length); writer.Write(0); writer.Write(0); writer.Write(0); writer.Write(0); writer.Write(data);
            uint[] pixels = new uint[width * height]; Buffer.BlockCopy(data, 0, pixels, 0, data.Length); return pixels;
        }
        finally { Native.SelectObject(memory, old); Native.DeleteObject(bitmap); Native.DeleteDC(memory); Native.ReleaseDC(0, screen); }
    }
    int Changed(uint[] a, uint[] b, bool edge)
    {
        Native.GetClientRect(hwnd, out var rect); int changed = 0;
        for (int y = 55; y < rect.Bottom - 55; y++) for (int x = 0; x < rect.Right; x++)
        {
            bool region = edge ? (x >= 6 && x < 32) || (x >= rect.Right - 32 && x < rect.Right - 6) : x >= 90 && x < rect.Right - 90;
            int i = y * rect.Right + x; if (!region || i >= a.Length || i >= b.Length) continue;
            uint first = a[i], second = b[i]; int diff = 0;
            for (int channel = 0; channel < 3; channel++) diff += Math.Abs((int)((first >> (8 * channel)) & 255) - (int)((second >> (8 * channel)) & 255));
            if (diff > 70) changed++;
        }
        return changed;
    }

    nint PatternProc(nint h, uint message, nuint w, nint l)
    {
        if (message == 15)
        {
            nint dc = Native.BeginPaint(h, out var paint); Native.GetClientRect(h, out var rect);
            nint bg = Native.CreateSolidBrush(dark ? 0x3e2f23u : 0xefe3cdu); Native.FillRect(dc, ref rect, bg); Native.DeleteObject(bg);
            nint pen = Native.CreatePen(0, 3, dark ? 0xd2c099u : 0x694b23u), old = Native.SelectObject(dc, pen);
            int shift = shifted ? 9 : 0;
            for (int x = shift; x < rect.Right; x += 25) { Native.MoveToEx(dc, x, 0, 0); Native.LineTo(dc, x, rect.Bottom); }
            for (int y = shift; y < rect.Bottom; y += 25) { Native.MoveToEx(dc, 0, y, 0); Native.LineTo(dc, rect.Right, y); }
            Native.SelectObject(dc, old); Native.DeleteObject(pen); Native.EndPaint(h, ref paint); return 0;
        }
        return Native.DefWindowProc(h, message, w, l);
    }
    void Finish()
    {
        if (log is null) return;
        log.WriteLine(JsonSerializer.Serialize(new { failed_checks = failures })); log.Dispose(); log = null;
        window?.Close(); if (pattern != 0) { Native.DestroyWindow(pattern); pattern = 0; }
        if (Native.IsWindow(previous)) Native.SetForegroundWindow(previous);
        Environment.ExitCode = failures == 0 ? 0 : 1; Exit();
    }
}

internal static class Native
{
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate nint WndProc(nint hwnd, uint msg, nuint w, nint l);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct WindowClass { public uint Style; public WndProc Proc; public int ClassExtra, WindowExtra; public nint Instance, Icon, Cursor, Background; public string? Menu; public string Name; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Margins { public int Left, Right, Top, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct QueueOptions { public int Size, ThreadType, ApartmentType; }
    [StructLayout(LayoutKind.Sequential)] public struct Paint { public nint DC; public int Erase; public Rect Rect; public int Restore, Incremental; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Reserved; }
    [StructLayout(LayoutKind.Sequential)] public struct BitmapHeader { public uint Size; public int Width, Height; public ushort Planes, Bits; public uint Compression, ImageSize; public int Xppm, Yppm; public uint Used, Important; }
    [StructLayout(LayoutKind.Sequential)] public struct BitmapInfo { public BitmapHeader Header; public uint Color; }
    [DllImport("kernel32", CharSet = CharSet.Unicode)] public static extern nint GetModuleHandle(string? name);
    [DllImport("CoreMessaging.dll")] public static extern int CreateDispatcherQueueController(QueueOptions options, out nint controller);
    [DllImport("user32", CharSet = CharSet.Unicode, SetLastError = true)] public static extern ushort RegisterClass(ref WindowClass wc);
    [DllImport("user32", CharSet = CharSet.Unicode, SetLastError = true)] public static extern nint CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int w, int h, nint parent, nint menu, nint instance, nint data);
    [DllImport("user32", CharSet = CharSet.Unicode)] public static extern nint DefWindowProc(nint h, uint msg, nuint w, nint l);
    [DllImport("user32")] public static extern bool ShowWindow(nint h, int command);
    [DllImport("user32")] public static extern bool DestroyWindow(nint h);
    [DllImport("user32")] public static extern bool SetWindowPos(nint h, nint after, int x, int y, int w, int height, uint flags);
    [DllImport("user32")] public static extern bool GetClientRect(nint h, out Rect rect);
    [DllImport("user32")] public static extern bool ClientToScreen(nint h, ref Point point);
    [DllImport("user32")] public static extern nint GetForegroundWindow();
    [DllImport("user32")] public static extern bool SetForegroundWindow(nint h);
    [DllImport("user32")] public static extern bool IsWindow(nint h);
    [DllImport("user32")] public static extern bool IsWindowVisible(nint h);
    [DllImport("user32")] public static extern nint WindowFromPoint(Point point);
    [DllImport("user32")] public static extern nint GetAncestor(nint h, uint flags);
    [DllImport("user32")] public static extern uint GetDpiForWindow(nint h);
    [DllImport("user32")] public static extern uint GetWindowThreadProcessId(nint h, out uint pid);
    [DllImport("user32", CharSet = CharSet.Unicode)] public static extern int GetWindowText(nint h, System.Text.StringBuilder text, int count);
    [DllImport("user32")] public static extern nint BeginPaint(nint h, out Paint paint);
    [DllImport("user32")] public static extern bool EndPaint(nint h, ref Paint paint);
    [DllImport("user32")] public static extern bool InvalidateRect(nint h, nint rect, bool erase);
    [DllImport("user32")] public static extern bool UpdateWindow(nint h);
    [DllImport("user32")] public static extern int FillRect(nint dc, ref Rect rect, nint brush);
    [DllImport("user32")] public static extern nint GetDC(nint h);
    [DllImport("user32")] public static extern int ReleaseDC(nint h, nint dc);
    [DllImport("gdi32")] public static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32")] public static extern nint CreateDIBSection(nint dc, ref BitmapInfo info, uint usage, out nint bits, nint section, uint offset);
    [DllImport("gdi32")] public static extern nint SelectObject(nint dc, nint obj);
    [DllImport("gdi32")] public static extern bool DeleteObject(nint obj);
    [DllImport("gdi32")] public static extern bool DeleteDC(nint dc);
    [DllImport("gdi32")] public static extern bool BitBlt(nint dest, int x, int y, int width, int height, nint src, int sx, int sy, uint op);
    [DllImport("gdi32")] public static extern nint CreateSolidBrush(uint color);
    [DllImport("gdi32")] public static extern nint CreatePen(int style, int width, uint color);
    [DllImport("gdi32")] public static extern bool MoveToEx(nint dc, int x, int y, nint old);
    [DllImport("gdi32")] public static extern bool LineTo(nint dc, int x, int y);
    [DllImport("dwmapi")] public static extern int DwmSetWindowAttribute(nint h, int attribute, ref int value, int size);
    [DllImport("dwmapi")] public static extern int DwmExtendFrameIntoClientArea(nint h, ref Margins margins);
    [DllImport("dwmapi")] public static extern int DwmFlush();
}
