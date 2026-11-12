import AppKit
import Foundation
import PDFKit

private struct ContractPage: Encodable {
    let page: Int
    let text: String
    let needsOCR: Bool
}

private enum ReadError: Error {
    case unreadable
    case tooLarge
}

private let imageSize = 2400

private func clean(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func rasterize(_ page: PDFPage, to url: URL) throws {
    let bounds = page.bounds(for: .mediaBox)
    let longSide = max(bounds.width, bounds.height)
    guard longSide.isFinite, longSide > 0 else { throw ReadError.unreadable }
    let scale = CGFloat(imageSize) / longSide
    let size = NSSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    let thumbnail = page.thumbnail(of: size, for: .mediaBox)
    guard let image = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let jpeg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.88]) else {
        throw ReadError.unreadable
    }
    try jpeg.write(to: url)
}

private func read(_ url: URL, scratch: URL, maxPages: Int, maxText: Int) throws -> [ContractPage] {
    guard let document = PDFDocument(url: url), !document.isLocked, document.pageCount > 0 else {
        throw ReadError.unreadable
    }
    if document.pageCount > maxPages { throw ReadError.tooLarge }

    var pages: [ContractPage] = []
    var total = 0
    for index in 0..<document.pageCount {
        let number = index + 1
        let record = try autoreleasepool {
            guard let page = document.page(at: index) else { throw ReadError.unreadable }
            let text = clean(page.string ?? "")
            let needsOCR = text.count < 60
            if needsOCR { try rasterize(page, to: scratch.appendingPathComponent("page-\(number).jpg")) }
            return ContractPage(page: number, text: text, needsOCR: needsOCR)
        }
        total += record.text.utf16.count
        if total > maxText { throw ReadError.tooLarge }
        pages.append(record)
    }
    return pages
}

do {
    let arguments = CommandLine.arguments
    guard arguments.count == 5, let maxPages = Int(arguments[3]), let maxText = Int(arguments[4]) else {
        throw ReadError.unreadable
    }
    let pages = try read(
        URL(fileURLWithPath: arguments[1]),
        scratch: URL(fileURLWithPath: arguments[2], isDirectory: true),
        maxPages: maxPages,
        maxText: maxText
    )
    FileHandle.standardOutput.write(try JSONEncoder().encode(pages))
} catch ReadError.tooLarge {
    exit(3)
} catch {
    exit(2)
}
