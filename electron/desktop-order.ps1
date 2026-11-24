$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName Accessibility
Add-Type -ReferencedAssemblies ([Accessibility.IAccessible].Assembly.Location) -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Accessibility;

public static class AgendaDesktopOrder {
    private const uint GW_HWNDPREV = 3;
    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_TOPMOST = 0x00000008;
    private const uint PositionOnly = 0x4213; // No size, move, activation or owner changes. Use an async request.
    private static readonly IntPtr Topmost = new IntPtr(-1);
    private static IntPtr desktopPresentation;
    private static readonly IntPtr NotTopmost = new IntPtr(-2);
    private static readonly Dictionary<IntPtr, string> Regions = new Dictionary<IntPtr, string>();
    private static IntPtr iconList;
    private static DesktopIconBounds.Rectangle[] icons = new DesktopIconBounds.Rectangle[0];
    private static Task<DesktopIconBounds.Rectangle[]> iconRead;
    private static IntPtr pendingIconList;
    private static DateTime nextIconRead;

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr data);
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string windowClass, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string windowClass, string title);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr hwnd, IntPtr region, bool redraw);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] private static extern int CombineRgn(IntPtr result, IntPtr a, IntPtr b, int mode);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);

    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetLastActivePopup(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool EnableWindow(IntPtr hwnd, bool enabled);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int length);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    public static string RepairDesktopInput() {
        IntPtr shell = GetShellWindow();
        var className = new StringBuilder(32);
        if (shell == IntPtr.Zero || GetClassName(shell, className, className.Capacity) == 0 || className.ToString() != "Progman")
            return "unavailable";
        if (IsWindowEnabled(shell)) return "enabled";
        uint pid;
        GetWindowThreadProcessId(shell, out pid);
        using (var process = System.Diagnostics.Process.GetProcessById((int)pid)) {
            if (!string.Equals(process.ProcessName, "explorer", StringComparison.OrdinalIgnoreCase)) return "unavailable";
        }
        IntPtr result;
        if (SendMessageTimeout(shell, 0, IntPtr.Zero, IntPtr.Zero, 2, 350, out result) == IntPtr.Zero)
            return "unavailable";
        if (GetLastActivePopup(shell) != shell) return "busy";
        const uint GW_OWNER = 4;
        bool hasPopup = false;
        EnumWindows(delegate(IntPtr hwnd, IntPtr data) {
            if (IsWindowVisible(hwnd) && GetWindow(hwnd, GW_OWNER) == shell) hasPopup = true;
            return !hasPopup;
        }, IntPtr.Zero);
        if (hasPopup) return "busy";

        // Only the tray command calls this. Never change input on routine desktop updates.
        EnableWindow(shell, true);
        return IsWindowEnabled(shell) ? "restored" : "unavailable";
    }

    public static void MoveNote(IntPtr hwnd, int x, int y) {
        const uint noSizeNoZOrderNoActivate = 0x0015;
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0, noSizeNoZOrderNoActivate);
    }

    private static bool IsTopmost(IntPtr hwnd) {
        return (GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64() & WS_EX_TOPMOST) != 0;
    }

    private static void UpdateIcons(IntPtr list) {
        if (list != iconList) {
            iconList = list;
            icons = new DesktopIconBounds.Rectangle[0];
            nextIconRead = DateTime.MinValue;
        }
        if (iconRead != null && iconRead.IsCompleted) {
            if (iconRead.Status == TaskStatus.RanToCompletion && pendingIconList == list && iconRead.Result != null)
                icons = iconRead.Result;
            iconRead = null;
        }
        if (list == IntPtr.Zero || iconRead != null || DateTime.UtcNow < nextIconRead) return;
        nextIconRead = DateTime.UtcNow.AddSeconds(1);
        pendingIconList = list;
        // Keep a blocked Explorer accessibility provider off the z-order loop.
        iconRead = Task.Run(() => {
            SetThreadDpiAwarenessContext(new IntPtr(-4));
            return DesktopIconBounds.Read(list);
        });
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out int value, int size);
    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out Rect value, int size);

    private static bool TryGetApplicationBounds(IntPtr hwnd, out Rect bounds) {
        bounds = new Rect();
        if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return false;
        int cloaked;
        if (DwmGetWindowAttribute(hwnd, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
        var name = new StringBuilder(64);
        GetClassName(hwnd, name, name.Capacity);
        switch (name.ToString()) {
            case "Progman":
            case "WorkerW":
            case "Shell_TrayWnd":
            case "Shell_SecondaryTrayWnd":
                return false;
        }
        if (DwmGetWindowAttribute(hwnd, 9, out bounds, Marshal.SizeOf(typeof(Rect))) != 0
            && !GetWindowRect(hwnd, out bounds)) return false;
        return bounds.Left < bounds.Right && bounds.Top < bounds.Bottom;
    }

    private static void AddCut(List<Rect> cuts, Rect bounds, int left, int top, int right, int bottom) {
        var cut = new Rect {
            Left = Math.Max(bounds.Left, left) - bounds.Left,
            Top = Math.Max(bounds.Top, top) - bounds.Top,
            Right = Math.Min(bounds.Right, right) - bounds.Left,
            Bottom = Math.Min(bounds.Bottom, bottom) - bounds.Top,
        };
        if (cut.Left < cut.Right && cut.Top < cut.Bottom) cuts.Add(cut);
    }

    private static void SetCalendarRegion(IntPtr hwnd, bool iconsAbove, List<Rect> applications) {
        Rect bounds;
        if (!GetWindowRect(hwnd, out bounds)) return;
        var cuts = new List<Rect>();
        foreach (var app in applications)
            AddCut(cuts, bounds, app.Left, app.Top, app.Right, app.Bottom);
        if (iconsAbove) {
            foreach (var icon in icons) {
                const int padding = 2;
                AddCut(cuts, bounds, icon.Left - padding, icon.Top - padding, icon.Right + padding, icon.Bottom + padding);
            }
        }
        var signature = new StringBuilder();
        if (cuts.Count > 0) {
            signature.Append(bounds.Right - bounds.Left).Append(',').Append(bounds.Bottom - bounds.Top);
            foreach (var cut in cuts)
                signature.Append(';').Append(cut.Left).Append(',').Append(cut.Top).Append(',').Append(cut.Right).Append(',').Append(cut.Bottom);
        }
        string before;
        if (!Regions.TryGetValue(hwnd, out before)) before = "";
        string current = signature.ToString();
        if (before == current) return;
        if (cuts.Count == 0) {
            if (SetWindowRgn(hwnd, IntPtr.Zero, true) != 0) Regions.Remove(hwnd);
            return;
        }

        IntPtr region = CreateRectRgn(0, 0, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
        if (region == IntPtr.Zero) return;
        foreach (var cut in cuts) {
            IntPtr hole = CreateRectRgn(cut.Left, cut.Top, cut.Right, cut.Bottom);
            if (hole == IntPtr.Zero) continue;
            CombineRgn(region, region, hole, 4); // RGN_DIFF
            DeleteObject(hole);
        }
        // Windows owns the region after a successful call.
        if (SetWindowRgn(hwnd, region, true) != 0) Regions[hwnd] = current;
        else DeleteObject(region);
    }

    public static void Place(IntPtr calendar, bool iconsAbove, IntPtr[] windows) {
        SetThreadDpiAwarenessContext(new IntPtr(-4)); // Match the physical MSAA coordinates.
        var widgets = new HashSet<IntPtr>(windows);
        if (calendar != IntPtr.Zero) widgets.Add(calendar);
        var order = new List<IntPtr>();
        IntPtr shell = FindWindow("Progman", null);
        IntPtr iconHost = IntPtr.Zero;
        IntPtr defView = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr data) {
            order.Add(hwnd);
            if (defView == IntPtr.Zero && IsWindowVisible(hwnd)) {
                var view = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (view != IntPtr.Zero) { defView = view; iconHost = hwnd; }
            }
            return true;
        }, IntPtr.Zero);

        var list = !iconsAbove || defView == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
        UpdateIcons(IsWindowVisible(list) ? list : IntPtr.Zero);
        foreach (var hwnd in new List<IntPtr>(Regions.Keys)) {
            if (hwnd == calendar) continue;
            if (order.Contains(hwnd)) SetCalendarRegion(hwnd, false, new List<Rect>());
            else Regions.Remove(hwnd);
        }

        IntPtr desktopHost = iconHost != IntPtr.Zero ? iconHost : shell;
        IntPtr foreground = GetForegroundWindow();
        if (calendar != IntPtr.Zero && (foreground == shell || foreground == desktopHost)
            && (IsIconic(calendar) || !IsWindowVisible(calendar))) {
            ShowWindowAsync(calendar, 4); // SW_SHOWNOACTIVATE
        }

        int desktop = order.IndexOf(desktopHost);
        if (desktop < 0) return;
        IntPtr after = IntPtr.Zero;
        var applications = new List<Rect>();
        for (int i = 0; i < desktop; i++) {
            IntPtr hwnd = order[i];
            Rect bounds;
            if (widgets.Contains(hwnd) || !TryGetApplicationBounds(hwnd, out bounds)) continue;
            if (!IsTopmost(hwnd)) after = hwnd;
            applications.Add(bounds);
        }
        var visibleWidgets = Array.FindAll(windows, hwnd => IsWindowVisible(hwnd) && !IsIconic(hwnd));
        bool desktopForeground = foreground != IntPtr.Zero && (foreground == shell || foreground == desktopHost);
        bool usingDesktop = desktopForeground || (desktopPresentation == calendar && widgets.Contains(foreground));
        bool overlapsApplication = Array.Exists(visibleWidgets, hwnd => {
            Rect bounds;
            return GetWindowRect(hwnd, out bounds) && applications.Exists(rect =>
                rect.Left < bounds.Right && rect.Right > bounds.Left
                && rect.Top < bounds.Bottom && rect.Bottom > bounds.Top);
        });
        bool liftWidgets = calendar != IntPtr.Zero && usingDesktop && !overlapsApplication
            && Array.Exists(visibleWidgets, hwnd => IsTopmost(hwnd) || order.IndexOf(hwnd) > desktop);
        desktopPresentation = liftWidgets ? calendar : IntPtr.Zero;

        if (calendar != IntPtr.Zero) {
            Rect bounds;
            if (order.IndexOf(foreground) > desktop && !widgets.Contains(foreground)
                && TryGetApplicationBounds(foreground, out bounds))
                applications.Add(bounds);

            // Notes are composited over the intact calendar by the window manager.
            SetCalendarRegion(calendar, iconsAbove, applications);
        }

        if (liftWidgets) {
            int previous = -1;
            bool alreadyOrdered = true;
            foreach (var hwnd in visibleWidgets) {
                var index = order.IndexOf(hwnd);
                if (!IsTopmost(hwnd) || index <= previous) alreadyOrdered = false;
                previous = index;
            }
            if (!alreadyOrdered) {
                // HWND_TOPMOST inserts at the front. Apply from back to front.
                for (int i = visibleWidgets.Length - 1; i >= 0; i--) {
                    SetWindowPos(visibleWidgets[i], Topmost, 0, 0, 0, 0, PositionOnly);
                }
            }
            return;
        }

        foreach (IntPtr hwnd in visibleWidgets) {
            if (IsTopmost(hwnd)) SetWindowPos(hwnd, NotTopmost, 0, 0, 0, 0, PositionOnly);
            IntPtr previous = GetWindow(hwnd, GW_HWNDPREV);
            while (previous != IntPtr.Zero && !IsWindowVisible(previous)) previous = GetWindow(previous, GW_HWNDPREV);
            if (previous != after)
                SetWindowPos(hwnd, after, 0, 0, 0, 0, PositionOnly);
            after = hwnd;
        }
    }
}

