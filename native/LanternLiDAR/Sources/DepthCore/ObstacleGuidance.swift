import Foundation

/// Experimental local obstacle awareness, NOT a navigation or clearance guarantee.
/// Coordinates: x right, y above classified floor, z along the phone's horizontal heading.
public enum ObstacleGeometry {
    public static let halfWidth = 0.5 // 1 m planning envelope, not fitted to a person.
    // Prototype near-field envelope, NOT a validated stopping distance. A wall
    // at 2 m should be a distance warning, not an obstruction of this volume.
    public static let nearHorizon = 1.5
    public static let warningDistance = 2.4
    public static let headings = [-70, -50, -30, 0, 30, 50, 70]
    public static func angle(_ sector: Sector) -> Double {
        Double(sector == .left ? -30 : sector == .right ? 30 : 0) * .pi / 180
    }
    public static func lookAhead(_ sector: Sector) -> Double { 3 }
    public static func point(across: Double, height: Double, along: Double, sector: Sector) -> SIMD3<Double> {
        point(across: across, height: height, along: along, degrees: sector == .left ? -30 : sector == .right ? 30 : 0)
    }
    public static func point(across: Double, height: Double, along: Double, degrees: Int) -> SIMD3<Double> {
        let a = Double(degrees) * .pi / 180
        return SIMD3(across * cos(a) + along * sin(a), height, along * cos(a) - across * sin(a))
    }
    public static func probes(_ sector: Sector) -> [SIMD3<Double>] {
        probes(degrees: sector == .left ? -30 : sector == .right ? 30 : 0)
    }
    public static func probes(degrees: Int) -> [SIMD3<Double>] {
        // The closest plane must fit a body-height/width view at waist level.
        // An overly near plane puts corner probes outside the phone frustum,
        // even in an ideal empty synthetic room.
        [1.2, 1.35, nearHorizon].flatMap { z in
            [0.2, 0.6, 1.0, 1.4, 1.8].flatMap { y in
                [-halfWidth, -halfWidth / 2, 0, halfWidth / 2, halfWidth].map {
                    point(across: $0, height: y, along: z, degrees: degrees)
                }
            }
        }
    }
    public static func groundChecks(_ sector: Sector) -> [SIMD3<Double>] {
        groundChecks(degrees: sector == .left ? -30 : sector == .right ? 30 : 0)
    }
    public static func groundChecks(degrees: Int) -> [SIMD3<Double>] {
        stride(from: 0.3, through: nearHorizon, by: 0.2).flatMap { z in
            [-halfWidth, 0, halfWidth].map { point(across: $0, height: 0, along: z, degrees: degrees) }
        } + [-halfWidth, 0, halfWidth].map { point(across: $0, height: 0, along: nearHorizon, degrees: degrees) }
    }
    public static func obstacleRange(_ points: [SIMD3<Double>], sector: Sector) -> Double? {
        obstacleRange(points, degrees: sector == .left ? -30 : sector == .right ? 30 : 0)
    }
    public static func obstacleRange(_ points: [SIMD3<Double>], degrees: Int) -> Double? {
        let a = Double(degrees) * .pi / 180
        let sine = sin(a), cosine = cos(a)
        var nearest: Double?
        for p in points {
            guard p.x.isFinite, p.y.isFinite, p.z.isFinite, p.y >= 0.15, p.y <= 2.05 else { continue }
            let along = p.x * sine + p.z * cosine
            let across = p.x * cosine - p.z * sine
            guard along > 0.05, along <= 3, abs(across) <= halfWidth else { continue }
            nearest = min(nearest ?? along, along)
        }
        return nearest
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
        (nearestObstacle.map { $0 <= ObstacleGeometry.nearHorizon + 0.15 } ?? false) || probes.contains(.occluded)
    }
    public var isObserved: Bool {
        floorSupported && !isBlocked && probes.count == 75 && probes.allSatisfy { $0 == .observedBeyond }
    }
    public func isWellFormed(for sector: Sector) -> Bool {
        probes.count == 75 && (nearestObstacle.map { $0.isFinite && $0 > 0 && $0 <= ObstacleGeometry.lookAhead(sector) } ?? true)
    }
}

public struct ObstaclePath: Sendable {
    public let degrees: Int
    public let corridor: ObstacleCorridor
    public init(degrees: Int, corridor: ObstacleCorridor) { self.degrees = degrees; self.corridor = corridor }
    public var sector: Sector { degrees < 0 ? .left : degrees > 0 ? .right : .ahead }
    public var isWellFormed: Bool { ObstacleGeometry.headings.contains(degrees) && corridor.isWellFormed(for: sector) }
}

