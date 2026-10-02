import SwiftUI

/// One ledger row: title + badges, "Oct 1 · Account · Category", signed amount.
struct TransactionRow: View {
    enum Detail { case full, categoryOnly }

    let transaction: LedgerTransaction
    var detail: Detail = .full
    var isSplit = false
    var onOpenReceipt: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(transaction.title).lineLimit(1)
                    if isSplit { Pill(text: "Split") }
                    if transaction.pending { Pill(text: "Pending", style: .outline) }
                    if transaction.receiptUrl != nil, let onOpenReceipt {
                        Button("View receipt", systemImage: "paperclip", action: onOpenReceipt)
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .foregroundStyle(.secondary)
                    }
                }
                if transaction.merchant != nil, let description = transaction.description {
                    Text(description).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            MoneyText(cents: transaction.signedAmountCents, currency: transaction.currency, tone: .signed, showsPlus: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        var parts = [transaction.date.shortLabel]
        if detail == .full, let account = transaction.account?.name { parts.append(account) }
        if let category = transaction.category?.name { parts.append(category) }
        if detail == .full, let creator = transaction.creatorLabel { parts.append(creator) }
        return parts.joined(separator: " · ")
    }
}

/// A split part shown under its parent.
struct SplitPartRow: View {
    let part: LedgerTransaction

    var body: some View {
        HStack {
            Image(systemName: "arrow.turn.down.right").foregroundStyle(.tertiary)
            CategoryDot(hex: part.category?.color, size: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(part.category?.name ?? "Uncategorized").font(.subheadline)
                if let description = part.description {
                    Text(description).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            MoneyText(cents: part.amountCents, currency: part.currency, tone: .neutral)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
