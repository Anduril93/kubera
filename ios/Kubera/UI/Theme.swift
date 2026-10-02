import SwiftUI

// Design tokens. The web app is deliberately achromatic (neutral grays,
// near-black/near-white primary); red and green are reserved strictly for
// money sign, amber for warnings — so they never compete with the accent.

extension Color {
    /// Hex like "#10b981" (as stored on categories/goals). Falls back to gray.
    init(hex: String?) {
        let fallback = (r: 0x64, g: 0x74, b: 0x8b)
        var value: UInt64 = 0
        let cleaned = (hex ?? "").trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        let rgb: (r: Int, g: Int, b: Int)
        if cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) {
            rgb = (Int(value >> 16) & 0xFF, Int(value >> 8) & 0xFF, Int(value) & 0xFF)
        } else {
            rgb = fallback
        }
        self.init(.sRGB, red: Double(rgb.r) / 255, green: Double(rgb.g) / 255, blue: Double(rgb.b) / 255)
    }

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            let v = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                           blue: CGFloat(v & 0xFF) / 255, alpha: 1)
        })
    }

    // Gilded theme (always dark): black surfaces, gold accent, cream text.
    // Money colors are softened so they sit beside the gold without clashing,
    // and warnings lean orange so they never read as the brand gold.

    /// Brand gold (also the asset-catalog AccentColor).
    static let gold = Color(red: 0xE3 / 255, green: 0xBC / 255, blue: 0x5E / 255)
    /// Text/icons on a gold fill.
    static let onGold = Color(red: 0x14 / 255, green: 0x11 / 255, blue: 0x0A / 255)
    /// Hairline rings around cards.
    static let goldLine = Color(red: 0xE3 / 255, green: 0xBC / 255, blue: 0x5E / 255).opacity(0.28)
    /// Primary text.
    static let cream = Color(red: 0xF4 / 255, green: 0xEB / 255, blue: 0xD6 / 255)

    static let positive = adaptive(light: 0x2E7D52, dark: 0x5FBF8A)
    static let negative = adaptive(light: 0xB23B2E, dark: 0xE26D5C)
    /// Burnt orange (fills)
    static let warning = Color(red: 0xE8 / 255, green: 0x86 / 255, blue: 0x3A / 255)
    /// Text on a tinted warning badge
    static let warningText = adaptive(light: 0xB45309, dark: 0xF2A65A)
}

// MARK: - Money

enum MoneyTone {
    /// Negative is red; otherwise primary.
    case auto
    /// Always red (amounts owed).
    case liability
    /// Negative red, positive green, zero primary.
    case signed
    /// Always primary.
    case neutral
}

struct MoneyText: View {
    let cents: Int
    var currency = "USD"
    var tone: MoneyTone = .auto
    /// Prefix positive values with "+" (ledger rows).
    var showsPlus = false
    /// Overrides the tone's color (e.g. green/red "balanced" states).
    var color: Color?

    var body: some View {
        Text(text)
            .monospacedDigit()
            .foregroundStyle(color ?? toneColor)
    }

    private var text: String {
        let formatted = Money.format(cents, currency: currency)
        return showsPlus && cents > 0 ? "+" + formatted : formatted
    }

    private var toneColor: Color {
        switch tone {
        case .auto: cents < 0 ? .negative : .cream
        case .liability: .negative
        case .signed: cents < 0 ? .negative : (cents > 0 ? .positive : .cream)
        case .neutral: .cream
        }
    }
}

// MARK: - Small building blocks

struct CategoryDot: View {
    let hex: String?
    var size: CGFloat = 10

    var body: some View {
        Circle().fill(hex == nil ? Color.secondary : Color(hex: hex)).frame(width: size, height: size)
    }
}

struct ProgressBar: View {
    /// 0...1 (clamped).
    let fraction: Double
    var tint: Color = .accentColor

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.tertiarySystemFill))
                Capsule().fill(tint)
                    .frame(width: proxy.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 8)
        .accessibilityElement()
        .accessibilityValue("\(Int((min(max(fraction, 0), 1) * 100).rounded())) percent")
    }
}

struct Pill: View {
    enum Style { case neutral, outline, warning, danger, success, strong }

    let text: String
    var style: Style = .neutral

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(foreground)
            .background(background, in: .capsule)
            .overlay {
                if style == .outline { Capsule().strokeBorder(Color(.separator)) }
            }
    }

    private var foreground: Color {
        switch style {
        case .neutral, .outline: .secondary
        case .warning: .warningText
        case .danger: .negative
        case .success: .positive
        case .strong: .onGold
        }
    }

    private var background: Color {
        switch style {
        case .neutral: Color(.tertiarySystemFill)
        case .outline: .clear
        case .warning: Color.warning.opacity(0.15)
        case .danger: Color.negative.opacity(0.15)
        case .success: Color.positive.opacity(0.15)
        case .strong: .gold
        }
    }
}

