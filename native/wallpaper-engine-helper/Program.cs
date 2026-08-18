using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace FluxPlayer.WallpaperEngine
{
    internal static class NativeMethods
    {
        internal const uint WM_MOUSEMOVE = 0x0200;
        internal const uint DWM_TNP_RECTDESTINATION = 0x00000001;
        internal const uint DWM_TNP_VISIBLE = 0x00000008;
        internal const uint DWM_TNP_SOURCECLIENTAREAONLY = 0x00000010;
        internal const uint SWP_NOACTIVATE = 0x0010;
        internal const uint SWP_SHOWWINDOW = 0x0040;
        internal const int SW_HIDE = 0;
        internal const int SW_SHOWNOACTIVATE = 4;
        internal const uint GA_ROOT = 2;
        internal const uint WM_NCHITTEST = 0x0084;
        internal const int HTTRANSPARENT = -1;

        [StructLayout(LayoutKind.Sequential)]
        internal struct Rect
        {
            internal int Left;
            internal int Top;
            internal int Right;
            internal int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Point
        {
            internal int X;
            internal int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct ThumbnailProperties
        {
            internal uint Flags;
            internal Rect Destination;
            internal Rect Source;
            internal byte Opacity;
            [MarshalAs(UnmanagedType.Bool)] internal bool Visible;
            [MarshalAs(UnmanagedType.Bool)] internal bool SourceClientAreaOnly;
        }

        internal delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

        [ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface ITaskbarList
        {
            void HrInit();
            void AddTab(IntPtr window);
            void DeleteTab(IntPtr window);
            void ActivateTab(IntPtr window);
            void SetActiveAlt(IntPtr window);
        }

        [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090"), ClassInterface(ClassInterfaceType.None)]
        internal class TaskbarList { }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsIconic(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetClassNameW(IntPtr window, StringBuilder text, int capacity);

        [DllImport("user32.dll", SetLastError = true)]
        internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetClientRect(IntPtr window, out Rect rect);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ClientToScreen(IntPtr window, ref Point point);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetCursorPos(out Point point);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetWindowPos(
            IntPtr window,
            IntPtr insertAfter,
            int x,
            int y,
            int width,
            int height,
            uint flags);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr parameter);

        [DllImport("user32.dll")]
        internal static extern IntPtr GetAncestor(IntPtr window, uint flags);

        [DllImport("dwmapi.dll")]
        internal static extern int DwmRegisterThumbnail(IntPtr destination, IntPtr source, out IntPtr thumbnail);

        [DllImport("dwmapi.dll")]
        internal static extern int DwmUpdateThumbnailProperties(
            IntPtr thumbnail,
            ref ThumbnailProperties properties);

        [DllImport("dwmapi.dll")]
        internal static extern int DwmUnregisterThumbnail(IntPtr thumbnail);

        [DllImport("user32.dll")]
        internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    }

    internal sealed class SessionOptions
    {
        internal string SessionId;
        internal IntPtr SourceWindow;
        internal string SourceTitle;
        internal string SourceExecutable;
        internal IntPtr HostWindow;
        internal string HostExecutable;
        internal int ParentProcessId;
        internal uint SourceProcessId;
        internal string SourceWindowClass;
        internal string HostWindowClass;

        internal static SessionOptions Parse(string line)
        {
            string[] fields = (line ?? string.Empty).Split('\t');
            if (fields.Length != 8 || !string.Equals(fields[0], "START", StringComparison.Ordinal))
                throw new InvalidOperationException("WALLPAPER_ENGINE_HELPER_PROTOCOL_INVALID");

            SessionOptions options = new SessionOptions();
            options.SessionId = Decode(fields[1]);
            options.SourceWindow = ParseHandle(fields[2]);
            options.SourceTitle = Decode(fields[3]);
            options.SourceExecutable = Path.GetFullPath(Decode(fields[4]));
            options.HostWindow = ParseHandle(fields[5]);
            options.HostExecutable = Path.GetFullPath(Decode(fields[6]));
            int parent;
            if (!int.TryParse(fields[7], out parent) || parent <= 0)
                throw new InvalidOperationException("WALLPAPER_ENGINE_HELPER_PARENT_INVALID");
            options.ParentProcessId = parent;
            if (options.SessionId.Length < 8 || options.SessionId.Length > 80)
                throw new InvalidOperationException("WALLPAPER_ENGINE_HELPER_SESSION_INVALID");
            return options;
        }

        private static string Decode(string value)
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(value ?? string.Empty));
        }

        private static IntPtr ParseHandle(string value)
        {
            ulong raw;
            if (!ulong.TryParse(value, out raw) || raw == 0)
                throw new InvalidOperationException("WALLPAPER_ENGINE_HELPER_HANDLE_INVALID");
            return IntPtr.Size == 8
                ? new IntPtr(unchecked((long)raw))
                : new IntPtr(unchecked((int)raw));
        }
    }

    internal sealed class DwmSurface : Form
    {
        private readonly SessionOptions options;
        private readonly System.Windows.Forms.Timer timer;
        private IntPtr thumbnail = IntPtr.Zero;
        private IntPtr sceneInput = IntPtr.Zero;
        private int consecutiveFailures;
        private bool suspended;
        private int lastWidth = -1;
        private int lastHeight = -1;

        internal DwmSurface(SessionOptions session)
        {
            options = session;
            Text = "FluxPlayer WE DWM Surface " + options.SessionId;
            FormBorderStyle = FormBorderStyle.None;
            // WGC only exposes normal top-level windows consistently. DeleteTab
            // removes the surface before it can become user-facing.
            ShowInTaskbar = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.Black;
            timer = new System.Windows.Forms.Timer();
            timer.Interval = 16;
            timer.Tick += delegate { TickSession(); };
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_NOACTIVATE = 0x08000000;
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= WS_EX_NOACTIVATE;
                return parameters;
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == NativeMethods.WM_NCHITTEST)
            {
                message.Result = new IntPtr(NativeMethods.HTTRANSPARENT);
                return;
            }
            base.WndProc(ref message);
        }

        protected override void OnHandleCreated(EventArgs eventArgs)
        {
            base.OnHandleCreated(eventArgs);
            HideTaskbar();
        }

        protected override void OnShown(EventArgs eventArgs)
        {
            base.OnShown(eventArgs);
            HideTaskbar();
            HideTaskbar(options.SourceWindow);
            options.SourceProcessId = ReadProcessId(options.SourceWindow);
            options.SourceWindowClass = ReadWindowClass(options.SourceWindow);
            options.HostWindowClass = ReadWindowClass(options.HostWindow);
            ValidateIdentity(
                options.SourceWindow,
                options.SourceExecutable,
                options.SourceTitle,
                options.SourceProcessId,
                options.SourceWindowClass);
            ValidateIdentity(
                options.HostWindow,
                options.HostExecutable,
                null,
                (uint)options.ParentProcessId,
                options.HostWindowClass);
            int result = NativeMethods.DwmRegisterThumbnail(Handle, options.SourceWindow, out thumbnail);
            if (result != 0 || thumbnail == IntPtr.Zero)
                throw new InvalidOperationException("WALLPAPER_ENGINE_DWM_REGISTER_FAILED");
            FollowHost(true);
            timer.Start();
            StartCommandReader();
            WriteJson("{\"ok\":true,\"ready\":true,\"surfaceWindowHandle\":" +
                Handle.ToInt64() + ",\"surfaceTitle\":\"" + EscapeJson(Text) + "\"}");
        }

        private void HideTaskbar()
        {
            HideTaskbar(Handle);
        }

        private static void HideTaskbar(IntPtr window)
        {
            try
            {
                NativeMethods.ITaskbarList taskbar = (NativeMethods.ITaskbarList)new NativeMethods.TaskbarList();
                taskbar.HrInit();
                taskbar.DeleteTab(window);
                Marshal.FinalReleaseComObject(taskbar);
            }
            catch { }
        }

        protected override void OnFormClosed(FormClosedEventArgs eventArgs)
        {
            timer.Stop();
            if (thumbnail != IntPtr.Zero)
            {
                NativeMethods.DwmUnregisterThumbnail(thumbnail);
                thumbnail = IntPtr.Zero;
            }
            base.OnFormClosed(eventArgs);
        }

        private void TickSession()
        {
            try
            {
                Process parent = Process.GetProcessById(options.ParentProcessId);
                if (parent.HasExited) throw new InvalidOperationException("WALLPAPER_ENGINE_HELPER_PARENT_EXITED");
                parent.Dispose();
                ValidateIdentity(
                    options.SourceWindow,
                    options.SourceExecutable,
                    options.SourceTitle,
                    options.SourceProcessId,
                    options.SourceWindowClass);
                ValidateIdentity(
                    options.HostWindow,
                    options.HostExecutable,
                    null,
                    (uint)options.ParentProcessId,
                    options.HostWindowClass);
                FollowHost(false);
                RelayPointer();
                consecutiveFailures = 0;
            }
            catch (Exception error)
            {
                consecutiveFailures += 1;
                if (consecutiveFailures >= 8)
                {
                    WriteJson("{\"ok\":false,\"error\":\"" + EscapeJson(error.Message) + "\"}");
                    Close();
                }
            }
        }

        private void FollowHost(bool force)
        {
            bool hidden = suspended || NativeMethods.IsIconic(options.HostWindow) ||
                !NativeMethods.IsWindowVisible(options.HostWindow);
            if (hidden)
            {
                NativeMethods.ShowWindow(Handle, NativeMethods.SW_HIDE);
                NativeMethods.ShowWindow(options.SourceWindow, NativeMethods.SW_HIDE);
                return;
            }

            NativeMethods.Rect client;
            NativeMethods.Point origin = new NativeMethods.Point();
            if (!NativeMethods.GetClientRect(options.HostWindow, out client) ||
                !NativeMethods.ClientToScreen(options.HostWindow, ref origin))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            int width = Math.Max(1, client.Right - client.Left);
            int height = Math.Max(1, client.Bottom - client.Top);

            NativeMethods.ShowWindow(options.SourceWindow, NativeMethods.SW_SHOWNOACTIVATE);
            NativeMethods.SetWindowPos(
                options.SourceWindow,
                Handle,
                origin.X,
                origin.Y,
                width,
                height,
                NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_SHOWWINDOW);
            NativeMethods.SetWindowPos(
                Handle,
                options.HostWindow,
                origin.X,
                origin.Y,
                width,
                height,
                NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_SHOWWINDOW);

            if (force || width != lastWidth || height != lastHeight)
            {
                NativeMethods.ThumbnailProperties properties = new NativeMethods.ThumbnailProperties();
                properties.Flags = NativeMethods.DWM_TNP_RECTDESTINATION |
                    NativeMethods.DWM_TNP_VISIBLE |
                    NativeMethods.DWM_TNP_SOURCECLIENTAREAONLY;
                properties.Destination = new NativeMethods.Rect { Left = 0, Top = 0, Right = width, Bottom = height };
                properties.Visible = true;
                properties.SourceClientAreaOnly = true;
                int result = NativeMethods.DwmUpdateThumbnailProperties(thumbnail, ref properties);
                if (result != 0) throw new InvalidOperationException("WALLPAPER_ENGINE_DWM_UPDATE_FAILED");
                lastWidth = width;
                lastHeight = height;
            }
        }

        private void RelayPointer()
        {
            if (suspended) return;
            if (sceneInput == IntPtr.Zero || !NativeMethods.IsWindow(sceneInput))
                sceneInput = FindSceneInputWindow();
            if (sceneInput == IntPtr.Zero) return;

            NativeMethods.Point cursor;
            NativeMethods.Point hostOrigin = new NativeMethods.Point();
            NativeMethods.Rect hostClient;
            NativeMethods.Rect sceneClient;
            if (!NativeMethods.GetCursorPos(out cursor) ||
                !NativeMethods.GetClientRect(options.HostWindow, out hostClient) ||
                !NativeMethods.ClientToScreen(options.HostWindow, ref hostOrigin) ||
                !NativeMethods.GetClientRect(sceneInput, out sceneClient)) return;

            int hostWidth = Math.Max(1, hostClient.Right - hostClient.Left);
            int hostHeight = Math.Max(1, hostClient.Bottom - hostClient.Top);
            int sceneWidth = Math.Max(1, sceneClient.Right - sceneClient.Left);
            int sceneHeight = Math.Max(1, sceneClient.Bottom - sceneClient.Top);
            int localX = Math.Max(0, Math.Min(hostWidth - 1, cursor.X - hostOrigin.X));
            int localY = Math.Max(0, Math.Min(hostHeight - 1, cursor.Y - hostOrigin.Y));
            int mappedX = hostWidth <= 1 ? 0 : (int)((long)localX * (sceneWidth - 1) / (hostWidth - 1));
            int mappedY = hostHeight <= 1 ? 0 : (int)((long)localY * (sceneHeight - 1) / (hostHeight - 1));
            int packed = unchecked((mappedY << 16) | (mappedX & 0xffff));
            NativeMethods.PostMessageW(sceneInput, NativeMethods.WM_MOUSEMOVE, IntPtr.Zero, new IntPtr(packed));
        }

        private IntPtr FindSceneInputWindow()
        {
            IntPtr found = IntPtr.Zero;
            NativeMethods.EnumChildWindows(options.SourceWindow, delegate(IntPtr candidate, IntPtr ignored)
            {
                if (string.Equals(WindowClass(candidate), "WPEDesktopDX11Window", StringComparison.Ordinal) &&
                    string.Equals(WindowTitle(candidate), "WPELiveWallpaper", StringComparison.Ordinal))
                {
                    found = candidate;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        private void StartCommandReader()
        {
            Thread thread = new Thread(delegate()
            {
                try
                {
                    string line;
                    while ((line = Console.ReadLine()) != null)
                    {
                        string command = line.Trim();
                        if (command == "Q") break;
                        if (command == "S") suspended = true;
                        if (command == "R") suspended = false;
                    }
                }
                catch { }
                try { BeginInvoke(new Action(Close)); } catch { }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        private static void ValidateIdentity(
            IntPtr window,
            string expectedExecutable,
            string expectedTitle,
            uint expectedProcessId,
            string expectedWindowClass)
        {
            if (!NativeMethods.IsWindow(window))
                throw new InvalidOperationException("WALLPAPER_ENGINE_WINDOW_MISSING");
            if (expectedTitle != null && !string.Equals(WindowTitle(window), expectedTitle, StringComparison.Ordinal))
                throw new InvalidOperationException("WALLPAPER_ENGINE_WINDOW_TITLE_CHANGED");
            uint processId;
            if (NativeMethods.GetWindowThreadProcessId(window, out processId) == 0 || processId == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (expectedProcessId != 0 && processId != expectedProcessId)
                throw new InvalidOperationException("WALLPAPER_ENGINE_WINDOW_PROCESS_ID_CHANGED");
            if (!string.Equals(ReadWindowClass(window), expectedWindowClass, StringComparison.Ordinal))
                throw new InvalidOperationException("WALLPAPER_ENGINE_WINDOW_CLASS_CHANGED");
            using (Process process = Process.GetProcessById((int)processId))
            {
                string actual = Path.GetFullPath(process.MainModule.FileName);
                if (!string.Equals(actual, expectedExecutable, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("WALLPAPER_ENGINE_WINDOW_PROCESS_CHANGED");
            }
        }

        private static uint ReadProcessId(IntPtr window)
        {
            uint processId;
            if (NativeMethods.GetWindowThreadProcessId(window, out processId) == 0 || processId == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return processId;
        }

        private static string ReadWindowClass(IntPtr window)
        {
            string windowClass = WindowClass(window);
            if (string.IsNullOrEmpty(windowClass))
                throw new InvalidOperationException("WALLPAPER_ENGINE_WINDOW_CLASS_INVALID");
            return windowClass;
        }

        private static string WindowTitle(IntPtr window)
        {
            StringBuilder text = new StringBuilder(1024);
            NativeMethods.GetWindowTextW(window, text, text.Capacity);
            return text.ToString();
        }

        private static string WindowClass(IntPtr window)
        {
            StringBuilder text = new StringBuilder(256);
            NativeMethods.GetClassNameW(window, text, text.Capacity);
            return text.ToString();
        }

        private static string EscapeJson(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"")
                .Replace("\r", "\\r").Replace("\n", "\\n");
        }

        private static void WriteJson(string value)
        {
            Console.WriteLine(value);
            Console.Out.Flush();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main()
        {
            try
            {
                try { NativeMethods.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
                string start = Console.ReadLine();
                SessionOptions options = SessionOptions.Parse(start);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new DwmSurface(options));
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                Console.Error.Flush();
                return 1;
            }
        }
    }
}
