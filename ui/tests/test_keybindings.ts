/**
 * Automated Unit & Boundary Test Suite: Dynamic Keybinding Parser and Matcher
 * Covers parsing, normalization, modifier detection, platform handling, and editable element filtering.
 */

import {
  parseKeyCombo,
  matchesKeyCombo,
  isEditableTarget,
  normalizeKey,
} from "../src/utils/keybindings";

export function runKeybindingsTests(): void {
  console.log("\n--- [Running Keybindings Tests] ---");

  // 1. Key normalization tests
  assert(normalizeKey(" ") === "Space", "Space bar character normalizes to 'Space'");
  assert(normalizeKey("space") === "Space", "'space' string normalizes to 'Space'");
  assert(normalizeKey("right") === "ArrowRight", "'right' normalizes to 'ArrowRight'");
  assert(normalizeKey("arrowright") === "ArrowRight", "'arrowright' normalizes to 'ArrowRight'");
  assert(normalizeKey("left") === "ArrowLeft", "'left' normalizes to 'ArrowLeft'");
  assert(normalizeKey("up") === "ArrowUp", "'up' normalizes to 'ArrowUp'");
  assert(normalizeKey("down") === "ArrowDown", "'down' normalizes to 'ArrowDown'");
  assert(normalizeKey("esc") === "Escape", "'esc' normalizes to 'Escape'");
  assert(normalizeKey("m") === "M", "'m' normalizes to uppercase 'M'");
  assert(normalizeKey("f") === "F", "'f' normalizes to uppercase 'F'");
  assert(normalizeKey("l") === "L", "'l' normalizes to uppercase 'L'");

  // 2. parseKeyCombo tests
  const combo1 = parseKeyCombo("Ctrl+Right");
  assert(combo1.ctrl && !combo1.alt && !combo1.shift && !combo1.meta, "Ctrl+Right modifiers parsed");
  assert(combo1.key === "ArrowRight", "Ctrl+Right key parsed");

  const combo2 = parseKeyCombo("Shift+Left");
  assert(combo2.shift && !combo2.ctrl && !combo2.alt && !combo2.meta, "Shift+Left modifiers parsed");
  assert(combo2.key === "ArrowLeft", "Shift+Left key parsed");

  const combo3 = parseKeyCombo("Alt+L");
  assert(combo3.alt && !combo3.ctrl && !combo3.shift && !combo3.meta, "Alt+L modifiers parsed");
  assert(combo3.key === "L", "Alt+L key parsed");

  const combo4 = parseKeyCombo("Ctrl+Shift+K");
  assert(combo4.ctrl && combo4.shift && !combo4.alt && !combo4.meta, "Ctrl+Shift+K modifiers parsed");
  assert(combo4.key === "K", "Ctrl+Shift+K key parsed");

  const combo5 = parseKeyCombo("Cmd+K");
  assert(combo5.meta && !combo5.ctrl && !combo5.alt && !combo5.shift, "Cmd+K parsed meta modifier");
  assert(combo5.key === "K", "Cmd+K key parsed");

  const comboEmpty = parseKeyCombo("");
  assert(comboEmpty.key === "" && !comboEmpty.ctrl, "Empty combo parsed safely");

  // 3. matchesKeyCombo tests
  function createKeyEvent(opts: {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  }): KeyboardEvent {
    return {
      key: opts.key,
      code: opts.code || opts.key,
      ctrlKey: Boolean(opts.ctrlKey),
      metaKey: Boolean(opts.metaKey),
      altKey: Boolean(opts.altKey),
      shiftKey: Boolean(opts.shiftKey),
    } as unknown as KeyboardEvent;
  }

  // Space play/pause
  const spaceEvt = createKeyEvent({ key: " ", code: "Space" });
  assert(matchesKeyCombo(spaceEvt, "Space"), "Space event matches 'Space' keybind");
  assert(!matchesKeyCombo(spaceEvt, "Ctrl+Space"), "Space without Ctrl does not match 'Ctrl+Space'");

  // Ctrl+Right next track
  const ctrlRightEvt = createKeyEvent({ key: "ArrowRight", ctrlKey: true });
  assert(matchesKeyCombo(ctrlRightEvt, "Ctrl+Right"), "Ctrl+ArrowRight matches 'Ctrl+Right'");
  assert(!matchesKeyCombo(ctrlRightEvt, "Ctrl+Left"), "Ctrl+ArrowRight does not match 'Ctrl+Left'");
  assert(!matchesKeyCombo(ctrlRightEvt, "Right"), "Ctrl+ArrowRight does not match single 'Right'");

  // macOS Cmd+K / Ctrl+K
  const macCmdKEvt = createKeyEvent({ key: "k", metaKey: true });
  assert(matchesKeyCombo(macCmdKEvt, "Ctrl+K", true), "macOS Cmd+K matches 'Ctrl+K' when isMac=true");
  assert(matchesKeyCombo(macCmdKEvt, "Cmd+K", true), "macOS Cmd+K matches 'Cmd+K' when isMac=true");

  // Single keys M, F, L
  const keyMEvt = createKeyEvent({ key: "m" });
  assert(matchesKeyCombo(keyMEvt, "M"), "Single 'm' key matches 'M'");
  assert(!matchesKeyCombo(createKeyEvent({ key: "m", ctrlKey: true }), "M"), "Ctrl+M does not match single 'M'");

  const keyFEvt = createKeyEvent({ key: "f" });
  assert(matchesKeyCombo(keyFEvt, "F"), "Single 'f' key matches 'F'");

  const keyLEvt = createKeyEvent({ key: "l" });
  assert(matchesKeyCombo(keyLEvt, "L"), "Single 'l' key matches 'L'");

  // 4. isEditableTarget tests
  class MockElement {
    tagName: string;
    isContentEditable: boolean;
    constructor(tagName: string, isContentEditable: boolean = false) {
      this.tagName = tagName;
      this.isContentEditable = isContentEditable;
    }
  }

  // @ts-ignore
  global.HTMLElement = MockElement as any;

  assert(isEditableTarget(new MockElement("INPUT") as any), "INPUT element is editable target");
  assert(isEditableTarget(new MockElement("TEXTAREA") as any), "TEXTAREA element is editable target");
  assert(isEditableTarget(new MockElement("SELECT") as any), "SELECT element is editable target");
  assert(isEditableTarget(new MockElement("DIV", true) as any), "contentEditable DIV is editable target");
  assert(!isEditableTarget(new MockElement("DIV", false) as any), "Regular DIV is not editable target");
  assert(!isEditableTarget(new MockElement("BUTTON") as any), "BUTTON is not editable target");
  assert(!isEditableTarget(null), "null target is not editable target");

  console.log("  ✅ All Keybindings unit & boundary tests passed successfully.");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
