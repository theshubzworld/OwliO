using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace WindowsHelper;

internal record TextSnapshot(string Text, int Start, int End);

internal static class TextAccess
{
    internal const int MaxText = 8000;
    internal static string Normalize(string text) => text.Replace("\r\n", "\n").Replace("\r", "\n");
    internal static string? ReadText(AutomationElement element)
    {
        try
        {
            if (element.Current.IsPassword) return null;
            string value;
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var pattern) && pattern is TextPattern text)
                value = text.DocumentRange.GetText(MaxText + 1);
            else if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && pattern is ValuePattern input && !input.Current.IsReadOnly)
                value = input.Current.Value;
            else return null;
            return value.Length <= MaxText ? Normalize(value) : null;
        }
        catch { return null; }
    }
    internal static TextSnapshot? ReadSelection(AutomationElement element)
    {
        try
        {
            var value = ReadText(element);
            if (value == null) return null;
            int start, end;
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var pattern) && pattern is TextPattern text)
            {
                var selection = text.GetSelection();
                if (selection.Length != 1) return null;
                var prefix = text.DocumentRange.Clone();
                prefix.MoveEndpointByRange(TextPatternRangeEndpoint.End, selection[0], TextPatternRangeEndpoint.Start);
                start = Normalize(prefix.GetText(MaxText + 1)).Length;
                var selected = Normalize(selection[0].GetText(MaxText + 1));
                end = start + selected.Length;
                if (start > value.Length || end > value.Length || value.Substring(start, end-start) != selected) return null;
            }
            else
            {
                var handle = new IntPtr(element.Current.NativeWindowHandle);
                var name = new StringBuilder(256);
                GetClassName(handle, name, name.Capacity);
                if (handle == IntPtr.Zero || !name.ToString().Contains("EDIT", StringComparison.OrdinalIgnoreCase)) return null;
                // EM_GETSEL's packed result is sufficient within the 8,000-character bound.
                // A hung target must not stall the helper's shortcut/context command reader.
                if (SendMessageTimeout(handle,0x00B0,IntPtr.Zero,IntPtr.Zero,0x0002,100,out var packed)==IntPtr.Zero) return null;
                start = (int)(packed.ToInt64() & 0xffff);
                end = (int)((packed.ToInt64() >> 16) & 0xffff);
                var raw = element.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                if (raw == null) return null;
                var original = raw.Current.Value;
                if (start<0 || end<start || end>original.Length) return null;
                start = Normalize(original[..start]).Length;
                end = Normalize(original[..end]).Length;
            }
            return new TextSnapshot(value,start,end);
        }
        catch { return null; }
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam,uint flags,uint timeout,out IntPtr result);
}

internal static class EditObserver
{
    private static int _generation;
    internal static void Cancel() => Interlocked.Increment(ref _generation);
    internal static void Begin(IntPtr hwnd, AutomationElement element, TextSnapshot snapshot, string inserted, string targetId, Action<object> emit)
    {
        var generation = Interlocked.Increment(ref _generation);
        var prefix = snapshot.Text[..snapshot.Start];
        var suffix = snapshot.Text[snapshot.End..];
        var original = TextAccess.Normalize(inserted);
        if (original.Length>5000) return;
        bool Current()
        {
            try { return generation == Volatile.Read(ref _generation) && GetForegroundWindow() == hwnd && element.GetRuntimeId().SequenceEqual(AutomationElement.FocusedElement.GetRuntimeId()) && !element.Current.IsPassword; }
            catch { return false; }
        }
        var thread = new Thread(() =>
        {
            try
            {
                var expected = prefix + original + suffix;
                var verified = false;
                for (int attempt=0;attempt<15 && Current();attempt++)
                {
                    if (TextAccess.ReadText(element)==expected) { verified=true; break; }
                    Thread.Sleep(100);
                }
                if (!verified) return; // Do not learn from an unverified paste.
                emit(new {type="event",name="learning-observing",targetId});
                var timer = System.Diagnostics.Stopwatch.StartNew();
                var last = original;
                long changedAt = 0;
                while (timer.ElapsedMilliseconds<30000 && Current())
                {
                    Thread.Sleep(200);
                    if (!Current()) return;
                    var value = TextAccess.ReadText(element);
                    if (value == null || !value.StartsWith(prefix,StringComparison.Ordinal) || !value.EndsWith(suffix,StringComparison.Ordinal) || value.Length<prefix.Length+suffix.Length) return;
                    var edited = value.Substring(prefix.Length,value.Length-prefix.Length-suffix.Length);
                    if (edited.Length>5000 || edited.Length==0) return;
                    if (edited!=last) { last=edited; changedAt=timer.ElapsedMilliseconds; }
                    else if (last!=original && timer.ElapsedMilliseconds-changedAt>=1200 && Current())
                    {
                        emit(new {type="event",name="learning-correction",targetId,originalText=original,editedText=last});
                        return;
                    }
                }
            }
            catch { /* Optional learning cannot interrupt dictation or emit a paste failure. */ }
        }) { IsBackground=true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
    }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
}
