import Foundation

/// Experimental local obstacle awareness, NOT a navigation or clearance guarantee.
/// Coordinates: x right, y above classified floor, z along the phone's horizontal heading.
public enum ObstacleGeometry {
    public static let halfWidth = 0.5 // 1 m planning envelope, not fitted to a person.
    public static func angle(_ sector: Sector) -> Double {
        (sector == .left ? -12 : sector == .right ? 12 : 0) * .pi / 180
    }
    public static func lookAhead(_ sector: Sector) -> Double { sector == .ahead ? 2 : 2.6 }
    public static func point(across: Double, height: Double, along: Double, sector: Sector) -> SIMD3<Double> {
        let a = angle(sector)
        return SIMD3(across * cos(a) + along * sin(a), height, along * cos(a) - across * sin(a))
    }
    public static func probes(_ sector: Sector) -> [SIMD3<Double>] {
        let stations = sector == .ahead ? [1.2, 1.6, 2.0] : [2.0, 2.3, 2.6]
        return stations.flatMap { z in
            [0.2, 0.6, 1.0, 1.4, 1.8].flatMap { y in
                [-halfWidth, -halfWidth / 2, 0, halfWidth / 2, halfWidth].map {
                    point(across: $0, height: y, along: z, sector: sector)
                }
            }
        }
    }
    public static func groundChecks(_ sector: Sector) -> [SIMD3<Double>] {
        stride(from: 0.3, through: lookAhead(sector), by: 0.2).flatMap { z in
            [-halfWidth, 0, halfWidth].map { point(across: $0, height: 0, along: z, sector: sector) }
        } + [-halfWidth, 0, halfWidth].map { point(across: $0, height: 0, along: lookAhead(sector), sector: sector) }
    }
    public static func obstacleRange(_ points: [SIMD3<Double>], sector: Sector) -> Double? {
        let a = angle(sector)
        return points.compactMap { p -> Double? in
            guard [p.x, p.y, p.z].allSatisfy({ $0.isFinite }), p.y >= 0.15, p.y <= 2.05 else { return nil }
            let along = p.x * sin(a) + p.z * cos(a)
            let across = p.x * cos(a) - p.z * sin(a)
            guard along > 0.05, along <= lookAhead(sector), abs(across) <= halfWidth else { return nil }
            return along
        }.min()
    }
}

public enum ObstacleProbe: Equatable, Sendable { case observedBeyond, occluded, unknown }
public struct ObstacleObservation: Sendable {
    public let cameraDepth: Double
    public let range: Double
    public let confidence: UInt8
    public init(cameraDepth: Double, range: Double, confidence: UInt8) {
        self.cameraDepth = cameraDepth; self.range = range; self.confidence = confidence
    }
    public static func classify(targetCameraDepth: Double, neighborhood: [ObstacleObservation]) -> ObstacleProbe {
        guard targetCameraDepth.isFinite, targetCameraDepth > 0, neighborhood.count == 9 else { return .unknown }
        let valid = neighborhood.filter {
            $0.confidence == 2 && $0.cameraDepth.isFinite && $0.cameraDepth > 0
                && $0.range.isFinite && DepthAnalysis.supportedRange.contains($0.range)
        }
        // A supported closer sample vetoes clearance, even if it is isolated.
        // False-positive stops are preferable to filtering away a thin obstacle.
        if valid.contains(where: { $0.cameraDepth < targetCameraDepth + 0.15 }) { return .occluded }
        return valid.count >= 5 ? .observedBeyond : .unknown
    }
}

public struct ObstacleCorridor: Sendable {
    public let probes: [ObstacleProbe]
    public let floorSupported: Bool
    public let nearestObstacle: Double?
    public init(probes: [ObstacleProbe], floorSupported: Bool, nearestObstacle: Double?) {
        self.probes = probes; self.floorSupported = floorSupported; self.nearestObstacle = nearestObstacle
    }
    public var isBlocked: Bool {
        nearestObstacle != nil || probes.contains(.occluded)
    }
    public var isObserved: Bool {
        floorSupported && nearestObstacle == nil && probes.count == 75 && probes.allSatisfy { $0 == .observedBeyond }
    }
    public func isWellFormed(for sector: Sector) -> Bool {
        probes.count == 75 && (nearestObstacle.map { $0.isFinite && $0 > 0 && $0 <= ObstacleGeometry.lookAhead(sector) } ?? true)
    }
}

