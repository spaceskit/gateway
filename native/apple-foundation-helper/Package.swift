// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SpacesAppleFoundationHelper",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .executable(
            name: "SpacesAppleFoundationHelper",
            targets: ["SpacesAppleFoundationHelper"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "SpacesAppleFoundationHelper"
        ),
    ]
)
