import SwiftUI
import UIKit

enum Theme {
    static let plum = Color(red: 0.4039, green: 0.2157, blue: 0.2745)
    static let paper = Color(red: 0.9804, green: 0.9725, blue: 0.9608)
    static let leaf = Color(red: 0.1804, green: 0.4196, blue: 0.3098)
    static let mist = Color(red: 0.9451, green: 0.9255, blue: 0.9059)
    static let plumUI = UIColor(red: 0.4039, green: 0.2157, blue: 0.2745, alpha: 1)
    static let paperUI = UIColor(red: 0.9804, green: 0.9725, blue: 0.9608, alpha: 1)

    static func font(_ style: Font.TextStyle, bold: Bool = false) -> Font {
        let size: CGFloat
        switch style {
        case .largeTitle: size = 32
        case .title: size = 26
        case .title2: size = 22
        case .title3: size = 20
        case .headline: size = 17
        case .subheadline: size = 15
        case .footnote: size = 13
        case .caption, .caption2: size = 12
        default: size = 16
        }
        return .custom(bold ? "Tajawal-Bold" : "Tajawal-Regular", size: size, relativeTo: style)
    }

    static func install() {
        let title = UIFont(name: "Tajawal-Bold", size: 18) ?? .boldSystemFont(ofSize: 18)
        let item = UIFont(name: "Tajawal-Regular", size: 11) ?? .systemFont(ofSize: 11)
        let bar = UINavigationBarAppearance()
        bar.configureWithOpaqueBackground()
        bar.backgroundColor = paperUI
        bar.titleTextAttributes = [.font: title, .foregroundColor: plumUI]
        bar.largeTitleTextAttributes = [.font: UIFont(name: "Tajawal-Bold", size: 30) ?? .boldSystemFont(ofSize: 30), .foregroundColor: plumUI]
        UINavigationBar.appearance().standardAppearance = bar
        UINavigationBar.appearance().scrollEdgeAppearance = bar
        let tabs = UITabBarAppearance()
        tabs.configureWithOpaqueBackground()
        tabs.backgroundColor = .white
        for layout in [tabs.stackedLayoutAppearance, tabs.inlineLayoutAppearance, tabs.compactInlineLayoutAppearance] {
            layout.normal.titleTextAttributes = [.font: item]
            layout.selected.titleTextAttributes = [.font: item, .foregroundColor: plumUI]
        }
        UITabBar.appearance().standardAppearance = tabs
        UITabBar.appearance().scrollEdgeAppearance = tabs
    }
}
