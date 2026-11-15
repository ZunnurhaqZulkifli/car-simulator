// pdfpage <pdf> <page 1-based | text> [scale] [out.png]: renders one page to PNG (no poppler/gs on this Mac), or "text" dumps every page's text
import PDFKit
import AppKit
let a = CommandLine.arguments
guard let doc = PDFDocument(url: URL(fileURLWithPath: a[1])) else { print("cannot open"); exit(1) }
if a[2] == "text" { for i in 0..<doc.pageCount { print("=== page \(i + 1)"); print(doc.page(at: i)?.string ?? "") }; exit(0) }
let page = doc.page(at: Int(a[2])! - 1)!, s = CGFloat(Double(a.count > 3 ? a[3] : "3")!)
let r = page.bounds(for: .mediaBox), w = Int(r.width * s), h = Int(r.height * s)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let ctx = NSGraphicsContext(bitmapImageRep: rep)!.cgContext
ctx.setFillColor(NSColor.white.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h)); ctx.scaleBy(x: s, y: s)
page.draw(with: .mediaBox, to: ctx)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a.count > 4 ? a[4] : "page.png"))
