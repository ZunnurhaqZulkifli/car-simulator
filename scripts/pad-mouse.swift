// The phone pad's mouse: scripts/pad-relay.mjs builds this (swiftc, into storage/app/pad-mouse) and feeds it a line
// per action on stdin:
//   m dx dy   move the pointer by (dx, dy) points - dragging, while the button is held
//   c l|r     click the left / right button where the pointer is
//   d / u     hold / let go of the left button (dragging)
//   s dx dy   scroll by (dx, dy) pixels
//   t / a     answer "trusted 1|0": whether macOS lets this post input (Accessibility) - a: and show the system's
//             prompt to allow it if not
//   p         answer "at x y": where the pointer is (so the relay can see a nudge get through)
//   k name    what a trackpad's 3- and 4-finger gestures do, by the Mac's own shortcuts: space-left / space-right
//             (^← ^→), mission (^↑ Mission Control), expose (^↓ App Exposé), desktop (F11 Show Desktop), lookup
//             (^⌘D Look Up) - and apps opens Apps
//   y text    type the text (as characters, whatever the Mac's keyboard layout)
//   K key mods...  press a key by name - a letter, digit or , . / ; ' -, or esc delete tab return space left right
//             up down - with any of shift ctrl opt cmd held (shortcuts, by the US layout's key positions)
// macOS only delivers the events it posts once the process running the relay (node, or Terminal) has Accessibility
// access: System Settings > Privacy & Security > Accessibility
import ApplicationServices
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
func trusted(prompt: Bool) -> Bool {
  AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary) && CGPreflightPostEventAccess()
}
func at() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }
// kept on the screens: the nearest point of any display to where it would go
func onScreen(_ p: CGPoint) -> CGPoint {
  var ids = [CGDirectDisplayID](repeating: 0, count: 16), n: UInt32 = 0
  CGGetActiveDisplayList(16, &ids, &n)
  var best = p, bestD = Double.infinity
  for id in ids.prefix(Int(n)) {
    let b = CGDisplayBounds(id), q = CGPoint(x: min(max(p.x, b.minX), b.maxX - 1), y: min(max(p.y, b.minY), b.maxY - 1))
    let d = hypot(q.x - p.x, q.y - p.y)
    if d < bestD { best = q; bestD = d }
  }
  return best
}
func post(_ type: CGEventType, _ p: CGPoint, _ button: CGMouseButton = .left) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button)?.post(tap: .cghidEventTap)
}
// a key with its modifiers pressed round it, as a person would; arrows and F-keys carry the fn (and arrows the keypad)
// flag, as the keyboard's own do - the shortcuts are stored with them
let MODS: [(CGKeyCode, CGEventFlags)] = [(59, .maskControl), (55, .maskCommand), (56, .maskShift), (58, .maskAlternate)]
let ARROW: CGEventFlags = [.maskControl, .maskSecondaryFn, .maskNumericPad]
let KEYS: [String: (CGKeyCode, CGEventFlags)] = ["space-left": (123, ARROW), "space-right": (124, ARROW), "mission": (126, ARROW), "expose": (125, ARROW),
  "desktop": (103, .maskSecondaryFn), "lookup": (2, [.maskControl, .maskCommand])]
func press(_ key: CGKeyCode, _ flags: CGEventFlags) {
  let mods = MODS.filter { flags.contains($0.1) }
  var down: CGEventFlags = []
  func send(_ code: CGKeyCode, _ isDown: Bool, _ f: CGEventFlags) { let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: isDown); e?.flags = f; e?.post(tap: .cghidEventTap) }
  for (code, f) in mods { down.insert(f); send(code, true, down) }
  send(key, true, flags); send(key, false, flags)
  for (code, f) in mods.reversed() { down.remove(f); send(code, false, down) }
}
let KEYCODES: [String: CGKeyCode] = ["a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
  "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "o": 31,
  "u": 32, "i": 34, "p": 35, "return": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48,
  "space": 49, "delete": 51, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126]
let FLAGS: [String: CGEventFlags] = ["shift": .maskShift, "ctrl": .maskControl, "opt": .maskAlternate, "cmd": .maskCommand]
func type(_ text: String) {
  let u = Array(text.utf16)
  if u.isEmpty { return }
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
    e?.flags = []
    e?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u)
    e?.post(tap: .cghidEventTap)
  }
}
var held = false
while let line = readLine() {
  let w = line.split(separator: " "), n = w.dropFirst().compactMap { Double($0) }.map { max(-2000, min(2000, $0)) }
  switch w.first {
  case "m" where n.count == 2:
    let p = at()
    post(held ? .leftMouseDragged : .mouseMoved, onScreen(CGPoint(x: p.x + n[0], y: p.y + n[1])))
  case "c":
    let right = w.count > 1 && w[1] == "r", p = at()
    post(right ? .rightMouseDown : .leftMouseDown, p, right ? .right : .left)
    post(right ? .rightMouseUp : .leftMouseUp, p, right ? .right : .left)
  case "d": held = true; post(.leftMouseDown, at())
  case "u": held = false; post(.leftMouseUp, at())
  case "s" where n.count == 2:
    CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(n[1]), wheel2: Int32(n[0]), wheel3: 0)?.post(tap: .cghidEventTap)
  case "t": print("trusted \(trusted(prompt: false) ? 1 : 0)")
  case "a": print("trusted \(trusted(prompt: true) ? 1 : 0)")
  case "p": let p = at(); print("at \(p.x) \(p.y)")
  case "k" where w.count > 1:
    if w[1] == "apps" { _ = try? Process.run(URL(fileURLWithPath: "/usr/bin/open"), arguments: ["-a", "Apps"]) }
    else if let (code, flags) = KEYS[String(w[1])] { press(code, flags) }
  case "y": type(String(line.dropFirst(2)))
  case "K" where w.count > 1:
    guard let code = KEYCODES[String(w[1])] else { break }
    var flags = w.dropFirst(2).reduce(CGEventFlags()) { $0.union(FLAGS[String($1)] ?? []) }
    if (123...126).contains(code) { flags.formUnion([.maskSecondaryFn, .maskNumericPad]) } // (as the keyboard's own arrows)
    press(code, flags)
  default: break
  }
}