public enum ObstacleStop: String, Equatable, Sendable {
    case unknown, floor, obstacle, noAlternative, settling, recheck, aimForward
}
public enum ObstacleDecision: Equatable, Sendable {
    case ahead, caution, turn(Sector, degrees: Int = 30), scan(Sector), stop(ObstacleStop)
    public var title: String {
        switch self {
        case .ahead: return "KEEP HEADING"
        case .caution: return "SLOW · AHEAD"
        case let .turn(sector, degrees): return "STOP · TURN \(sector.rawValue.uppercased()) \(degrees)°"
        case let .scan(sector): return "STOP · SCAN \(sector.rawValue.uppercased())"
        case .stop: return "STOP"
        }
    }
    public var detail: String {
        switch self {
        case .ahead:
            return "No close obstruction was measured in the sampled near space. Keep checking ahead; this does not certify a clear walking path. Keep using your mobility aid."
        case .caution:
            return "An obstacle is farther ahead, beyond the close-obstacle zone. Slow down and keep checking the distance. A distant wall alone does not trigger a turn."
        case let .turn(sector, degrees):
            return "A close obstruction was measured ahead. The sampled \(sector.rawValue) heading has observed near space and floor support. Stop, turn about \(degrees)° \(sector.rawValue) in place with the phone aligned to your body, then wait for a new forward check. Do not sidestep."
        case let .scan(sector):
            return "No measured turn is ready. Stay still and slowly scan \(sector.rawValue) with the phone to measure another heading, then align it with your body. This is a scan instruction, not a direction to step."
        case .stop(.floor): return "Near-floor coverage is incomplete. Stay still, tilt the phone down briefly to scan the floor, then aim forward near waist level. Missing floor is not an open route."
        case .stop(.obstacle): return "An obstruction was measured ahead. Stop first; a turn needs a steady view and an observed alternative."
        case .stop(.noAlternative): return "A close obstacle is ahead and the measured alternatives are also obstructed. Stay stopped. Scan a wider part of the room with a sighted helper; do not back up into unseen space."
        case .stop(.settling): return "Checking fresh space and heading consistency. No movement direction is ready yet."
        case .stop(.recheck): return "The heading, floor level or view changed. Wait for a fresh forward assessment before moving."
        case .stop(.aimForward): return "Hold the phone upright and pointing along your walking direction, not sideways. This prototype cannot determine your body's heading independently."
        case .stop(.unknown): return "Near space is not fully measured. While stationary, briefly tilt the phone up and down to cover body-height space, then aim forward near waist level. Missing depth is not open space."
        }
    }
    public var cue: DepthCue {
        let speech: String
        let key: String
        switch self {
        case .ahead: speech = "Keep heading. Check ahead."; key = "walk:ahead"
        case .caution: speech = "Slow down. Obstacle farther ahead."; key = "walk:caution"
        case let .turn(sector, degrees): speech = "Stop. Turn \(sector.rawValue) about \(degrees) degrees. Then recheck."; key = "pause:walk-turn-\(sector.rawValue)-\(degrees)"
        case let .scan(sector): speech = "Stop. Scan \(sector.rawValue) with the phone. Do not step yet."; key = "pause:walk-stop-scan-\(sector.rawValue)"
        case .stop(let reason):
            key = "pause:walk-stop-\(reason.rawValue)"
            switch reason {
            case .unknown: speech = "Stop. Hold the phone at waist level. Scan gently, then face forward."
            case .floor: speech = "Stop. Tilt the phone down to scan the floor, then aim forward."
            case .obstacle: speech = "Stop. Obstacle ahead."
            case .noAlternative: speech = "Stop. No measured route."
            case .settling: speech = "Stop. Checking the space ahead."
            case .recheck: speech = "Stop. Recheck after turning."
            case .aimForward: speech = "Stop. Hold the phone forward and upright."
            }
        }
        return DepthCue(title: title, detail: detail, speech: speech, key: key, urgent: self != .ahead)
    }
    public func cue(aheadMeters: Double?) -> DepthCue {
        let base = cue
        guard self == .caution, let meters = aheadMeters, meters.isFinite,
              meters > ObstacleGeometry.nearHorizon + 0.15, meters <= 3 else { return base }
        // One stable semantic key: decimals must not restart narration. The
        // visual measurement still updates each frame; STOP escalates at once.
        let rounded = (meters * 2).rounded() / 2
        return DepthCue(title: base.title, detail: base.detail,
                        speech: String(format: "Slow down. Obstacle ahead, about %.1f meters.", rounded),
                        key: base.key, urgent: base.urgent)
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
    private var warningActive = false
    public init() {}
    public mutating func reset() { self = ObstacleGuide() }
    public mutating func update(_ corridors: [Sector: ObstacleCorridor], pose: InspectionPose?, floorLevel: Double?,
                                capturedAt: Double, now: Double) -> ObstacleDecision {
        update(corridors.map { ObstaclePath(degrees: $0.key == .left ? -30 : $0.key == .right ? 30 : 0, corridor: $0.value) },
               pose: pose, floorLevel: floorLevel, capturedAt: capturedAt, now: now)
    }
    public mutating func update(_ paths: [ObstaclePath], pose: InspectionPose?, floorLevel: Double?,
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
        guard paths.allSatisfy(\.isWellFormed), Set(paths.map(\.degrees)).count == paths.count,
              let ahead = paths.first(where: { $0.degrees == 0 })?.corridor else { clearCandidate(); return .stop(.unknown) }
        let proposed: ObstacleDecision
        if ahead.isBlocked {
            // Prefer the smallest measured turn; stable tie order, not a safety
            // ranking based on the three visible distance cards.
            let alternatives = paths.filter { $0.degrees != 0 && $0.corridor.isObserved }.sorted {
                abs($0.degrees) == abs($1.degrees) ? $0.degrees < $1.degrees : abs($0.degrees) < abs($1.degrees)
            }
            guard let side = alternatives.first else {
                clearCandidate()
                if !paths.contains(where: { $0.corridor.floorSupported }) { return .stop(.floor) }
                if paths.contains(where: { $0.degrees != 0 && !$0.corridor.isBlocked && !$0.corridor.floorSupported
                    && $0.corridor.probes.allSatisfy { $0 == .observedBeyond } }) { return .stop(.floor) }
                let unfinished = paths.filter { $0.degrees != 0 && !$0.corridor.isBlocked }
                if let target = unfinished.sorted(by: {
                    let l = $0.corridor.probes.filter { $0 == .observedBeyond }.count
                    let r = $1.corridor.probes.filter { $0 == .observedBeyond }.count
                    if l != r { return l > r }
                    if abs($0.degrees) != abs($1.degrees) { return abs($0.degrees) < abs($1.degrees) }
                    return $0.degrees < $1.degrees
                }).first { return .scan(target.sector) }
                return .stop(.noAlternative)
            }
            proposed = .turn(side.sector, degrees: abs(side.degrees))
        } else if ahead.isObserved {
            if let distance = ahead.nearestObstacle {
                if distance <= ObstacleGeometry.warningDistance { warningActive = true }
                else if distance >= ObstacleGeometry.warningDistance + 0.3 { warningActive = false }
            } else { warningActive = false }
            proposed = warningActive ? .caution : .ahead
        }
        else {
            clearCandidate()
            return .stop(ahead.floorSupported ? .unknown : .floor)
        }
        if candidate != proposed {
            let wasForward = candidate == .ahead || candidate == .caution
            let staysForward = proposed == .ahead || proposed == .caution
            candidate = proposed
            // Entering an early warning does not invent a new near-space STOP
            // or discard an already-settled forward assessment.
            if !wasForward || !staysForward { since = capturedAt; count = 0; anchor = pose }
        }
        if case .turn = proposed, let anchor, !pose.matches(anchor) {
            clearCandidate(); return .stop(.obstacle)
        }
        if (proposed == .ahead || proposed == .caution), let anchor {
            let dot = pose.forward.x * anchor.forward.x + pose.forward.y * anchor.forward.y + pose.forward.z * anchor.forward.z
            if dot < cos(10 * .pi / 180) { clearCandidate(); return .stop(.recheck) }
        }
        count = min(count + 1, 4)
        guard count >= 3, capturedAt - since >= (proposed == .ahead || proposed == .caution ? 0.25 : 0.35) else {
            if case .turn = proposed { return .stop(.obstacle) }
            return .stop(.settling)
        }
        return proposed
    }
    private mutating func clearCandidate() { candidate = nil; count = 0; since = -.infinity; anchor = nil }
}
