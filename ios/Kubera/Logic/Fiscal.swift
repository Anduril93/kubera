import Foundation

/// A half-open date range [start, end) plus its display label.
struct FiscalRange: Equatable, Sendable {
    let start: CalendarDate
    /// Exclusive.
    let end: CalendarDate
    let label: String
}

/// Port of src/lib/fiscal.ts — all ranges are local calendar days.
enum Fiscal {
    /// The fiscal month containing `today`, given the household member's start
    /// day (clamped to 1–28 so every month has it). Label is "October 2026"
    /// for start day 1, otherwise "Sep 15 – Oct 14".
    static func monthRange(containing today: CalendarDate, startDay: Int) -> FiscalRange {
        let d = min(max(startDay, 1), 28)
        var year = today.year
        var month = today.month
        if today.day < d {
            month -= 1
            if month < 1 {
                month = 12
                year -= 1
            }
        }
        let start = CalendarDate(year: year, month: month, day: d)
        let end = start.adding(months: 1)
        let lastIncluded = end.adding(days: -1)
        let label = d == 1 ? start.monthYearLabel : "\(start.shortLabel) – \(lastIncluded.shortLabel)"
        return FiscalRange(start: start, end: end, label: label)
    }

    /// The Monday–Sunday week containing `today`.
    static func weekRange(containing today: CalendarDate, calendar: Calendar = .current) -> FiscalRange {
        let weekday = calendar.component(.weekday, from: today.date(calendar: calendar)) // 1 = Sunday
        let daysSinceMonday = (weekday + 5) % 7
        let monday = today.adding(days: -daysSinceMonday)
        let nextMonday = monday.adding(days: 7)
        let sunday = monday.adding(days: 6)
        return FiscalRange(start: monday, end: nextMonday, label: "\(monday.shortLabel) – \(sunday.shortLabel)")
    }
}
