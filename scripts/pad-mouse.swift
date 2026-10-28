// The phone pad's mouse: scripts/pad-relay.mjs builds this (swiftc, into storage/app/pad-mouse) and feeds it a line
// per action on stdin:
//   m dx dy   move the pointer by (dx, dy) points - dragging, while the button is held
//   c l|r     click the left / right button where the pointer is
//   d / u     hold / let go of the left button (dragging)
//   s dx dy   scroll by (dx, dy) pixels
//   t / a     answer "trusted 1|0": whether macOS lets this post input (Accessibility) - a: and show the system's
//             prompt to allow it if not
// macOS only delivers the events it posts once the process running the relay (node, or Terminal) has Accessibility
// access: System Settings > Privacy & Security > Accessibility
import ApplicationServices
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
func trusted(prompt: Bool) -> Bool {
  AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary)
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
var held = false
print("trusted \(trusted(prompt: false) ? 1 : 0)")
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
  default: break
  }
}
