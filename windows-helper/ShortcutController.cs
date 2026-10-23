using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Timer = System.Threading.Timer;

namespace WindowsHelper;

// Only native hook observations can report a shortcut as verified.
internal sealed class ShortcutController
{
    private record Binding(string Name, int Modifiers, int Key);
    private readonly object _gate = new();
    private readonly Action<object> _emit;
    private readonly HashSet<int> _keys = new();
    private readonly HashSet<int> _suppressed = new();
    private Binding _binding = Parse("F8");
    private bool _hold = true, _pressed, _capture, _testPressed;
    private Binding? _test;
    private bool _testHold;
    private int _testPresses;
    private string? _candidate;
    private Timer? _timer;
    private int _activityGeneration;

    public ShortcutController(Action<object> emit) => _emit = emit;

    public string Configure(string key, bool hold)
    {
        var binding = Parse(key);
        lock (_gate) { _binding = binding; _hold = hold; _pressed = false; }
        return binding.Name;
    }

    public void BeginCapture()
    {
        lock (_gate)
        {
            ClearActivity(); _capture = true; _candidate = null;
            int generation = _activityGeneration;
            _timer = new Timer(_ => CancelIfCurrent(generation, "Shortcut recording timed out."), null, 30000, Timeout.Infinite);
        }
    }

    public void BeginTest(string key, bool hold)
    {
        var binding = Parse(key);
        lock (_gate)
        {
            ClearActivity(); _test = binding; _testHold = hold; _testPresses = 0; _testPressed = false;
            int generation = _activityGeneration;
            _timer = new Timer(_ => CancelIfCurrent(generation, "No matching shortcut detected. Try again."), null, 15000, Timeout.Infinite);
        }
    }

    public void Cancel(string reason = "Cancelled")
    {
        lock (_gate)
        {
            bool active = _capture || _test != null;
            ClearActivity();
            if (active) Event("shortcut_cancelled", message: reason);
        }
    }

    private void ClearActivity()
    {
        _activityGeneration++;
        _capture = false; _test = null; _timer?.Dispose(); _timer = null;
        _pressed = false; _testPressed = false;
    }

    private void CancelIfCurrent(int generation, string reason)
    {
        lock (_gate) { if (generation == _activityGeneration) Cancel(reason); }
    }

    public bool OnKey(int key, bool down, string targetHwnd)
    {
        lock (_gate)
        {
            bool wasDown = _keys.Contains(key);
            if (down) _keys.Add(key); else _keys.Remove(key);
            bool swallowedRelease = !down && _suppressed.Remove(key);
            if ((_capture || _test != null) && key == 0x1B && down && _keys.All(held => Modifier(held) == 0))
            {
                _suppressed.Add(key); Cancel(); return true;
            }
            if (_capture)
            {
                if (down)
                {
                    _suppressed.Add(key);
                    string candidate = Candidate(key);
                    bool valid = true;
                    try { Parse(candidate); } catch { valid = false; }
                    if (valid) _candidate = candidate;
                    else _candidate = null;
                    Event("shortcut_candidate", candidate, valid: valid);
                }
                else if (_candidate != null)
                {
                    string captured = Parse(_candidate).Name;
                    ClearActivity(); Event("shortcut_captured", captured);
                }
                return true;
            }
            if (_test != null)
            {
                var test = _test;
                if (!_testPressed && down && !wasDown && Matches(test, true))
                {
                    _testPressed = true; _testPresses++;
                    bool suppress = SuppressTrigger(test, key);
                    if (!_testHold && _testPresses == 2) { ClearActivity(); Event("shortcut_tested", test.Name, "toggle"); }
                    else Event("shortcut_test_progress", test.Name, message: _testHold ? "Release the shortcut to finish." : "Press it again to verify stopping.");
                    return suppress;
                }
                if (_testPressed && !Matches(test, false))
                {
                    _testPressed = false;
                    if (_testHold) { ClearActivity(); Event("shortcut_tested", test.Name, "push_to_talk"); }
                    return swallowedRelease;
                }
                return swallowedRelease || (_testPressed && Relevant(test, key));
            }
            if (!_pressed && down && !wasDown && Matches(_binding, true))
            {
                _pressed = true;
                bool suppress = SuppressTrigger(_binding, key);
                _emit(new { type = "event", name = _hold ? "hotkey_down" : "hotkey_toggle", targetHwnd });
                return suppress;
            }
            if (_pressed && !Matches(_binding, false))
            {
                _pressed = false;
                if (_hold) _emit(new { type = "event", name = "hotkey_up" });
                return swallowedRelease;
            }
            return swallowedRelease || (_pressed && Relevant(_binding, key));
        }
    }

