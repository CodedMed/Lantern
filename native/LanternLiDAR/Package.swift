// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LanternDepth",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "DepthCore", targets: ["DepthCore"])],
    targets: [
        .target(name: "DepthCore"),
        .testTarget(name: "DepthCoreTests", dependencies: ["DepthCore"])
    ]
)
