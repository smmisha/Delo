// Independent Win32 feasibility probe. No task data or production UI.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Native
{
    internal delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; public Point(int x,int y){X=x;Y=y;} }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left,Top,Right,Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct Input { public uint type; public InputUnion data; }
    [StructLayout(LayoutKind.Explicit)] internal struct InputUnion { [FieldOffset(0)] public Keyboard key; [FieldOffset(0)] public Mouse mouse; }
    [StructLayout(LayoutKind.Sequential)] internal struct Keyboard { public ushort vk,scan; public uint flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct Mouse { public int x,y; public uint data,flags,time; public IntPtr extra; }
    [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumProc callback,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern int GetClassName(IntPtr hwnd,StringBuilder name,int max);
    [DllImport("user32.dll")] internal static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
    [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out int value,int size);
    [DllImport("user32.dll",SetLastError=true)] internal static extern IntPtr SetParent(IntPtr hwnd,IntPtr parent);
    [DllImport("kernel32.dll")] internal static extern void SetLastError(uint error);
    [DllImport("user32.dll")] internal static extern int GetWindowLong(IntPtr hwnd,int index);
    [DllImport("user32.dll",SetLastError=true)] internal static extern int SetWindowLong(IntPtr hwnd,int index,int value);
    [DllImport("user32.dll",SetLastError=true)] internal static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
    [DllImport("user32.dll")] internal static extern bool ScreenToClient(IntPtr hwnd,ref Point point);
    [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] internal static extern bool IsChild(IntPtr parent,IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr hwnd,int command);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll",SetLastError=true)] internal static extern bool SetLayeredWindowAttributes(IntPtr hwnd,uint key,byte alpha,uint flags);
    [DllImport("user32.dll",SetLastError=true)] internal static extern bool RegisterHotKey(IntPtr hwnd,int id,uint modifiers,uint key);
    [DllImport("user32.dll")] internal static extern bool UnregisterHotKey(IntPtr hwnd,int id);
    [DllImport("user32.dll",SetLastError=true)] internal static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] internal static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] internal static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] internal static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr hwnd,IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern uint GetPixel(IntPtr dc,int x,int y);
    internal static string Class(IntPtr hwnd){var b=new StringBuilder(128);GetClassName(hwnd,b,b.Capacity);return b.ToString();}
    internal static IntPtr DesktopHost()
    {
        IntPtr host=IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd,IntPtr ignored) {
            if (FindWindowEx(hwnd,IntPtr.Zero,"SHELLDLL_DefView",null)!=IntPtr.Zero &&
                (Class(hwnd)=="Progman" || Class(hwnd)=="WorkerW")) {host=hwnd;return false;}
            return true;
        },IntPtr.Zero);
        return host;
    }
    internal static void Chord(params ushort[] keys)
    {
        foreach(int key in new[]{0x10,0x11,0x12,0x5B,0x5C})
            if ((GetAsyncKeyState(key)&0x8000)!=0) throw new InvalidOperationException("User modifier held; input test cancelled.");
        var inputs=new Input[keys.Length*2];
        for(int i=0;i<keys.Length;i++) {
            inputs[i].type=1;inputs[i].data.key.vk=keys[i];
            inputs[keys.Length+i].type=1;inputs[keys.Length+i].data.key.vk=keys[keys.Length-1-i];inputs[keys.Length+i].data.key.flags=2;
        }
        uint sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(Input)));
        if(sent!=inputs.Length) {
            // Release any modifier pressed before a partial SendInput failure.
            var release=new Input[keys.Length];
            for(int i=0;i<keys.Length;i++){release[i].type=1;release[i].data.key.vk=keys[i];release[i].data.key.flags=2;}
            SendInput((uint)release.Length,release,Marshal.SizeOf(typeof(Input)));
            throw new InvalidOperationException("SendInput failed/partial: "+sent);
        }
    }
    internal static void ClickAt(int x,int y)
    {
        Point previous;GetCursorPos(out previous);
        try {
            SetCursorPos(x,y);var input=new Input[2];
            input[0].data.mouse.flags=2;input[1].data.mouse.flags=4;
            if(SendInput(2,input,Marshal.SizeOf(typeof(Input)))!=2)throw new InvalidOperationException("Mouse input test failed.");
        } finally {SetCursorPos(previous.X,previous.Y);}
    }
    internal static void TypeText(string text)
    {
        var input=new Input[text.Length*2];
        for(int i=0;i<text.Length;i++){
            input[2*i].type=1;input[2*i].data.key.scan=text[i];input[2*i].data.key.flags=4;
            input[2*i+1]=input[2*i];input[2*i+1].data.key.flags=6;
        }
        if(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(Input)))!=input.Length)throw new InvalidOperationException("Unicode input test failed.");
    }
}