    private bool Matches(Binding binding, bool exact)
    {
        int mods = _keys.Aggregate(0, (mask, key) => mask | Modifier(key));
        int expected = binding.Modifiers | Modifier(binding.Key);
        return (exact ? mods == expected : (mods & expected) == expected) && (binding.Key == 0 || _keys.Contains(binding.Key));
    }
    private static bool Relevant(Binding binding, int key) => key == binding.Key || (Modifier(key) & binding.Modifiers) != 0;
    private bool SuppressTrigger(Binding binding, int key)
    {
        // If Win was delivered before a modifier-only chord completes, deliver the
        // final modifier too. Windows then sees the chord and does not open Start.
        bool forward = binding.Key == 0 && Modifier(key) != 8 && _keys.Any(held => Modifier(held) == 8 && !_suppressed.Contains(held));
        if (!forward) _suppressed.Add(key);
        return !forward;
    }
    private static int Modifier(int key) => key switch { 0x11 or 0xA2 or 0xA3 => 1, 0x12 or 0xA4 or 0xA5 => 2, 0x10 or 0xA0 or 0xA1 => 4, 0x5B or 0x5C => 8, _ => 0 };
    private void Event(string name, string? shortcut = null, string? mode = null, string? message = null, bool valid = true) =>
        _emit(new { type = "event", name, shortcut, mode, message, valid });

    private string Candidate(int key)
    {
        int mods = _keys.Aggregate(0, (mask, held) => mask | Modifier(held));
        if (mods == 2 && _keys.Contains(0xA5)) return "RALT";
        if (mods == 1 && _keys.Contains(0xA3)) return "RCTRL";
        var parts = ModifierNames(mods);
        if (Modifier(key) == 0) parts.Add(KeyName(key));
        return string.Join("+", parts);
    }

    private static List<string> ModifierNames(int mask)
    {
        var parts = new List<string>();
        if ((mask & 1) != 0) parts.Add("Ctrl");
        if ((mask & 2) != 0) parts.Add("Alt");
        if ((mask & 4) != 0) parts.Add("Shift");
        if ((mask & 8) != 0) parts.Add("Win");
        return parts;
    }

    private static readonly Dictionary<string, int> Special = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Space"] = 0x20, ["Enter"] = 0x0D, ["Tab"] = 0x09, ["Escape"] = 0x1B,
        ["Backspace"] = 0x08, ["Delete"] = 0x2E, ["Insert"] = 0x2D, ["Home"] = 0x24, ["End"] = 0x23,
        ["PageUp"] = 0x21, ["PageDown"] = 0x22, ["Left"] = 0x25, ["Up"] = 0x26, ["Right"] = 0x27, ["Down"] = 0x28,
        ["RALT"] = 0xA5, ["RCTRL"] = 0xA3,
    };

    private static string KeyName(int key)
    {
        if (key >= 0x70 && key <= 0x87) return "F" + (key - 0x6F);
        if (key >= 0x30 && key <= 0x39 || key >= 0x41 && key <= 0x5A) return ((char)key).ToString();
        return Special.FirstOrDefault(pair => pair.Value == key).Key ?? "Unsupported";
    }

    private static Binding Parse(string value)
    {
        if (value.Length > 100) throw new ArgumentException("Shortcut is too long.");
        int mask = 0, key = 0;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string token in value.Split('+').Select(part => part.Trim()))
        {
            if (!seen.Add(token)) throw new ArgumentException("Duplicate shortcut key.");
            int modifier = token.ToUpperInvariant() switch { "CTRL" or "CONTROL" => 1, "ALT" => 2, "SHIFT" => 4, "WIN" or "META" or "WINDOWS" => 8, _ => 0 };
            if (modifier != 0) { if ((mask & modifier) != 0) throw new ArgumentException("Duplicate modifier."); mask |= modifier; continue; }
            if (key != 0) throw new ArgumentException("Use one main key per shortcut.");
            if (Special.TryGetValue(token, out int special)) key = special;
            else if (token.Length == 1 && char.IsAsciiLetterOrDigit(token[0])) key = char.ToUpperInvariant(token[0]);
            else if (token.StartsWith("F", StringComparison.OrdinalIgnoreCase) && int.TryParse(token[1..], out int f) && f >= 1 && f <= 24) key = 0x6F + f;
            else throw new ArgumentException("Unsupported shortcut key.");
        }
        if (key == 0 && System.Numerics.BitOperations.PopCount((uint)mask) < 2) throw new ArgumentException("Combine at least two modifiers.");
        if (mask == 0 && key != 0 && !(key >= 0x70 && key <= 0x87 || key == 0x20 || key == 0xA5 || key == 0xA3)) throw new ArgumentException("Add a modifier to keep normal typing available.");
        if (mask == 3 && key == 0x2E || mask == 8 && key == 0x4C) throw new ArgumentException("Windows reserves this combination.");
        var names = ModifierNames(mask);
        if (key != 0) names.Add(KeyName(key));
        string name = string.Join("+", names);
        return new Binding(name == "Space" ? "SPACE" : name, mask, key);
    }
}
