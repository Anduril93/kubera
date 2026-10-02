import Foundation
import OSLog
import Supabase

/// The app's single Supabase client. Connection values come from Info.plist,
/// which gets them from Config/Secrets.xcconfig (see ios/scripts/write-secrets.sh).
enum Backend {
    static let host: String = Bundle.main.object(forInfoDictionaryKey: "SupabaseHost") as? String ?? ""
    static let anonKey: String = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String ?? ""

    static var isConfigured: Bool { !host.isEmpty && !anonKey.isEmpty }

    static let client = SupabaseClient(
        supabaseURL: URL(string: "https://\(isConfigured ? host : "unconfigured.invalid")")!,
        supabaseKey: isConfigured ? anonKey : "unconfigured",
        options: SupabaseClientOptions(
            auth: .init(storage: KeychainLocalStorage(), emitLocalSessionAsInitialSession: true)
        )
    )

    /// Private receipts bucket (supabase/migrations/0012_receipts_storage.sql).
    static var receipts: StorageFileApi { client.storage.from("receipts") }
}

private let log = Logger(subsystem: "com.anduril93.kubera", category: "app")

/// Logs a failure with a context prefix (e.g. "[transactions] …").
func logError(_ context: String, _ message: String) {
    log.error("[\(context, privacy: .public)] \(message, privacy: .public)")
}

/// Turns any thrown error into copy that's safe to show. Database messages are
/// never shown raw (same rule as the web app's server actions); the real error
/// is logged with a context prefix instead.
func userMessage(for error: Error, context: String, fallback: String) -> String {
    logError(context, String(describing: error))
    if let urlError = error as? URLError, urlError.code != .cancelled {
        return "Can't reach the server. Check your connection and try again."
    }
    return fallback
}