sealed class Probe : Form
{
    const int Style=-16, ExStyle=-20, Child=0x40000000, Popup=unchecked((int)0x80000000);
    readonly List<object> journal=new List<object>();
    readonly string output;
    readonly bool automatic;
    readonly IntPtr host, originalForeground;
    readonly Label status=new Label();
    readonly TextBox entry=new TextBox();
    readonly Rectangle initialBounds;
    Form cover,capture;
    bool desktop,desktopToggled,registered,closing;
    int received,failures;
    string captured="";
    IntPtr captureReturn;

    internal Probe(IntPtr desktopHost,string outputPath,bool selfTest)
    {
        host=desktopHost;output=outputPath;automatic=selfTest;originalForeground=Native.GetForegroundWindow();
        Text="Delo — Windows layer probe";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;
        BackColor=Color.FromArgb(24,55,82);ForeColor=Color.White;Font=new Font("Segoe UI",10);
        // Let WinForms create and maintain its layered backing surface from the
        // first HWND creation. The colour key is absent from this diagnostic UI.
        TransparencyKey=Color.Fuchsia;
        StartPosition=FormStartPosition.Manual;
        var area=Screen.PrimaryScreen.WorkingArea;
        initialBounds=new Rectangle(area.Right-400,area.Top+90,340,260);Bounds=initialBounds;
        var title=new Label{Text="Delo · Windows layer probe",Bounds=new Rectangle(20,20,305,32)};Controls.Add(title);
        status.Bounds=new Rectangle(20,58,300,40);Controls.Add(status);
        entry.Bounds=new Rectangle(20,112,300,28);entry.Text="Test input — no task storage";Controls.Add(entry);
        AddButton("Desktop",20,160,delegate{Attach();});
        AddButton("Topmost",125,160,delegate{Detach(true);});
        AddButton("Exit",230,160,delegate{Close();});
        Controls.Add(new Label{Text="Ctrl+Alt+N: quick input\nTemporary diagnostic, not the Delo design",Bounds=new Rectangle(20,205,300,45)});
        Shown+=async delegate {
            try {
                Log("environment",new{host=Native.Class(host),hostHandle=host.ToInt64(),dpi=Native.GetDpiForWindow(Handle),session=System.Diagnostics.Process.GetCurrentProcess().SessionId,screen=area.ToString()});
                registered=Native.RegisterHotKey(Handle,101,0x4003,0x4E);
                Check("register_ctrl_alt_n",registered,new{error=registered?0:Marshal.GetLastWin32Error()});
                // Shown is raised within WinForms' first SetVisibleCore. Defer
                // probing until that initial visibility transaction has finished.
                await Task.Delay(150);Native.ShowWindow(Handle,5);
                if(automatic) await Test(); else {Attach();Save();}
            }catch(Exception e){Check("exception",false,e.ToString());Save();if(automatic)Close();}
        };
    }
    void AddButton(string text,int x,int y,Action action){var b=new Button{Text=text,Bounds=new Rectangle(x,y,90,32),ForeColor=Color.Black};b.Click+=delegate{action();};Controls.Add(b);}
    void Log(string name,object details){journal.Add(new{name=name,utc=DateTime.UtcNow.ToString("o"),details=details});Save();}
    void Check(string name,bool pass,object details){if(!pass)failures++;journal.Add(new{name=name,pass=pass,utc=DateTime.UtcNow.ToString("o"),details=details});Save();}
    void Save(){File.WriteAllText(output,new JavaScriptSerializer().Serialize(new{failures=failures,events=journal}));}
    void SetStyle(int index,int value){Native.SetLastError(0);Native.SetWindowLong(Handle,index,value);int error=Marshal.GetLastWin32Error();if(error!=0)throw new System.ComponentModel.Win32Exception(error);}
    void Reparent(IntPtr parent){Native.SetLastError(0);Native.SetParent(Handle,parent);int error=Marshal.GetLastWin32Error();IntPtr actual=Native.GetParent(Handle);if(error!=0 || (actual!=parent && !(parent==IntPtr.Zero&&actual==Native.GetDesktopWindow())))throw new InvalidOperationException("SetParent failed: "+error);}
    void Position(IntPtr after,Native.Point point,int width,int height){if(!Native.SetWindowPos(Handle,after,point.X,point.Y,width,height,0x70))throw new System.ComponentModel.Win32Exception();}
    void ResetLayerSurface()
    {
        // Reparenting changed the redirection target. Recreate the layered surface
        // after attachment instead of retaining its former top-level backing.
        int ex=Native.GetWindowLong(Handle,ExStyle);
        SetStyle(ExStyle,ex&~0x80000);SetStyle(ExStyle,ex|0x80000);
        if(!Native.SetLayeredWindowAttributes(Handle,0,255,2))throw new System.ComponentModel.Win32Exception();
        Invalidate(true);Update();
    }
    void Attach()
    {
        if(!Native.IsWindow(host))throw new InvalidOperationException("Desktop host lost; restart probe.");
        Native.Rect rect;Native.GetWindowRect(Handle,out rect);
        if(!Native.SetWindowPos(Handle,new IntPtr(-2),0,0,0,0,0x13))throw new System.ComponentModel.Win32Exception();
        SetStyle(Style,(Native.GetWindowLong(Handle,Style)&~Popup)|Child);
        SetStyle(ExStyle,(Native.GetWindowLong(Handle,ExStyle)|0x80000|0x80)&~0x8);
        if(!Native.SetLayeredWindowAttributes(Handle,0,255,2))throw new System.ComponentModel.Win32Exception();
        Reparent(host);
        var point=new Native.Point(rect.Left,rect.Top);Native.ScreenToClient(host,ref point);
        // Above the icon view, inside the existing desktop host: interactive widget,
        // not wallpaper behind the icons. No Explorer messages or style changes.
        Position(IntPtr.Zero,point,rect.Right-rect.Left,rect.Bottom-rect.Top);
        desktop=true;status.Text="Desktop child · "+Native.Class(host);ResetLayerSurface();Refresh();
    }
    void Detach(bool topmost)
    {
        Native.Rect rect;Native.GetWindowRect(Handle,out rect);
        Reparent(IntPtr.Zero);
        SetStyle(Style,(Native.GetWindowLong(Handle,Style)&~Child)|Popup);
        Position(new IntPtr(topmost?-1:-2),new Native.Point(rect.Left,rect.Top),rect.Right-rect.Left,rect.Bottom-rect.Top);
        desktop=false;status.Text=topmost?"Topmost window":"Normal window";ResetLayerSurface();Refresh();
    }
    object Snapshot()
    {
        Native.Rect r;Native.GetWindowRect(Handle,out r);
        var point=new Native.Point(r.Left+10,r.Top+10);IntPtr hit=Native.WindowFromPoint(point);
        IntPtr dc=Native.GetDC(IntPtr.Zero);uint pixel=0;
        try{pixel=Native.GetPixel(dc,point.X,point.Y);}finally{Native.ReleaseDC(IntPtr.Zero,dc);}
        int cloaked;Native.DwmGetWindowAttribute(Handle,14,out cloaked,4);
        return new {parent=Native.Class(Native.GetParent(Handle)),visible=Native.IsWindowVisible(Handle),minimized=Native.IsIconic(Handle),cloaked=cloaked,style=Native.GetWindowLong(Handle,Style),exStyle=Native.GetWindowLong(Handle,ExStyle),hit=Native.Class(hit),ownHit=hit==Handle||Native.IsChild(Handle,hit),pixel=pixel,expectedPixel=(uint)(BackColor.R|(BackColor.G<<8)|(BackColor.B<<16)),rect=new[]{r.Left,r.Top,r.Right,r.Bottom},dpi=Native.GetDpiForWindow(Handle)};
    }
    bool OwnVisible()
    {
        Native.Rect r;Native.GetWindowRect(Handle,out r);var p=new Native.Point(r.Left+10,r.Top+10);
        IntPtr hit=Native.WindowFromPoint(p);IntPtr dc=Native.GetDC(IntPtr.Zero);uint pixel;
        try{pixel=Native.GetPixel(dc,p.X,p.Y);}finally{Native.ReleaseDC(IntPtr.Zero,dc);}
        uint expected=(uint)(BackColor.R|(BackColor.G<<8)|(BackColor.B<<16));
        return Native.IsWindowVisible(Handle)&&!Native.IsIconic(Handle)&&(hit==Handle||Native.IsChild(Handle,hit))&&pixel==expected;
    }
    protected override void WndProc(ref Message m)
    {
        if(m.Msg==0x312 && m.WParam.ToInt32()==101){received++;OpenCapture();return;}
        base.WndProc(ref m);
    }
    void OpenCapture()
    {
        if(capture!=null){capture.Activate();return;}
        captureReturn=Native.GetForegroundWindow();
        capture=new Form{Text="Delo probe — quick input",Size=new Size(390,125),StartPosition=FormStartPosition.CenterScreen,ShowInTaskbar=false,TopMost=true,KeyPreview=true};
        var box=new TextBox{Dock=DockStyle.Top};capture.Controls.Add(box);
        capture.Shown+=delegate{box.Focus();};
        capture.KeyDown+=delegate(object sender,KeyEventArgs e){
            if(e.KeyCode==Keys.Enter){captured=box.Text;e.SuppressKeyPress=true;capture.Close();}
            else if(e.KeyCode==Keys.Escape){e.SuppressKeyPress=true;capture.Close();}
        };
        capture.FormClosed+=delegate{capture=null;Native.SetForegroundWindow(captureReturn);};
        capture.Show();capture.Activate();box.Focus();
    }
    async Task Test()
    {
        Native.SetWindowPos(Handle,new IntPtr(-1),Left,Top,Width,Height,0x60);
        Native.ShowWindow(Handle,5);Refresh();await Task.Delay(300);
        Check("baseline_top_level_pixels",OwnVisible(),Snapshot());
        // Only temporary, owned windows occlude the probe. No user window titles read.
        cover=new Form{Text="Delo probe — ordinary cover",FormBorderStyle=FormBorderStyle.None,StartPosition=FormStartPosition.Manual,Bounds=initialBounds,BackColor=Color.DarkRed,ShowInTaskbar=true};
        Attach();await Task.Delay(250);
        Check("desktop_parent",Native.GetParent(Handle)==host,Snapshot());
        cover.Show();cover.Activate();Native.SetForegroundWindow(cover.Handle);await Task.Delay(250);
        Check("normal_window_covers_desktop_widget",!OwnVisible()&&Native.GetForegroundWindow()==cover.Handle,Snapshot());
        Native.Chord(0x5B,0x44);desktopToggled=true;await Task.Delay(1000);
        Check("win_d_widget_visible_and_hittable",OwnVisible(),Snapshot());
        Native.Rect desktopRect;Native.GetWindowRect(Handle,out desktopRect);
        IntPtr desktopHit=Native.WindowFromPoint(new Native.Point(desktopRect.Left+10,desktopRect.Top+10));
        int coverCloaked;Native.DwmGetWindowAttribute(cover.Handle,14,out coverCloaked,4);
        Check("win_d_cover_no_longer_occludes",desktopHit==Handle||Native.IsChild(Handle,desktopHit),new{minimized=Native.IsIconic(cover.Handle),cloaked=coverCloaked});
        if(desktopHit==Handle||Native.IsChild(Handle,desktopHit)){
            using(var bitmap=new Bitmap(desktopRect.Right-desktopRect.Left,desktopRect.Bottom-desktopRect.Top)){
                using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(desktopRect.Left,desktopRect.Top,0,0,bitmap.Size);
                bitmap.Save(Path.Combine(Path.GetDirectoryName(output),"desktop-probe-region.png"));
            }
        }
        if(OwnVisible()){
            var inputPoint=entry.PointToScreen(new System.Drawing.Point(30,10));
            Native.ClickAt(inputPoint.X,inputPoint.Y);await Task.Delay(150);
            bool focused=entry.Focused;
            if(focused){Native.Chord(0x11,0x41);await Task.Delay(100);Native.TypeText("desktop-input");await Task.Delay(100);}
            Check("desktop_click_and_type",focused&&entry.Text=="desktop-input",new{focused=focused,text=entry.Text});
        }else Check("desktop_click_and_type",false,"Skipped: desktop probe pixels missing.");
        Native.Chord(0x5B,0x44);desktopToggled=false;await Task.Delay(700);
        Native.ShowWindow(cover.Handle,9);cover.Activate();Native.SetForegroundWindow(cover.Handle);
        Detach(true);await Task.Delay(300);
        Check("topmost_above_cover",OwnVisible()&&Native.GetAncestor(Handle,2)==Handle&&(Native.GetWindowLong(Handle,ExStyle)&8)!=0,Snapshot());
        Attach();await Task.Delay(250);
        Check("unpin_returns_desktop",Native.GetParent(Handle)==host&&!OwnVisible()&&(Native.GetWindowLong(Handle,ExStyle)&8)==0,Snapshot());
        for(int i=0;i<3;i++){Detach(true);Attach();}
        Check("three_mode_roundtrips",Native.GetParent(Handle)==host,Snapshot());
        if(registered){
            cover.Activate();Native.SetForegroundWindow(cover.Handle);await Task.Delay(150);
            Native.Chord(0x11,0x12,0x4E);await Task.Delay(350);
            bool focused=capture!=null&&Native.GetForegroundWindow()==capture.Handle&&capture.ActiveControl is TextBox;
            Check("hotkey_from_other_window_focuses_input",received==1&&focused,new{received=received,focus=focused});
            if(focused){Native.TypeText("probe-task");Native.Chord(0x0D);await Task.Delay(200);}
            Check("capture_enter_returns_focus",captured=="probe-task"&&capture==null&&Native.GetForegroundWindow()==cover.Handle,new{captured=captured,returned=Native.GetForegroundWindow()==cover.Handle});
            if(capture==null){Native.Chord(0x11,0x12,0x4E);await Task.Delay(250);}
            if(capture!=null&&Native.GetForegroundWindow()==capture.Handle){Native.Chord(0x1B);await Task.Delay(200);}
            Check("capture_escape_returns_focus",capture==null&&Native.GetForegroundWindow()==cover.Handle,new{returned=Native.GetForegroundWindow()==cover.Handle});
        }
        // Save only the probe's own pixels, never a screenshot of the user's desktop.
        Detach(true);await Task.Delay(200);
        using(var bitmap=new Bitmap(Width,Height)){DrawToBitmap(bitmap,ClientRectangle);bitmap.Save(Path.Combine(Path.GetDirectoryName(output),"probe-window.png"));}
        Log("complete",new{failures=failures});Close();
    }
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if(!closing){closing=true;
            if(registered)Native.UnregisterHotKey(Handle,101);
            if(capture!=null)capture.Close();
            if(desktopToggled){try{Native.Chord(0x5B,0x44);}catch(Exception error){Log("restore_show_desktop_failed",error.Message);}}
            if(cover!=null)cover.Close();
            if(desktop && Native.IsWindow(Handle)){try{Detach(false);}catch(Exception error){Log("detach_cleanup_failed",error.Message);}}
            Native.SetForegroundWindow(originalForeground);Save();Environment.ExitCode=failures==0?0:1;
        }
        base.OnFormClosing(e);
    }
}

static class Program
{
    [STAThread] static int Main(string[] args)
    {
        string output=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"results.json");
        bool test=Array.IndexOf(args,"--self-test")>=0;
        try {
            IntPtr host=Native.DesktopHost();if(host==IntPtr.Zero)throw new InvalidOperationException("No existing Explorer desktop host found.");
            // Match host awareness before creating HWNDs; cross-process parenting can
            // reset mismatched DPI contexts. This is a measured probe, not DPI policy.
            Native.SetThreadDpiAwarenessContext(Native.GetWindowDpiAwarenessContext(host));
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Probe(host,output,test));return Environment.ExitCode;
        }catch(Exception e){File.WriteAllText(output,new JavaScriptSerializer().Serialize(new{fatal=e.ToString()}));return 2;}
    }
}