public static class DesktopIconBounds {
    private const uint OBJID_CLIENT = 0xFFFFFFFC;
    private static readonly Guid IID_IAccessible = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");

    [DllImport("oleacc.dll")]
    private static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IAccessible result);
    [DllImport("oleacc.dll")]
    private static extern int AccessibleChildren(IAccessible parent, int start, int count,
        [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] object[] children, out int fetched);

    public struct Rectangle {
        public int Left, Top, Right, Bottom;
        public Rectangle(int x, int y, int width, int height) {
            Left = x; Top = y; Right = x + width; Bottom = y + height;
        }
    }

    public static Rectangle[] Read(IntPtr listView) {
        IAccessible view;
        Guid iid = IID_IAccessible;
        if (AccessibleObjectFromWindow(listView, OBJID_CLIENT, ref iid, out view) != 0 || view == null)
            return null;
        try {
            int count = view.accChildCount;
            var icons = new List<Rectangle>(count);
            if (count == 0) return icons.ToArray();
            var children = new object[count];
            int fetched;
            if (AccessibleChildren(view, 0, count, children, out fetched) < 0) return null;
            for (int i = 0; i < fetched; i++) {
                IAccessible child = children[i] as IAccessible;
                try {
                    int x, y, width, height;
                    if (child == null) {
                        view.accLocation(out x, out y, out width, out height, children[i]);
                    } else {
                        child.accLocation(out x, out y, out width, out height, 0);
                    }
                    if (width > 0 && height > 0) icons.Add(new Rectangle(x, y, width, height));
                } catch (COMException) {
                    // The icon can disappear during enumeration.
                } finally {
                    if (child != null) Marshal.ReleaseComObject(child);
                }
            }
            return icons.ToArray();
        } finally {
            Marshal.ReleaseComObject(view);
        }
    }
}
"@

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $parts = $line.Split(',')
    if ($parts[0] -eq 'repair') {
        try { [Console]::WriteLine("repair:" + [AgendaDesktopOrder]::RepairDesktopInput()) }
        catch { [Console]::WriteLine('repair:unavailable') }
        continue
    }
    if ($parts[0] -eq 'move') {
        [AgendaDesktopOrder]::MoveNote([IntPtr]::new([long]$parts[1]), [int]$parts[2], [int]$parts[3])
        continue
    }
    $calendar = [IntPtr]::new([long]$parts[0])
    [IntPtr[]]$windows = @($parts | Select-Object -Skip 2 | ForEach-Object { [IntPtr]::new([long]$_) })
    [AgendaDesktopOrder]::Place($calendar, ($parts[1] -eq '1'), $windows)
}
