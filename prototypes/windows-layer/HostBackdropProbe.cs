// Official Windows.UI.Composition host backdrop capability probe.
using System;
using System.Drawing;
using System.IO;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Windows.UI.Composition;
using Windows.UI.Composition.Desktop;
using Windows.Graphics.Effects;

[ComImport, Guid("29E691FA-4567-4DCA-B319-D0F207EB6807"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ICompositorDesktopInterop
{
    void CreateDesktopWindowTarget(IntPtr hwnd,[MarshalAs(UnmanagedType.Bool)]bool topmost,out IntPtr target);
    void EnsureOnThread(uint threadId);
}
static class HostNative
{
    [DllImport("BackdropEffect.dll")] internal static extern int CreateOpacityEffect(out IntPtr effect);
    [StructLayout(LayoutKind.Sequential)] internal struct QueueOptions {public int size,thread,apartment;}
    [StructLayout(LayoutKind.Sequential)] internal struct Margins {public int left,right,top,bottom;}
    [DllImport("CoreMessaging.dll")] internal static extern int CreateDispatcherQueueController(QueueOptions options,out IntPtr controller);
    [DllImport("dwmapi.dll")] internal static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
    [DllImport("dwmapi.dll")] internal static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd,ref Margins margins);
}
sealed class PatternWindow : Form
{
    internal bool Alternate;
    internal PatternWindow(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;DoubleBuffered=true;}
    protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);
        using(var a=new SolidBrush(Alternate?Color.OrangeRed:Color.Cyan))
        using(var b=new SolidBrush(Alternate?Color.MidnightBlue:Color.White))
            for(int y=0;y<Height;y+=24)for(int x=0;x<Width;x+=24)e.Graphics.FillRectangle(((x/24+y/24)%2==0)?a:b,x,y,24,24);
    }
}
sealed class HostWindow : Form
{
    protected override CreateParams CreateParams {get{var value=base.CreateParams;value.ExStyle|=0x00200000;return value;}}
    Compositor compositor; DesktopWindowTarget target; SpriteVisual root;
    CompositionBackdropBrush brush; PatternWindow pattern;
    CompositionEffectFactory factory; CompositionEffectBrush effectBrush;
    readonly IntPtr previous=Native.GetForegroundWindow();
    readonly string output=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"host-backdrop.json");
    readonly System.Collections.Generic.List<object> events=new System.Collections.Generic.List<object>();
    bool toggled;
    internal HostWindow(){
        Text="Delo native host backdrop probe";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;BackColor=Color.Black;
        StartPosition=FormStartPosition.Manual;var area=Screen.PrimaryScreen.WorkingArea;Bounds=new Rectangle(area.Right-450,120,320,240);
        Shown+=async delegate {try{await Task.Delay(150);await Run();}catch(Exception e){Record("exception",e.ToString());Environment.ExitCode=1;}finally{Close();}};
    }
    void Record(string name,object value){events.Add(new{name=name,value=value});File.WriteAllText(output,new JavaScriptSerializer().Serialize(events));}
    uint Pixel(){var p=PointToScreen(new System.Drawing.Point(150,100));IntPtr dc=Native.GetDC(IntPtr.Zero);try{return Native.GetPixel(dc,p.X,p.Y);}finally{Native.ReleaseDC(IntPtr.Zero,dc);}}
    void Image(string name){using(var b=new Bitmap(Width,Height)){using(var g=Graphics.FromImage(b))g.CopyFromScreen(Left,Top,0,0,b.Size);b.Save(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,name+".png"));}}
    async Task Run(){
        using(var settings=Microsoft.Win32.Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"))Record("transparency_preference",settings==null?null:settings.GetValue("EnableTransparency"));
        pattern=new PatternWindow{Bounds=new Rectangle(Left-32,Top-32,Width+64,Height+64)};pattern.Show();
        Native.ShowWindow(Handle,5);Native.SetWindowPos(Handle,new IntPtr(-1),Left,Top,Width,Height,0x60);
        int enabled=1;int hr=HostNative.DwmSetWindowAttribute(Handle,17,ref enabled,4);
        var margins=new HostNative.Margins{left=-1,right=-1,top=-1,bottom=-1};int frame=HostNative.DwmExtendFrameIntoClientArea(Handle,ref margins);
        CreateComposition();
        var controlBrush=compositor.CreateColorBrush(Windows.UI.Colors.Red);root.Brush=controlBrush;target.Root=root;
        await Task.Delay(200);Record("composition_control",new{redPixel=Pixel(),expected=255});
        SetBackdropBrush(true);controlBrush.Dispose();
        int backdrop=3;int backdropHr=HostNative.DwmSetWindowAttribute(Handle,38,ref backdrop,4);
        hr=HostNative.DwmSetWindowAttribute(Handle,17,ref enabled,4);Native.SetForegroundWindow(Handle);
        await Task.Delay(700);uint first=Pixel();Image("host-backdrop-a");
        pattern.Alternate=true;pattern.Invalidate();await Task.Delay(500);uint second=Pixel();Image("host-backdrop-b");
        Record("top_level_host_backdrop",new{enableHresult=hr,frameHresult=frame,backdropHresult=backdropHr,first=first,second=second,respondsToExternalBackground=first!=second});
        if(first==second)Environment.ExitCode=1;
        root.Brush=null;effectBrush.Dispose();factory.Dispose();brush.Dispose();
        SetBackdropBrush(false);pattern.Alternate=false;pattern.Invalidate();await Task.Delay(500);
        uint ordinaryFirst=Pixel();Image("ordinary-backdrop-a");
        pattern.Alternate=true;pattern.Invalidate();await Task.Delay(500);uint ordinarySecond=Pixel();Image("ordinary-backdrop-b");
        Record("top_level_ordinary_backdrop",new{first=ordinaryFirst,second=ordinarySecond,respondsToExternalBackground=ordinaryFirst!=ordinarySecond});
        // Show the controlled pattern on the desktop too, then exercise the same
        // child attachment path as the verified Windows-layer probe.
        DisposeComposition();await Task.Delay(100);
        // A closed Composition target still leaves this HWND unsuitable for
        // reparenting on the tested Windows build. Use a fresh owned HWND.
        RecreateHandle();await Task.Delay(100);
        var host=Native.DesktopHost();Attach(pattern,host);Attach(this,host);
        CreateComposition();SetBackdropBrush(false);target.Root=root;
        hr=HostNative.DwmSetWindowAttribute(Handle,17,ref enabled,4);
        Native.Chord(0x5B,0x44);toggled=true;await Task.Delay(700);
        uint childFirst=Pixel();Image("host-backdrop-desktop-a");
        pattern.Alternate=false;pattern.Invalidate();await Task.Delay(500);uint childSecond=Pixel();Image("host-backdrop-desktop-b");
        Record("desktop_host_backdrop",new{first=childFirst,second=childSecond,respondsToExternalBackground=childFirst!=childSecond,parent=Native.Class(Native.GetParent(Handle))});
        if(childFirst==childSecond)Environment.ExitCode=1;
        Native.Chord(0x5B,0x44);toggled=false;
    }
    void CreateComposition(){
        compositor=new Compositor();IntPtr pointer;
        ((ICompositorDesktopInterop)(object)compositor).CreateDesktopWindowTarget(Handle,true,out pointer);
        try{target=(DesktopWindowTarget)Marshal.GetObjectForIUnknown(pointer);}finally{Marshal.Release(pointer);}
        root=compositor.CreateSpriteVisual();root.Size=new Vector2(ClientSize.Width,ClientSize.Height);
    }
    void SetBackdropBrush(bool host){
        brush=host?compositor.CreateHostBackdropBrush():compositor.CreateBackdropBrush();
        IntPtr effect;Marshal.ThrowExceptionForHR(HostNative.CreateOpacityEffect(out effect));
        try{factory=compositor.CreateEffectFactory((IGraphicsEffect)Marshal.GetObjectForIUnknown(effect));}finally{Marshal.Release(effect);}
        effectBrush=factory.CreateBrush();effectBrush.SetSourceParameter("backdrop",brush);root.Brush=effectBrush;
    }
    void DisposeComposition(){
        if(target!=null){target.Root=null;target.Dispose();target=null;}
        if(effectBrush!=null){effectBrush.Dispose();effectBrush=null;}if(factory!=null){factory.Dispose();factory=null;}
        if(root!=null){root.Dispose();root=null;}if(brush!=null){brush.Dispose();brush=null;}if(compositor!=null){compositor.Dispose();compositor=null;}
    }
    static void Attach(Form form,IntPtr host){
        Native.Rect r;Native.GetWindowRect(form.Handle,out r);
        Native.SetWindowPos(form.Handle,new IntPtr(-2),0,0,0,0,0x13);
        // Explorer's raised desktop uses layered children; remove no-redirection
        // and establish a layered backing before crossing the process boundary.
        Native.SetWindowLong(form.Handle,-20,(Native.GetWindowLong(form.Handle,-20)&~0x00200000)|0x80000);
        Native.SetLayeredWindowAttributes(form.Handle,0,255,2);
        Native.SetWindowLong(form.Handle,-16,(Native.GetWindowLong(form.Handle,-16)&~unchecked((int)0x80000000))|0x40000000);
        Native.SetLastError(0);Native.SetParent(form.Handle,host);int error=Marshal.GetLastWin32Error();
        if(error!=0||Native.GetParent(form.Handle)!=host)throw new InvalidOperationException("Attach "+form.GetType().Name+": "+error);
        var p=new Native.Point(r.Left,r.Top);Native.ScreenToClient(host,ref p);
        Native.SetWindowPos(form.Handle,IntPtr.Zero,p.X,p.Y,r.Right-r.Left,r.Bottom-r.Top,0x70);
        // GDI pattern needs a new layered backing; composition target is separate.
        if(form is PatternWindow){int ex=Native.GetWindowLong(form.Handle,-20);Native.SetWindowLong(form.Handle,-20,ex&~0x80000);Native.SetWindowLong(form.Handle,-20,ex|0x80000);Native.SetLayeredWindowAttributes(form.Handle,0,255,2);form.Refresh();}
    }
    protected override void OnFormClosing(FormClosingEventArgs e){
        if(toggled){try{Native.Chord(0x5B,0x44);}catch{}toggled=false;}
        DisposeComposition();
        if(pattern!=null)pattern.Close();Native.SetForegroundWindow(previous);base.OnFormClosing(e);
    }
}
static class GlassProgram
{
    [STAThread] static int Main(){
        IntPtr controller=IntPtr.Zero;
        try{
            Native.SetThreadDpiAwarenessContext(Native.GetWindowDpiAwarenessContext(Native.DesktopHost()));
            var options=new HostNative.QueueOptions{size=12,thread=2,apartment=2};
            Marshal.ThrowExceptionForHR(HostNative.CreateDispatcherQueueController(options,out controller));
            Application.EnableVisualStyles();Application.Run(new HostWindow());return Environment.ExitCode;
        }catch(Exception e){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"host-backdrop.json"),new JavaScriptSerializer().Serialize(new{fatal=e.ToString()}));return 2;}
        finally{if(controller!=IntPtr.Zero)Marshal.Release(controller);}
    }
}
