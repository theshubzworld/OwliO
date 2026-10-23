using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Windows.Forms;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace WindowsHelper;

public class Program
{
    private static IntPtr _hookId = IntPtr.Zero;
    private static LowLevelKeyboardProc _hookProc = HookCallback;
    private static readonly ShortcutController _shortcuts = new(EmitMessage);
    private static bool _allowTestInput;
    private static IntPtr _targetHwnd = IntPtr.Zero;
    private static IntPtr _targetFocusHwnd = IntPtr.Zero;
    private static AutomationElement? _targetElement;
    private static string _targetId = "";
    private static TextSnapshot? _targetSnapshot;

    [STAThread]
    public static void Main(string[] args)
    {
        _allowTestInput = Array.Exists(args, argument => argument == "--allow-test-input");
        Console.OutputEncoding = Encoding.UTF8;
        Console.InputEncoding = Encoding.UTF8;

        // Start background IPC command reader from stdin
        Thread readerThread = new Thread(ReadCommandsFromStdin)
        {
            IsBackground = true
        };
        readerThread.Start();

        // Install global low-level keyboard hook
        _hookId = SetHook(_hookProc);

        if (_hookId == IntPtr.Zero)
        {
            EmitMessage(new { type = "error", message = "Could not register the dictation hotkey.", error = "Could not register the dictation hotkey." });
            return;
        }
        // Notify host that helper is ready
        EmitMessage(new { type = "ready", hotkey = "F8", mode = "push_to_talk" });

        // Run Windows message loop for the hook
        Application.Run();

        // Clean up
        if (_hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hookId);
        }
    }

    #region IPC & Commands

    private static void ReadCommandsFromStdin()
    {
        while (true)
        {
            string requestId = "";
            try
            {
                string? line = Console.ReadLine();
                if (line == null) break; // Stdin closed

                if (string.IsNullOrWhiteSpace(line)) continue;

                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                if (!root.TryGetProperty("type", out var typeProp)) continue;
                string type = typeProp.GetString() ?? "";
                requestId = root.TryGetProperty("requestId", out var idProp) ? idProp.GetString() ?? "" : "";

                switch (type)
                {
                    case "get_context":
                        IntPtr requestedHwnd = root.TryGetProperty("targetHwnd", out var hwndProp) && long.TryParse(hwndProp.GetString(), out long handle)
                            ? new IntPtr(handle) : GetForegroundWindow();
                        HandleGetContext(requestId, requestedHwnd);
                        break;

                    case "paste":
                        if (root.TryGetProperty("text", out var textProp))
                        {
                            string text = textProp.GetString() ?? "";
                            string targetId = root.TryGetProperty("targetId", out var targetProp) ? targetProp.GetString() ?? "" : "";
                            long pasteDeadline = root.TryGetProperty("expiresAt", out var expiryProp) && expiryProp.TryGetInt64(out long expiry)
                                ? expiry : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 4500;
                            bool learn = root.TryGetProperty("learn",out var learnProp) && learnProp.ValueKind==JsonValueKind.True;
                            string? expectedSelection = root.TryGetProperty("expectedSelection", out var expectedProp) ? expectedProp.GetString() : null;
                            HandlePaste(text, requestId, targetId, pasteDeadline, learn, expectedSelection);
                        }
                        break;

                    case "set_hotkey":
                        string keyStr = root.GetProperty("key").GetString() ?? "F8";
                        bool hold = !root.TryGetProperty("mode", out var modeProp) || modeProp.GetString() != "toggle";
                        string shortcut = _shortcuts.Configure(keyStr, hold);
                        EmitMessage(new { type = "hotkey_updated", requestId, success = true, hotkey = shortcut, mode = hold ? "push_to_talk" : "toggle" });
                        break;

                    case "begin_shortcut_capture":
                        _shortcuts.BeginCapture();
                        EmitMessage(new { type = "shortcut_ready", requestId, success = true });
                        break;
                    case "begin_shortcut_test":
                        _shortcuts.BeginTest(root.GetProperty("key").GetString() ?? "F8", root.GetProperty("mode").GetString() != "toggle");
                        EmitMessage(new { type = "shortcut_ready", requestId, success = true });
                        break;
                    case "cancel_shortcut":
                        _shortcuts.Cancel();
                        EmitMessage(new { type = "shortcut_ready", requestId, success = true });
                        break;

                    case "ping":
                        EmitMessage(new { type = "pong" });
                        break;
                    case "cancel_learning":
                        EditObserver.Cancel();
                        break;

                    case "quit":
                        EditObserver.Cancel();
                        Application.Exit();
                        return;
                }
            }
            catch (Exception ex)
            {
                EmitMessage(new { type = "error", requestId, error = ex.Message, message = ex.Message });
            }
        }
    }

    private static void HandleGetContext(string requestId, IntPtr hwnd)
    {
        EditObserver.Cancel();
        try
        {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) throw new InvalidOperationException("Select a text window before dictating.");
            _targetHwnd = hwnd;
            _targetId = requestId;
            _targetElement = null;
            _targetSnapshot = null;
            _targetFocusHwnd = IntPtr.Zero;
            var gui = new GUITHREADINFO { cbSize = (uint)Marshal.SizeOf<GUITHREADINFO>() };
            if (GetGUIThreadInfo(GetWindowThreadProcessId(hwnd, out _), ref gui)) _targetFocusHwnd = gui.hwndFocus;
            GetWindowThreadProcessId(hwnd, out uint pid);

            string processName = "";
            try
            {
                var proc = Process.GetProcessById((int)pid);
                processName = proc.ProcessName;
            }
            catch { }

            StringBuilder titleBuilder = new StringBuilder(512);
            GetWindowText(hwnd, titleBuilder, titleBuilder.Capacity);
            string windowTitle = titleBuilder.ToString();

            string surroundingText = "";
            string browserUrl = "";
            TextSnapshot? selection = null;

            // Check if application is a browser and try to retrieve URL
            bool isBrowser = IsBrowserProcess(processName);

            try
            {
                AutomationElement? focused = null;
                try { if (GetForegroundWindow() == hwnd) focused = AutomationElement.FocusedElement; }
                catch { /* Native focused controls can still expose selection when global UIA focus is unavailable. */ }
                if (focused != null) selection = TextAccess.ReadSelection(focused);
                if (selection == null && _targetFocusHwnd != IntPtr.Zero)
                {
                    var nativeFocused = AutomationElement.FromHandle(_targetFocusHwnd);
                    var nativeSelection = nativeFocused == null ? null : TextAccess.ReadSelection(nativeFocused);
                    if (nativeSelection != null) { focused = nativeFocused; selection = nativeSelection; }
                }
                _targetElement = focused;
                if (focused != null && !focused.Current.IsPassword)
                {
                    _targetSnapshot = selection;
                    // 1. TextPattern (Notepad, Word, modern editors)
                    if (focused.TryGetCurrentPattern(TextPattern.Pattern, out object? tpObj) && tpObj is TextPattern tp)
                    {
                        var selections = tp.GetSelection();
                        if (selections != null && selections.Length > 0)
                        {
                            var clone = selections[0].Clone();
                            clone.ExpandToEnclosingUnit(TextUnit.Paragraph);
                            surroundingText = clone.GetText(300);
                        }
                    }
                    // 2. ValuePattern (Input textboxes, web form inputs)
                    else if (focused.TryGetCurrentPattern(ValuePattern.Pattern, out object? vpObj) && vpObj is ValuePattern vp)
                    {
                        surroundingText = vp.Current.Value;
                    }
                }

                // If browser, find AddressBar URL
                if (isBrowser)
                {
                    browserUrl = ExtractBrowserUrl(hwnd);
                }
            }
            catch (Exception error)
            {
                if (Environment.GetEnvironmentVariable("OWLIO_HELPER_DIAGNOSTICS") == "1") Console.Error.WriteLine(error);
            }

            EmitMessage(new
            {
                type = "context_result",
                requestId,
                processName,
                windowTitle,
                browserUrl,
                surroundingText = surroundingText.Length > 400 ? surroundingText.Substring(0, 400) : surroundingText,
                beforeText = selection == null ? null : selection.Text[..selection.Start][Math.Max(0,selection.Start-300)..],
                afterText = selection == null ? null : selection.Text[selection.End..][..Math.Min(300,selection.Text.Length-selection.End)],
                selectedText = selection == null ? null : selection.Text[selection.Start..selection.End]
            });
        }
        catch (Exception ex)
        {
            EmitMessage(new
            {
                type = "context_result",
                requestId,
                processName = "unknown",
                windowTitle = "",
                browserUrl = "",
                surroundingText = "",
                error = ex.Message
            });
        }
    }

    private static bool IsBrowserProcess(string name)
    {
        string lower = name.ToLowerInvariant();
        return lower is "chrome" or "msedge" or "brave" or "firefox" or "opera" or "vivaldi" or "arc";
    }

    private static string ExtractBrowserUrl(IntPtr hwnd)
    {
        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return "";

            // Search for edit control in browser toolbar (usually address bar)
            var cond = new AndCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                new PropertyCondition(AutomationElement.IsKeyboardFocusableProperty, true)
            );

            var edits = root.FindAll(TreeScope.Descendants, cond);
            foreach (AutomationElement edit in edits)
            {
                if (edit.TryGetCurrentPattern(ValuePattern.Pattern, out object? vp) && vp is ValuePattern valuePattern)
                {
                    string val = valuePattern.Current.Value;
                    if (val.Contains(".") || val.StartsWith("http") || val.StartsWith("localhost"))
                    {
                        return val;
                    }
                }
            }
        }
        catch { }
        return "";
    }

    private static void HandlePaste(string textToPaste, string requestId, string targetId, long deadline, bool learn = false, string? expectedSelection = null)
    {
        // The context ID prevents a cancelled/late request from pasting into another recording's window.
        if (targetId != _targetId || string.IsNullOrEmpty(targetId))
        {
            EmitMessage(new { type = "paste_completed", requestId, success = false, error = "The selected window changed. Select your text field and retry." });
            return;
        }
        IntPtr hwnd = _targetHwnd;
        IntPtr focusHwnd = _targetFocusHwnd;
        AutomationElement? element = _targetElement;
        var originalSnapshot = _targetSnapshot;
        Thread staThread = new Thread(() =>
        {
            try
            {
                if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= deadline) throw new InvalidOperationException("Text insertion timed out. Your words are on the clipboard; use Ctrl+V.");
                if (!IsWindow(hwnd)) throw new InvalidOperationException("The dictation window was closed. Your text is on the clipboard.");
                // Clipboard operations must succeed before sending any keys.
                Exception? clipboardError = null;
                for (int retry = 0; retry < 5; retry++)
                {
                    try { Clipboard.SetText(textToPaste); clipboardError = null; break; }
                    catch (Exception ex) { clipboardError = ex; Thread.Sleep(30); }
                }
                if (clipboardError != null) throw new InvalidOperationException("Clipboard is busy. Please retry.", clipboardError);

                // Establish this STA thread's input queue before attaching to the target.
                Application.DoEvents();
                uint currentThread = GetCurrentThreadId();
                uint targetThread = GetWindowThreadProcessId(hwnd, out _);
                uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out _);
                bool attachedTarget = false;
                bool attachedForeground = false;
                try
                {
                    if (targetThread != currentThread) attachedTarget = AttachThreadInput(currentThread, targetThread, true);
                    if (foregroundThread != 0 && foregroundThread != currentThread && foregroundThread != targetThread)
                        attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
                    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
                    BringWindowToTop(hwnd);
                    SetForegroundWindow(hwnd);
                    for (int retry = 0; retry < 10 && GetForegroundWindow() != hwnd; retry++) Thread.Sleep(20);
                    if (GetForegroundWindow() != hwnd) throw new InvalidOperationException("Cannot focus your text window. Text is on the clipboard; use Ctrl+V.");
                    if (focusHwnd != IntPtr.Zero && IsWindow(focusHwnd)) SetFocus(focusHwnd);
                }
                finally
                {
                    if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
                    if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
                }
                if (element != null)
                {
                    try { element.SetFocus(); }
                    catch (ElementNotAvailableException) { throw new InvalidOperationException("Your selected text field is no longer available. Text is on the clipboard."); }
                    catch (InvalidOperationException) { /* Native child focus remains available for controls without UIA focus support. */ }
                }
                // Browser renderers can replace their native child window while keeping
                // the same editable UIA element. Verify that element as well as HWND.
                bool restored = false;
                for (int retry = 0; retry < 8; retry++)
                {
                    if (GetForegroundWindow() != hwnd) break;
                    var gui = new GUITHREADINFO { cbSize = (uint)Marshal.SizeOf<GUITHREADINFO>() };
                    bool nativeMatch = focusHwnd != IntPtr.Zero && GetGUIThreadInfo(targetThread, ref gui) && gui.hwndFocus == focusHwnd;
                    bool elementMatch = false;
                    if (element != null)
                    {
                        try { elementMatch = element.GetRuntimeId().SequenceEqual(AutomationElement.FocusedElement.GetRuntimeId()); }
                        catch (ElementNotAvailableException) { }
                        catch (InvalidOperationException) { }
                    }
                    if (nativeMatch || elementMatch) { restored = true; break; }
                    // Give asynchronous UIA focus requests time to settle, before any keys.
                    Thread.Sleep(25);
                }
                if (!restored)
                    throw new InvalidOperationException("Cannot restore your selected text field. Text is on the clipboard; use Ctrl+V.");

                // A held Alt/Shift/Win key changes Ctrl+V into another shortcut.
                int wait = 0;
                while (ModifiersPressed() && wait++ < 50) Thread.Sleep(20);
                if (ModifiersPressed()) throw new InvalidOperationException("Release modifier keys and try again. Text is on the clipboard.");
                if (GetForegroundWindow() != hwnd) throw new InvalidOperationException("Window focus changed before pasting. Text is on the clipboard.");
                // A slow UIA provider must not inject text after the host has given up.
                if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= deadline) throw new InvalidOperationException("Text insertion timed out. Your words are on the clipboard; use Ctrl+V.");
                var snapshot = (learn || expectedSelection != null) && element != null ? TextAccess.ReadSelection(element) : null;
                if (expectedSelection != null && (snapshot == null || originalSnapshot == null ||
                    snapshot.Text != originalSnapshot.Text || snapshot.Start != originalSnapshot.Start || snapshot.End != originalSnapshot.End ||
                    snapshot.Start == snapshot.End || snapshot.Text[snapshot.Start..snapshot.End] != TextAccess.Normalize(expectedSelection)))
                    throw new InvalidOperationException("The selected rewrite text changed. The revision is on the clipboard; select the intended text and paste it manually.");
                // Optional UIA reads may be slow; recheck the insertion deadline and focus.
                if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= deadline || GetForegroundWindow()!=hwnd) throw new InvalidOperationException("Text insertion timed out or focus changed. Your words are on the clipboard; use Ctrl+V.");
                SendCtrlV();
                EmitMessage(new { type = "paste_completed", requestId, success = true });
                try { if (snapshot != null && element != null) EditObserver.Begin(hwnd,element,snapshot,textToPaste,targetId,EmitMessage); }
                catch { /* Text was already inserted; optional learning never changes that result. */ }
            }
            catch (Exception ex)
            {
                EmitMessage(new { type = "paste_completed", requestId, success = false, error = ex.Message });
            }
        });
        staThread.SetApartmentState(ApartmentState.STA);
        staThread.Start();
        staThread.Join();
    }

    private static bool ModifiersPressed() =>
        (GetAsyncKeyState(0x10) & 0x8000) != 0 || (GetAsyncKeyState(0x11) & 0x8000) != 0 ||
        (GetAsyncKeyState(0x12) & 0x8000) != 0 || (GetAsyncKeyState(0x5B) & 0x8000) != 0 ||
        (GetAsyncKeyState(0x5C) & 0x8000) != 0;

    private static void SendCtrlV()
    {
        var inputs = new[]
        {
            KeyInput(VK_CONTROL, 0), KeyInput(VK_V, 0),
            KeyInput(VK_V, KEYEVENTF_KEYUP), KeyInput(VK_CONTROL, KEYEVENTF_KEYUP)
        };
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (sent != inputs.Length)
        {
            // Always release synthetic keys after a partial send.
            var release = new[] { KeyInput(VK_V, KEYEVENTF_KEYUP), KeyInput(VK_CONTROL, KEYEVENTF_KEYUP) };
            SendInput((uint)release.Length, release, Marshal.SizeOf<INPUT>());
            throw new InvalidOperationException("Windows blocked text insertion. Text is on the clipboard; paste it manually.");
        }
    }

    private static INPUT KeyInput(ushort key, uint flags) =>
        new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = key, dwFlags = flags } } };

    private static void EmitMessage(object obj)
    {
        string json = JsonSerializer.Serialize(obj);
        Console.WriteLine(json);
    }

    #endregion

    #region Low-Level Keyboard Hook

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using Process curProcess = Process.GetCurrentProcess();
        using ProcessModule? curModule = curProcess.MainModule;
        IntPtr moduleHandle = curModule != null ? GetModuleHandle(curModule.ModuleName) : IntPtr.Zero;
        return SetWindowsHookEx(WH_KEYBOARD_LL, proc, moduleHandle, 0);
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (_allowTestInput || (Marshal.ReadInt32(lParam, 8) & 0x10) == 0))
        {
            bool down = wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN;
            bool up = wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP;
            if ((down || up) && _shortcuts.OnKey(Marshal.ReadInt32(lParam), down, GetForegroundWindow().ToInt64().ToString()))
                return (IntPtr)1;
        }
        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    #endregion

    #region Win32 P/Invoke Definitions

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_V = 0x56;

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public KEYBDINPUT ki;
        [FieldOffset(0)]
        public MOUSEINPUT mi; // INPUT's union must include mouse data to have the Win32 ABI size.
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GUITHREADINFO
    {
        public uint cbSize, flags;
        public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
        public int left, top, right, bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, [MarshalAs(UnmanagedType.Bool)] bool fAttach);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);

    #endregion
}
