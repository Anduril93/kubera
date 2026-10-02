import Foundation

/// Magic-byte detection for receipts (JPEG/PNG/WebP/PDF). Mirrors
/// src/lib/file-validation.ts and the scan-receipt Edge Function — never trust
/// a file extension or a declared MIME type.
enum ReceiptFileType: String, Sendable {
    case jpeg, png, webp, pdf

    var mimeType: String {
        switch self {
        case .jpeg: "image/jpeg"
        case .png: "image/png"
        case .webp: "image/webp"
        case .pdf: "application/pdf"
        }
    }

    var fileExtension: String { self == .jpeg ? "jpg" : rawValue }

    static let maxBytes = 10 * 1024 * 1024
    static let maxFiles = 8

    static func detect(_ data: Data) -> ReceiptFileType? {
        let bytes = [UInt8](data.prefix(12))
        func has(_ signature: [UInt8], at offset: Int = 0) -> Bool {
            bytes.count >= offset + signature.count && Array(bytes[offset..<offset + signature.count]) == signature
        }
        if has([0xFF, 0xD8, 0xFF]) { return .jpeg }
        if has([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return .png }
        if has([0x52, 0x49, 0x46, 0x46]) && has([0x57, 0x45, 0x42, 0x50], at: 8) { return .webp }
        if has([0x25, 0x50, 0x44, 0x46]) { return .pdf }
        return nil
    }
}
