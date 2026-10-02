import Foundation
import Security

enum InviteCode {
    /// 31 characters — no 0/O/1/I/L. The database enforces this exact format.
    static let alphabet = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")

    static func generate(length: Int = 8) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        let status = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return String(bytes.map { alphabet[Int($0) % alphabet.count] })
    }

    /// What the user typed → what the database stores (no whitespace, uppercase).
    static func normalize(_ input: String) -> String {
        input.filter { !$0.isWhitespace }.uppercased()
    }
}