/// A labeled amount used in summary cards ("Income  $1,234.00").
struct StatColumn: View {
    let label: String
    let cents: Int
    var currency = "USD"
    var tone: MoneyTone = .neutral

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            MoneyText(cents: cents, currency: currency, tone: tone)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

extension MoneyTone {
    /// Income-style: green when > 0, else neutral.
    static func income(_ cents: Int) -> MoneyTone { cents > 0 ? .signed : .neutral }
    /// Expense-style: red when > 0, else neutral.
    static func expense(_ cents: Int) -> MoneyTone { cents > 0 ? .liability : .neutral }
}

// MARK: - Forms

/// Dollar amount entry. Negative amounts need a keyboard with a minus key.
struct AmountField: View {
    let title: String
    @Binding var text: String
    var allowsNegative = false
    var prompt = "0.00"

    var body: some View {
        LabeledContent(title) {
            TextField(title, text: $text, prompt: Text(prompt))
                .keyboardType(allowsNegative ? .numbersAndPunctuation : .decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
    }
}

/// "Label ........ value" text row with an "Optional" prompt.
struct LabeledTextField: View {
    let title: String
    @Binding var text: String
    var prompt = "Optional"

    var body: some View {
        LabeledContent(title) {
            TextField(title, text: $text, prompt: Text(prompt))
                .multilineTextAlignment(.trailing)
        }
    }
}

/// Inline red validation/save error inside a Form.
struct FormErrorRow: View {
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "exclamationmark.circle")
                .font(.footnote)
                .foregroundStyle(Color.negative)
        }
    }
}

/// Picker rows for categories, grouped Income / Expense / Transfer like the web CategorySelect.
struct CategoryPicker: View {
    let title: String
    @Binding var selection: UUID?
    let categories: [Category]
    var noneLabel: String? = "No category"

    var body: some View {
        Picker(title, selection: $selection) {
            if let noneLabel { Text(noneLabel).tag(UUID?.none) }
            ForEach(CategoryKind.allCases) { kind in
                let inKind = categories.filter { $0.kind == kind }
                if !inKind.isEmpty {
                    Section(kind.label) {
                        ForEach(inKind) { category in
                            Label {
                                Text(category.name)
                            } icon: {
                                CategoryDot(hex: category.color)
                            }
                            .tag(Optional(category.id))
                        }
                    }
                }
            }
        }
        .pickerStyle(.navigationLink)
    }
}

extension View {
    /// The standard empty state used across lists (web: muted circle + icon, title, text, add button).
    func emptyState<Actions: View>(
        when isEmpty: Bool, _ title: String, systemImage: String, description: String,
        @ViewBuilder actions: () -> Actions = { EmptyView() }
    ) -> some View {
        overlay {
            if isEmpty {
                ContentUnavailableView {
                    Label(title, systemImage: systemImage)
                } description: {
                    Text(description)
                } actions: {
                    actions()
                }
            }
        }
    }
}

// MARK: - Cards

/// A rounded content card on the grouped background (dashboard, summaries).
struct Card<Content: View, Trailing: View>: View {
    let title: String?
    var subtitle: String?
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    init(_ title: String? = nil, subtitle: String? = nil,
         @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() },
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.headline)
                        if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    trailing()
                }
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.goldLine, lineWidth: 0.5))
    }
}

// MARK: - Form behavior

private struct OnFirstAppear: ViewModifier {
    @State private var done = false
    let action: () -> Void

    func body(content: Content) -> some View {
        content.onAppear {
            guard !done else { return }
            done = true
            action()
        }
    }
}

extension View {
    /// Like `onAppear`, but only once — popping back from a pushed picker
    /// must not re-run a form's "fill in defaults" step and wipe edits.
    func onFirstAppear(perform action: @escaping () -> Void) -> some View {
        modifier(OnFirstAppear(action: action))
    }

    /// Number pads have no return key: add a Done button and swipe-to-dismiss.
    func formKeyboard() -> some View {
        scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                }
            }
    }
}

// MARK: - Gilded styling helpers

extension View {
    /// The one filled call-to-action style: gold capsule, near-black label.
    func goldProminent() -> some View {
        buttonStyle(.borderedProminent).foregroundStyle(Color.onGold)
    }

    /// Hero amounts (net worth, balances) use the logo's serif.
    func heroAmount() -> some View {
        font(.largeTitle.weight(.semibold)).fontDesign(.serif)
    }
}
