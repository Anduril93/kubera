import Foundation

/// Integer-cents money helpers (port of src/lib/money.ts). Amounts are never
/// held as floating point: user input is parsed as `Decimal` and rounded to
/// whole cents, and display formatting divides a `Decimal`.
enum Money {
    enum ParseError: Error, Equatable {
        case empty
        case invalid
        case negative
    }

    /// Parses a user-typed dollar amount ("$1,234.5", "-20", "  7.99 ") into cents.
    ///
    /// Like the web app's `parseAmountInput`: currency symbols, commas and spaces
    /// are ignored and only a leading "-" makes the value negative. Unlike it,
    /// input with no digits is rejected rather than read as 0, and rounding is
    /// exact decimal half-up ("1.005" → 101 cents) instead of float rounding.
    static func parse(_ input: String, allowNegative: Bool = false) throws(ParseError) -> Int {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw .empty }

        let negative = trimmed.hasPrefix("-")
        let cleaned = trimmed.filter { $0.isASCII && ($0.isNumber || $0 == ".") }
        guard cleaned.contains(where: \.isNumber),
              cleaned.filter({ $0 == "." }).count <= 1,
              let magnitude = Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX"))
        else { throw .invalid }

        var scaled = magnitude * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        let cents = NSDecimalNumber(decimal: rounded).intValue
        let value = negative ? -cents : cents
        if value < 0 && !allowNegative { throw .negative }
        return value
    }

    /// "$1,234.56" — the single display path for money (port of formatCurrency).
    static func format(_ cents: Int, currency: String = "USD") -> String {
        let dollars = Decimal(cents) / 100
        return dollars.formatted(.currency(code: currency).locale(Locale(identifier: "en_US")))
    }

    /// Plain editable form of an amount, e.g. 1250 → "12.50", -5 → "-0.05".
    static func inputString(_ cents: Int) -> String {
        let sign = cents < 0 ? "-" : ""
        let magnitude = abs(cents)
        return String(format: "%@%d.%02d", sign, magnitude / 100, magnitude % 100)
    }
}
