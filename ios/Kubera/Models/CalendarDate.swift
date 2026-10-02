import Foundation

/// A Postgres `date` (no time, no zone) — "yyyy-MM-dd" on the wire.
///
/// Dates in the ledger are calendar days in the household's local sense, so
/// they never round-trip through `Date` + time zones (which is how a date can
/// silently shift by a day). Comparison is chronological, matching the web
/// app's lexicographic comparison of yyyy-MM-dd strings.
struct CalendarDate: Hashable, Comparable, Sendable, Codable, CustomStringConvertible {
    let year: Int
    let month: Int
    let day: Int

    init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// The local calendar day containing `date`.
    init(_ date: Date, calendar: Calendar = .current) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        self.init(year: c.year!, month: c.month!, day: c.day!)
    }

    static func today(calendar: Calendar = .current) -> CalendarDate {
        CalendarDate(Date(), calendar: calendar)
    }

    /// Parses "yyyy-MM-dd" (also accepts a longer timestamp and takes its date part).
    init?(string: String) {
        let parts = string.prefix(10).split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), (1...31).contains(d)
        else { return nil }
        self.init(year: y, month: m, day: d)
    }

    var description: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// Local midnight on this day.
    func date(calendar: Calendar = .current) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day))!
    }

    /// Calendar arithmetic. Month/year steps clamp to the end of shorter
    /// months (Jan 31 + 1 month = Feb 28/29), like date-fns and Postgres.
    func adding(days: Int = 0, months: Int = 0, years: Int = 0, calendar: Calendar = .current) -> CalendarDate {
        var d = date(calendar: calendar)
        if years != 0 { d = calendar.date(byAdding: .year, value: years, to: d)! }
        if months != 0 { d = calendar.date(byAdding: .month, value: months, to: d)! }
        if days != 0 { d = calendar.date(byAdding: .day, value: days, to: d)! }
        return CalendarDate(d, calendar: calendar)
    }

    /// Whole calendar days from `self` to `other` (positive when `other` is later).
    func days(to other: CalendarDate, calendar: Calendar = .current) -> Int {
        calendar.dateComponents([.day], from: date(calendar: calendar), to: other.date(calendar: calendar)).day!
    }

    static func < (lhs: CalendarDate, rhs: CalendarDate) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    // MARK: Codable

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let parsed = CalendarDate(string: raw) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date: \(raw)")
        }
        self = parsed
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(description)
    }
}

// MARK: - Display

extension CalendarDate {
    /// "Oct 1"
    var shortLabel: String { format("MMM d") }
    /// "Oct 1, 2026"
    var mediumLabel: String { format("MMM d, yyyy") }
    /// "October 2026"
    var monthYearLabel: String { format("LLLL yyyy") }

    private func format(_ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = pattern
        return f.string(from: date())
    }
}
