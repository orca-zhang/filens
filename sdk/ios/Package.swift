// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FilensPreview",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "FilensPreview", targets: ["FilensPreview"])],
    targets: [
        .target(name: "FilensPreview", resources: [.copy("Resources/filens")]),
        .testTarget(name: "FilensPreviewTests", dependencies: ["FilensPreview"])
    ]
)
