import Foundation

// Deterministic synthetic inputs for comparing decision stability across commits.
// These are not phone recordings, accuracy measurements or walking-route tests.
// Compile alongside Sources/DepthCore/*.swift; it also works with commit 8f0e34c.
@main
enum GuidanceReplay {
    struct Frame {
        var ahead: Double
        var left: Double
        var right: Double
        var yaw: Double = 0
    }
    static func main() {
        let warmup = Array(repeating: Frame(ahead: 1.2, left: 3, right: 2.2), count: 6)
        let traces: [(String, [Frame])] = [
            ("front-threshold-jitter", (0..<120).map { Frame(ahead: $0 % 2 == 0 ? 1.38 : 1.42, left: 3, right: 2.2) }),
            ("competing-side-jitter", (0..<80).map {
                Frame(ahead: 1.2, left: ($0 / 8) % 2 == 0 ? 2.5 : 3.5, right: ($0 / 8) % 2 == 0 ? 3.5 : 2.5)
            }),
            ("slow-turn-to-new-forward-view", (0..<15).map {
                Frame(ahead: 1.2, left: 3, right: 2.2, yaw: Double($0 + 1) * 2)
            } + Array(repeating: Frame(ahead: 3, left: 3, right: 3, yaw: 30), count: 10))
        ]
        for (name, frames) in traces {
            var guide = LiveProximityGuide()
            var last: LiveAction?
            var changes = 0, leftFrames = 0, rightFrames = 0, stopFrames = 0
            for (i, frame) in (warmup + frames).enumerated() {
                func region(_ meters: Double) -> LiveRegion {
                    LiveRegion(cells: Array(repeating: DepthCell(meters: meters, confidence: 2), count: 120))
                }
                let yaw = frame.yaw * .pi / 180
                let pose = InspectionPose(position: .zero, forward: SIMD3(-sin(yaw),0,-cos(yaw)), up: SIMD3(0,1,0))!
                let stamp = 1 + Double(i) * 0.1
                let action = guide.update([.ahead: region(frame.ahead),.left: region(frame.left),.right: region(frame.right)],
                                          pose: pose, capturedAt: stamp, now: stamp)
                if i >= warmup.count {
                    if action != last { changes += 1 }
                    if action == .turn(.left) { leftFrames += 1 }
                    if action == .turn(.right) { rightFrames += 1 }
                    if case .stop = action { stopFrames += 1 }
                }
                last = action
            }
            print("\(name): frames=\(frames.count), actionChanges=\(changes), leftFrames=\(leftFrames), rightFrames=\(rightFrames), stopFrames=\(stopFrames)")
        }
    }
}
