import SwiftUI

@main
struct RightsDeskApp: App {
    var body: some Scene {
        WindowGroup {
            DeskScreen()
                .background(Color(red: 0.07, green: 0.07, blue: 0.08))
                .preferredColorScheme(.dark)
        }
    }
}

private struct DeskScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> DeskViewController {
        DeskViewController()
    }

    func updateUIViewController(_ controller: DeskViewController, context: Context) {}
}
