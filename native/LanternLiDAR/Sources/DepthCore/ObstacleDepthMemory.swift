import Foundation

/// Small, on-device geometric snapshots. No RGB, ARFrame or pixel buffer is
/// retained. The inputs are downsampled high-confidence camera-Z depths only.
public struct ObstacleDepthSnapshot: Sendable {
    public let timestamp: Double
    public let position: SIMD3<Double>
    private let right: SIMD3<Double>, up: SIMD3<Double>, back: SIMD3<Double>
    private let fx: Double, fy: Double, cx: Double, cy: Double
    private let width: Int, height: Int
    private let depths: [Float]
    public let hits: [SIMD3<Double>]

    public init?(timestamp: Double, position: SIMD3<Double>, right: SIMD3<Double>, up: SIMD3<Double>, back: SIMD3<Double>,
                 fx: Double, fy: Double, cx: Double, cy: Double, width: Int, height: Int, depths: [Float]) {
        func dot(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double { a.x*b.x + a.y*b.y + a.z*b.z }
        guard timestamp.isFinite, [position, right, up, back].allSatisfy({ [$0.x, $0.y, $0.z].allSatisfy(\.isFinite) }),
              [right, up, back].allSatisfy({ abs(dot($0, $0) - 1) < 0.001 }),
              abs(dot(right, up)) < 0.001, abs(dot(right, back)) < 0.001, abs(dot(up, back)) < 0.001,
              [fx, fy, cx, cy].allSatisfy(\.isFinite), fx > 0, fy > 0, (0...1).contains(cx), (0...1).contains(cy),
              width >= 3, height >= 3, width <= 256, height <= 256,
              width * height <= 20_000, depths.count == width * height else { return nil }
        self.timestamp = timestamp; self.position = position
        self.right = right; self.up = up; self.back = back
        self.fx = fx; self.fy = fy; self.cx = cx; self.cy = cy
        self.width = width; self.height = height; self.depths = depths
        var points: [SIMD3<Double>] = []
        points.reserveCapacity(depths.count)
        for py in 0..<height {
            for px in 0..<width {
                let z = Double(depths[py * width + px])
                guard z.isFinite, z > 0 else { continue }
                let x = ((Double(px) + 0.5) / Double(width) - cx) * z / fx
                let y = (cy - (Double(py) + 0.5) / Double(height)) * z / fy
                guard DepthAnalysis.supportedRange.contains(sqrt(x*x + y*y + z*z)) else { continue }
                points.append(position + right * x + up * y - back * z)
            }
        }
        hits = points
    }

    /// nil means outside this camera view; .unknown means *in view* but depth is
    /// missing/uncertain. Those cases must not be conflated when using history.
    public func probe(_ world: SIMD3<Double>) -> ObstacleProbe? {
        let delta = world - position
        func dot(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double { a.x*b.x + a.y*b.y + a.z*b.z }
        let z = -dot(delta, back)
        guard z.isFinite, z > 0 else { return nil }
        let nx = fx * dot(delta, right) / z + cx
        let ny = cy - fy * dot(delta, up) / z
        guard nx.isFinite, ny.isFinite, nx >= 0, nx < 1, ny >= 0, ny < 1 else { return nil }
        let px = Int(nx * Double(width)), py = Int(ny * Double(height))
        var neighborhood: [ObstacleObservation] = []
        for dy in -1...1 {
            for dx in -1...1 {
                let x = px + dx, y = py + dy
                guard x >= 0, x < width, y >= 0, y < height else {
                    neighborhood.append(ObstacleObservation(cameraDepth: .nan, range: .nan, confidence: 0)); continue
                }
                let depth = Double(depths[y * width + x])
                let sx = ((Double(x) + 0.5) / Double(width) - cx) / fx
                let sy = (cy - (Double(y) + 0.5) / Double(height)) / fy
                let range = depth * sqrt(1 + sx*sx + sy*sy)
                neighborhood.append(ObstacleObservation(cameraDepth: depth, range: range, confidence: depth.isFinite && depth > 0 ? 2 : 0))
            }
        }
        return ObstacleObservation.classify(targetCameraDepth: z, neighborhood: neighborhood)
    }
}

/// Brief stationary view stitching, not a persistent map of clear space.
/// Current in-view uncertainty always wins over older clear readings. Turns
/// require another forward assessment after reorientation.
public struct ObstacleDepthMemory {
    public static let maximumAge = 1.2
    public static let forwardViewAge = 1.0
    public static let maximumFrames = 12
    private var frames: [ObstacleDepthSnapshot] = []
    private var anchor: SIMD3<Double>?
    public var count: Int { frames.count }
    public init() {}
    public mutating func reset() { frames = []; anchor = nil }
    public mutating func insert(_ frame: ObstacleDepthSnapshot) {
        if let previous = frames.last, frame.timestamp <= previous.timestamp { reset(); return }
        if let previous = frames.last, frame.timestamp - previous.timestamp > DepthAnalysis.maximumAge { reset() }
        if let anchor {
            let d = frame.position - anchor
            if d.x*d.x + d.y*d.y + d.z*d.z > 0.15*0.15 { reset() }
        }
        if anchor == nil { anchor = frame.position }
        frames.removeAll { frame.timestamp - $0.timestamp > Self.maximumAge }
        frames.append(frame)
        if frames.count > Self.maximumFrames { frames.removeFirst(frames.count - Self.maximumFrames) }
    }
    public func probe(_ world: SIMD3<Double>, now: Double, turning: Bool) -> ObstacleProbe {
        guard let current = frames.last, DepthAnalysis.isFresh(capturedAt: current.timestamp, now: now) else { return .unknown }
        let ageLimit = turning ? Self.maximumAge : Self.forwardViewAge
        for frame in frames.reversed() where now >= frame.timestamp && now - frame.timestamp <= ageLimit {
            // Do not fill a fresh low-confidence patch with old free space.
            if let measured = frame.probe(world) { return measured }
        }
        return .unknown
    }
    public func hits(now: Double, turning: Bool) -> [SIMD3<Double>] {
        guard let current = frames.last, DepthAnalysis.isFresh(capturedAt: current.timestamp, now: now) else { return [] }
        let limit = turning ? Self.maximumAge : Self.forwardViewAge
        return frames.filter { now >= $0.timestamp && now - $0.timestamp <= limit }.flatMap(\.hits)
    }
}
