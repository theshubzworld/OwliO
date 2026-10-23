const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Win'];
const aliases: Record<string, string> = {
  CONTROL: 'Ctrl', CTRL: 'Ctrl', ALT: 'Alt', SHIFT: 'Shift', META: 'Win', WIN: 'Win', WINDOWS: 'Win',
  RIGHTALT: 'RALT', ALTGR: 'RALT', RALT: 'RALT', RIGHTCONTROL: 'RCTRL', RCTRL: 'RCTRL',
  SPACE: 'Space', SPACEBAR: 'Space', ENTER: 'Enter', TAB: 'Tab', ESC: 'Escape', ESCAPE: 'Escape',
  BACKSPACE: 'Backspace', DELETE: 'Delete', INSERT: 'Insert', HOME: 'Home', END: 'End',
  PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right',
};

export function normalizeShortcut(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error('Choose a shortcut.');
  const parts = value.split('+').map(part => {
    const token = part.trim().toUpperCase();
    if (aliases[token]) return aliases[token];
    if (/^[A-Z0-9]$/.test(token) || /^F([1-9]|1[0-9]|2[0-4])$/.test(token)) return token;
    throw new Error('Use Ctrl, Alt, Shift or Win with a letter, number, function key or navigation key.');
  });
  if (new Set(parts).size !== parts.length) throw new Error('Each key can appear only once.');
  const modifiers = modifierOrder.filter(key => parts.includes(key));
  const keys = parts.filter(key => !modifierOrder.includes(key));
  if (keys.length > 1 || (!keys.length && modifiers.length < 2)) throw new Error('Use one main key, or combine at least two modifier keys.');
  if (!modifiers.length && keys.length && !/^(F([1-9]|1[0-9]|2[0-4])|Space|RALT|RCTRL)$/.test(keys[0])) throw new Error('Add a modifier so normal typing keeps working.');
  const result = [...modifiers, ...keys].join('+');
  if (result === 'Ctrl+Alt+Delete' || result === 'Win+L') throw new Error('Choose a different shortcut; Windows reserves this combination.');
  // Preserve saved legacy names.
  return result === 'Space' ? 'SPACE' : result;
}

export function formatShortcut(value: string): string {
  return value.replace(/RALT/g, 'Right Alt').replace(/RCTRL/g, 'Right Ctrl').replace(/SPACE/g, 'Space').split('+').join(' + ');
}
