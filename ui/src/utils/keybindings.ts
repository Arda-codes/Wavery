/**
 * Dynamic Keybinding Parser and Matcher for Wavery.
 *
 * Supports parsing key combos (e.g. "Ctrl+Right", "Space", "Shift+Left", "Ctrl+K", "F11", "Alt+L", "M")
 * and matching incoming KeyboardEvent instances against configured shortcuts.
 */

interface ParsedKeyCombo {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/**
 * Normalizes a key name to standard representations.
 */
export function normalizeKey(k: string): string {
  const trimmed = k.trim();
  if (trimmed === "" || trimmed === " " || trimmed.toLowerCase() === "space") {
    return "Space";
  }

  const lower = trimmed.toLowerCase();
  switch (lower) {
    case "arrowright":
    case "right":
      return "ArrowRight";
    case "arrowleft":
    case "left":
      return "ArrowLeft";
    case "arrowup":
    case "up":
      return "ArrowUp";
    case "arrowdown":
    case "down":
      return "ArrowDown";
    case "esc":
    case "escape":
      return "Escape";
    case "enter":
    case "return":
      return "Enter";
    default:
      if (trimmed.length === 1) {
        return trimmed.toUpperCase();
      }
      return trimmed;
  }
}

/**
 * Parses a string combination into modifier flags and target key.
 */
export function parseKeyCombo(combo: string): ParsedKeyCombo {
  if (!combo || typeof combo !== "string") {
    return { ctrl: false, meta: false, alt: false, shift: false, key: "" };
  }

  const parts = combo.split("+").map((p) => p.trim());
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let key = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();

    if (lower === "ctrl" || lower === "control") {
      ctrl = true;
    } else if (lower === "cmd" || lower === "command" || lower === "meta") {
      meta = true;
    } else if (lower === "alt" || lower === "option") {
      alt = true;
    } else if (lower === "shift") {
      shift = true;
    } else if (part.length > 0) {
      key = part;
    }
  }

  return {
    ctrl,
    meta,
    alt,
    shift,
    key: normalizeKey(key),
  };
}

/**
 * Detects if current platform is macOS / iOS.
 */
export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent)
  );
}

/**
 * Formats a key combo string for display with platform-native symbols.
 */
export function formatKeyCombo(combo: string, isMac: boolean = isMacPlatform()): string {
  if (!combo) return "";
  const parsed = parseKeyCombo(combo);
  if (!parsed.key) return combo;

  if (isMac) {
    let s = "";
    if (parsed.ctrl && parsed.meta) {
      s += "⌃";
    }
    if (parsed.alt) s += "⌥";
    if (parsed.shift) s += "⇧";
    if (parsed.meta || parsed.ctrl) {
      s += "⌘";
    }
    const keyDisplay =
      parsed.key === "ArrowRight"
        ? "→"
        : parsed.key === "ArrowLeft"
        ? "←"
        : parsed.key === "ArrowUp"
        ? "↑"
        : parsed.key === "ArrowDown"
        ? "↓"
        : parsed.key;
    return `${s}${keyDisplay}`;
  } else {
    const parts: string[] = [];
    if (parsed.ctrl) parts.push("Ctrl");
    if (parsed.alt) parts.push("Alt");
    if (parsed.shift) parts.push("Shift");
    if (parsed.meta) parts.push("Win");
    const keyDisplay =
      parsed.key === "ArrowRight"
        ? "Right"
        : parsed.key === "ArrowLeft"
        ? "Left"
        : parsed.key === "ArrowUp"
        ? "Up"
        : parsed.key === "ArrowDown"
        ? "Down"
        : parsed.key;
    parts.push(keyDisplay);
    return parts.join("+");
  }
}

/**
 * Determines whether a KeyboardEvent matches a configured key combination string.
 */
export function matchesKeyCombo(
  e: KeyboardEvent,
  combo: string,
  isMac: boolean = false
): boolean {
  if (!combo) return false;

  const parsed = parseKeyCombo(combo);
  if (!parsed.key) return false;

  // Key match check
  const eventKeyNorm = normalizeKey(e.key);
  const parsedKeyNorm = parsed.key;

  const keyMatches =
    eventKeyNorm.toLowerCase() === parsedKeyNorm.toLowerCase() ||
    (eventKeyNorm === "Space" && (e.code === "Space" || e.key === " ")) ||
    (parsedKeyNorm === "Space" && (e.code === "Space" || e.key === " "));

  if (!keyMatches) return false;

  // Modifier checks
  const eventCtrl = Boolean(e.ctrlKey);
  const eventMeta = Boolean(e.metaKey);
  const eventAlt = Boolean(e.altKey);
  const eventShift = Boolean(e.shiftKey);

  // On Mac, Ctrl and Meta/Cmd are often used interchangeably in shortcut mappings
  if (isMac) {
    const wantsCtrlOrMeta = parsed.ctrl || parsed.meta;
    const hasCtrlOrMeta = eventCtrl || eventMeta;

    if (wantsCtrlOrMeta !== hasCtrlOrMeta) return false;
  } else {
    if (parsed.ctrl !== eventCtrl) return false;
    if (parsed.meta !== eventMeta) return false;
  }

  if (parsed.alt !== eventAlt) return false;
  if (parsed.shift !== eventShift) return false;

  return true;
}

/**
 * Helper to check if user is focused inside an editable input element.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  return false;
}