public enum ObstacleStop: String, Equatable, Sendable {
    case unknown, floor, obstacle, noAlternative, settling, recheck, aimForward
}
public enum ObstacleDecision: Equatable, Sendable {
    case ahead, turn(Sector), stop(ObstacleStop)
    public var title: String {
        switch self {
        case .ahead: return "STRAIGHT AHEAD"
        case let .turn(sector): return "STOP · TURN \(sector.rawValue.uppercased())"
        case .stop: return "STOP"
        }
    }
    public var detail: String {
        switch self {
        case .ahead:
            return "The sampled forward space looks less obstructed. This is not permission to walk or proof of a clear path. Keep using your mobility aid."
        case let .turn(sector):
            return "An obstruction was measured ahead and the sampled \(sector.rawValue) alternative has more observed space. Stop first, turn slightly in place with the phone pointing along your heading, then wait for a fresh forward check. Do not sidestep into unseen space."
        case .stop(.floor): return "The floor under the planning envelope is not fully covered by classified floor polygons. Do not move based on this app. A floor scan may be needed before supervised testing."
        case .stop(.obstacle): return "An obstruction was measured ahead. Stop first; a turn needs a steady view and an observed alternative."
        case .stop(.noAlternative): return "An obstruction was measured ahead, but neither alternative has enough observed space and floor support. No turn is recommended."
        case .stop(.settling): return "Checking fresh space and heading consistency. No movement direction is ready yet."
        case .stop(.recheck): return "The heading, floor level or view changed. Wait for a fresh forward assessment before moving."
        case .stop(.aimForward): return "Hold the phone upright and pointing along your walking direction, not sideways. This prototype cannot determine your body's heading independently."
        case .stop(.unknown): return "Forward space is not fully measured. Some height probes may be outside the view; try an upright, waist-level setup with a sighted helper. Missing depth must not be treated as open space."
        }
    }
    public var cue: DepthCue {
        let speech: String
        let key: String
        switch self {
        case .ahead: speech = "Straight ahead looks less obstructed."; key = "walk:ahead"
        case let .turn(sector): speech = "Stop. Turn slightly \(sector.rawValue), then recheck."; key = "pause:walk-turn-\(sector.rawValue)"
        case .stop(let reason):
            key = "pause:walk-stop-\(reason.rawValue)"
            switch reason {
            case .unknown: speech = "Stop. Forward space is not fully measured."
            case .floor: speech = "Stop. Floor coverage is incomplete."
            case .obstacle: speech = "Stop. Obstacle ahead."
            case .noAlternative: speech = "Stop. Obstacle ahead. No measured alternative."
            case .settling: speech = "Stop. Checking the space ahead."
            case .recheck: speech = "Stop. Recheck after turning."
            case .aimForward: speech = "Stop. Hold the phone forward and upright."
            }
        }
        return DepthCue(title: title, detail: detail, speech: speech, key: key, urgent: self != .ahead)
    }
}

/// Unknown never wins. Forward is preferred; a turn is considered only for a
/// measured obstruction, after a steady stop, never merely to escape unknown data.
public struct ObstacleGuide {
    private var lastStamp: Double?
    private var lastNow: Double?
    private var lastPose: InspectionPose?
    private var floorLevel: Double?
    private var candidate: ObstacleDecision?
    private var since = -Double.infinity
    private var count = 0
    private var anchor: InspectionPose?
    public init() {}
    public mutating func reset() { self = ObstacleGuide() }
    public mutating func update(_ corridors: [Sector: ObstacleCorridor], pose: InspectionPose?, floorLevel: Double?,
                                capturedAt: Double, now: Double) -> ObstacleDecision {
        guard DepthAnalysis.isFresh(capturedAt: capturedAt, now: now), let pose,
              lastStamp.map({ capturedAt > $0 }) ?? true, lastNow.map({ now >= $0 }) ?? true else {
            reset(); return .stop(.unknown)
        }
        if let lastStamp, capturedAt - lastStamp > DepthAnalysis.maximumAge { reset() }
        let previousPose = lastPose, previousFloor = self.floorLevel
        lastStamp = capturedAt; lastNow = now; lastPose = pose; self.floorLevel = floorLevel
        guard pose.isUpright else { clearCandidate(); return .stop(.aimForward) }
        guard let floorLevel, floorLevel.isFinite else { clearCandidate(); return .stop(.floor) }
        if let previousFloor, abs(floorLevel - previousFloor) > 0.08 {
            clearCandidate(); return .stop(.recheck)
        }
        if let previousPose {
            let dot = pose.forward.x * previousPose.forward.x + pose.forward.y * previousPose.forward.y + pose.forward.z * previousPose.forward.z
            if dot < cos(8 * .pi / 180) { clearCandidate(); return .stop(.recheck) }
        }
        guard let ahead = corridors[.ahead], ahead.isWellFormed(for: .ahead) else { clearCandidate(); return .stop(.unknown) }
        let proposed: ObstacleDecision
        if ahead.isBlocked {
            let alternatives = [Sector.left, .right].filter { corridors[$0]?.isObserved == true && corridors[$0]?.isWellFormed(for: $0) == true }
            guard let side = alternatives.first else { clearCandidate(); return .stop(.noAlternative) }
            proposed = .turn(side)
        } else if ahead.isObserved { proposed = .ahead }
        else {
            clearCandidate()
            return .stop(ahead.floorSupported ? .unknown : .floor)
        }
        if candidate != proposed {
            candidate = proposed; since = capturedAt; count = 0; anchor = pose
        }
        if case .turn = proposed, let anchor, !pose.matches(anchor) {
            clearCandidate(); return .stop(.obstacle)
        }
        if proposed == .ahead, let anchor {
            let dot = pose.forward.x * anchor.forward.x + pose.forward.y * anchor.forward.y + pose.forward.z * anchor.forward.z
            if dot < cos(10 * .pi / 180) { clearCandidate(); return .stop(.recheck) }
        }
        count = min(count + 1, 4)
        guard count >= 4, capturedAt - since >= (proposed == .ahead ? 0.5 : 0.6) else {
            if case .turn = proposed { return .stop(.obstacle) }
            return .stop(.settling)
        }
        return proposed
    }
    private mutating func clearCandidate() { candidate = nil; count = 0; since = -.infinity; anchor = nil }
}
