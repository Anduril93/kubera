import Foundation
import Supabase

struct ReceiptDraft: Decodable, Sendable, Equatable {
    let merchant: String?
    let date: CalendarDate?
    let amountCents: Int?
    let categoryId: UUID?
    let currency: String
}

/// Receipts live in the private `receipts` Storage bucket at
/// "<household_id>/<uuid>.<ext>"; the transaction stores "receipts/<that path>".
enum ReceiptsAPI {
    struct UploadedReceipt: Sendable {
        let path: String
        var key: String { "receipts/\(path)" }
    }

    enum ScanError: Error {
        case rateLimit, unavailable, unreadable, malformed

        var message: String {
            switch self {
            case .rateLimit: "You've reached today's receipt-scan limit. Enter it manually."
            case .unavailable: "Receipt scanning isn't available right now. Enter it manually."
            case .unreadable: "Couldn't read the receipt. Enter it manually."
            case .malformed: "The scan came back unreadable. Enter it manually."
            }
        }
    }

    /// Validates by magic bytes and size, then uploads. Throws DisplayableError
    /// with the web app's copy on validation failures.
    static func upload(_ data: Data, householdId: UUID) async throws -> UploadedReceipt {
        guard data.count <= ReceiptFileType.maxBytes else {
            throw DisplayableError("File too large (max 10 MB).")
        }
        guard let type = ReceiptFileType.detect(data) else {
            throw DisplayableError("Unsupported file type. Upload a JPEG, PNG, WebP, or PDF receipt.")
        }
        let path = "\(householdId.lower)/\(UUID().lower).\(type.fileExtension)"
        try await Backend.receipts.upload(path, data: data, options: FileOptions(contentType: type.mimeType))
        return UploadedReceipt(path: path)
    }

    static func scan(_ receipts: [UploadedReceipt]) async throws(ScanError) -> ReceiptDraft {
        struct Body: Encodable { let paths: [String] }
        struct Success: Decodable { let draft: ReceiptDraft }
        struct Failure: Decodable { let errorKind: String? }
        do {
            let result: Success = try await Backend.client.functions.invoke(
                "scan-receipt",
                options: FunctionInvokeOptions(body: Body(paths: receipts.map(\.path)))
            )
            return result.draft
        } catch let FunctionsError.httpError(code, data) {
            let kind = (try? JSONDecoder().decode(Failure.self, from: data))?.errorKind
            logError("receipts", "scan failed \(code): \(kind ?? "unknown")")
            switch kind {
            case "rate_limit": throw .rateLimit
            case "unreadable": throw .unreadable
            case "malformed": throw .malformed
            default: throw .unavailable
            }
        } catch {
            logError("receipts", "scan failed: \(error)")
            throw .unavailable
        }
    }

    /// Downloads a receipt to a temporary file for Quick Look.
    static func download(key: String) async throws -> URL {
        guard key.hasPrefix("receipts/") else { throw DisplayableError("Receipt not available.") }
        let path = String(key.dropFirst("receipts/".count))
        let data = try await Backend.receipts.download(path: path)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("receipt-\(UUID().lower)")
            .appendingPathExtension((path as NSString).pathExtension)
        try data.write(to: url, options: .completeFileProtection)
        return url
    }

    /// Best-effort removal of an attached receipt after its transaction is deleted.
    static func discard(key: String) async {
        guard key.hasPrefix("receipts/") else { return }
        _ = try? await Backend.receipts.remove(paths: [String(key.dropFirst("receipts/".count))])
    }

    /// Best-effort cleanup for uploads that never got attached to a transaction.
    static func discard(_ receipts: [UploadedReceipt]) async {
        guard !receipts.isEmpty else { return }
        _ = try? await Backend.receipts.remove(paths: receipts.map(\.path))
    }
}
