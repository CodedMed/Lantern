import Foundation

public enum Sector: String, CaseIterable, Sendable {
    case left, ahead, right

    public var horizontalBounds: ClosedRange<Double> {
        switch self {
        case .left: return 0.06...0.33
        case .ahead: return 0.36...0.64
        case .right: return 0.67...0.94
        }
    }
}

public struct DepthCell: Sendable {
    public let meters: Double
    public let confidence: UInt8
    public let isKnownFloor: Bool
    public init(meters: Double, confidence: UInt8, isKnownFloor: Bool = false) {
        self.meters = meters
        self.confidence = confidence
        self.isKnownFloor = isKnownFloor
    }
    public static let unknown = DepthCell(meters: .nan, confidence: 0)
}

public enum DepthIssue: String, Equatable, Sendable {
    case unavailable, lowConfidence, outsideRange, floorOnly, noSurface

    public var explanation: String {
        switch self {
        case .unavailable: return "Waiting for fresh depth"
        case .lowConfidence: return "Not enough confident depth. Hold steady."
        case .outsideRange: return "Depth outside the 0.2–4.5 m software window"
        case .floorOnly: return "Only classified floor sampled. Aim forward."
        case .noSurface: return "No supported surface patch. Re-aim slowly."
        }
    }
}

public struct SectorReading: Equatable, Sendable {
    public let meters: Double?
    public let coverage: Double
    public let issue: DepthIssue?
    public init(meters: Double?, coverage: Double, issue: DepthIssue = .unavailable) {
        self.coverage = coverage.isFinite ? min(1, max(0, coverage)) : 0
        if let meters, meters.isFinite, DepthAnalysis.supportedRange.contains(meters), self.coverage >= 0.35 {
            self.meters = meters
            self.issue = nil
        } else { self.meters = nil; self.issue = issue }
    }
    public static let unknown = SectorReading(meters: nil, coverage: 0)
    public var label: String {
        meters.map { String(format: "About %.1f m", $0) } ?? "Unknown"
    }
    public var explanation: String {
        issue?.explanation ?? "\(Int((coverage * 100).rounded()))% in-range, high-confidence samples"
    }
}

public enum DepthAnalysis {
    public static let columns = 10
    public static let rows = 12
    // Prototype software limits, not a claim about guaranteed sensor accuracy.
    public static let supportedRange = 0.2...4.5
    public static let maximumAge = 0.5

    public static func isFresh(capturedAt: Double, now: Double) -> Bool {
        capturedAt.isFinite && now.isFinite && now >= capturedAt && now - capturedAt <= maximumAge
    }

    /// Analyze a screen-aligned grid, not arbitrary unrotated depth pixels.
    /// A near connected patch must have >= 6 high-confidence samples. Isolated
    /// bad pixels cannot become the distance; thin hazards may still be missed.
    public static func analyze(_ cells: [DepthCell], columns: Int = DepthAnalysis.columns, rows: Int = DepthAnalysis.rows) -> SectorReading {
        guard columns > 0, rows > 0, columns <= 100, rows <= 100,
              cells.count == columns * rows else { return .unknown }
        let valid = cells.map { $0.confidence == 2 && $0.meters.isFinite && supportedRange.contains($0.meters) }
        let coverage = Double(valid.filter { $0 }.count) / Double(cells.count)
        guard coverage >= 0.35 else {
            let outside = cells.filter {
                $0.confidence == 2 && $0.meters.isFinite && $0.meters > 0 && !supportedRange.contains($0.meters)
            }.count
            let issue: DepthIssue = Double(outside) / Double(cells.count) >= 0.35 ? .outsideRange : .lowConfidence
            return SectorReading(meters: nil, coverage: coverage, issue: issue)
        }
        if cells.indices.allSatisfy({ !valid[$0] || cells[$0].isKnownFloor }) {
            return SectorReading(meters: nil, coverage: coverage, issue: .floorOnly)
        }
        var visited = Set<Int>()
        var patches: [Double] = []
        for start in cells.indices where valid[start] && !cells[start].isKnownFloor && !visited.contains(start) {
            var pending = [start], patch: [Double] = []
            visited.insert(start)
            while let index = pending.popLast() {
                let cell = cells[index]
                patch.append(cell.meters)
                let x = index % columns, y = index / columns
                let neighbors = [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
                for (nx, ny) in neighbors where nx >= 0 && nx < columns && ny >= 0 && ny < rows {
                    let ni = ny * columns + nx
                    guard !visited.contains(ni), valid[ni], !cells[ni].isKnownFloor else { continue }
                    let tolerance = 0.2 + 0.05 * min(cell.meters, cells[ni].meters)
                    guard abs(cell.meters - cells[ni].meters) <= tolerance else { continue }
                    visited.insert(ni)
                    pending.append(ni)
                }
            }
            if patch.count >= 6 {
                patch.sort()
                patches.append(patch[Int(Double(patch.count - 1) * 0.2)])
            }
        }
        return SectorReading(meters: patches.min(), coverage: coverage, issue: .noSurface)
    }
}

public struct DepthSmoother {
    private var history: [Sector: [Double]] = [:]
    private var lastTimestamp: Double?
    public init() {}
    public mutating func reset() { history = [:]; lastTimestamp = nil }
    public mutating func update(_ input: [Sector: SectorReading], capturedAt: Double, now: Double) -> [Sector: SectorReading] {
        guard DepthAnalysis.isFresh(capturedAt: capturedAt, now: now),
              lastTimestamp.map({ capturedAt > $0 }) ?? true else {
            reset()
            return [:]
        }
        if let previous = lastTimestamp, capturedAt - previous > DepthAnalysis.maximumAge { history = [:] }
        lastTimestamp = capturedAt
        var result: [Sector: SectorReading] = [:]
        for sector in Sector.allCases {
            let reading = input[sector] ?? .unknown
            guard let value = reading.meters, value.isFinite, DepthAnalysis.supportedRange.contains(value) else {
                history[sector] = []
                result[sector] = SectorReading(meters: nil, coverage: reading.coverage, issue: reading.issue ?? .unavailable)
                continue
            }
            var values = history[sector] ?? []
            // Do not smooth away a newly closer surface while waiting on older,
            // farther readings. Loss/low confidence also removes meters at once.
            if let last = values.last, value < last - 0.25 { values = [] }
            values.append(value)
            values = Array(values.suffix(3))
            history[sector] = values
            let sorted = values.sorted()
            let middle = sorted.count / 2
            let median = sorted.count % 2 == 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
            result[sector] = SectorReading(meters: median, coverage: reading.coverage)
        }
        return result
    }
}

public struct DepthCue: Equatable, Sendable {
    public let title: String
    public let detail: String
    public let speech: String
    public let key: String
    public let urgent: Bool
    // Uncertainty and side changes are cautions, not reasons to cut off another
    // warning. Only a new close-ahead warning may interrupt lower-priority speech.
    public var speechPriority: Int { key.hasPrefix("pause:") ? 2 : urgent ? 1 : 0 }
}

/// Latest-frame speech scheduling, not a safety guarantee. No utterance backlog:
/// callers keep offering the latest cue; normal changes wait for speech to finish.
public struct DepthSpeechPolicy {
    private var lastKey: String?
    private var lastTime = -Double.infinity
    private var lastPriority = -1
    private var lastCloseWarningAt = -Double.infinity
    private var finishedAt = -Double.infinity
    private var candidateKey: String?
    private var candidateSince = -Double.infinity
    private var lastObserved = -Double.infinity
    public init() {}
    public mutating func didFinish(at now: Double) {
        if now.isFinite, now >= lastTime { finishedAt = now }
    }
    public mutating func shouldSpeak(_ cue: DepthCue, now: Double, speaking: Bool, manual: Bool = false) -> Bool {
        guard now.isFinite, now >= lastObserved, now >= lastTime, now >= finishedAt else { return false }
        if cue.key != candidateKey || now - lastObserved > 0.7 {
            candidateKey = cue.key
            candidateSince = now
        }
        lastObserved = now
        let escalates = cue.speechPriority == 2 && lastPriority < 2
        if speaking {
            // Repeat, low confidence, distance fluctuations and side switches
            // must not restart the sentence. One genuine escalation may.
            guard !manual, escalates, now - lastTime >= 1, now - lastCloseWarningAt >= 6 else { return false }
        }
        if !manual {
            let elapsed = now - lastTime
            let settle = cue.key == "unknown" ? 0.8 : escalates ? 0 : 0.45
            guard now - candidateSince >= settle else { return false }
            guard escalates || now - finishedAt >= 0.8 else { return false }
            guard cue.key != lastKey || elapsed >= 12 else { return false }
            guard escalates || elapsed >= 3 else { return false }
        }
        lastKey = cue.key
        lastTime = now
        lastPriority = cue.speechPriority
        if cue.speechPriority == 2 { lastCloseWarningAt = now }
        return true
    }
}

/// Directions name a camera region to inspect, never a body-clearance corridor.
/// Kept separate from speech so a direction can disappear immediately while an
/// already-playing sentence finishes instead of restarting on every frame.
public enum InspectionAssessment: Equatable, Sendable {
    case check(Sector), settling, missingDepth, floorUnknown, tilted, moving, nearbySurfaces, noPreference, stale

    public var target: Sector? { if case let .check(sector) = self { return sector }; return nil }
    public var title: String {
        switch self {
        case let .check(sector): return "Check \(sector.rawValue)"
        case .settling: return "Hold steady for a direction check"
        case .missingDepth, .stale: return "Direction unavailable"
        case .floorUnknown: return "Floor not identified"
        case .tilted: return "Hold upright and aim forward"
        case .moving: return "Recheck after moving the phone"
        case .nearbySurfaces: return "Pause — surfaces nearby"
        case .noPreference: return "No preferred direction"
        }
    }
    public var detail: String {
        switch self {
        case .check(.ahead):
            return "No close surface was measured ahead in a steady view. Inspect ahead before moving. This does not verify a walking route."
        case let .check(sector):
            return "A farther surface was consistently measured on the \(sector.rawValue) than ahead and on the other side. Turn the phone to inspect that region; this is not an instruction to step there."
        case .settling:
            return "Pause and hold the phone steady while all three regions are compared. No direction is selected yet."
        case .missingDepth:
            return "All three regions need fresh distances and stronger sample coverage for comparison. Unknown, floor-only, or missing depth is not open space."
        case .floorUnknown:
            return "Pause and scan slowly to identify the floor. Floor classification is a prerequisite, not proof of a continuous, level path."
        case .tilted:
            return "Keep the phone upright, aiming approximately level ahead while stationary. A view of the ceiling or floor cannot choose a direction."
        case .moving:
            return "The camera view changed. The old direction is removed; pause and hold still to compare the new view. Directions are relative to the phone, not your body."
        case .nearbySurfaces:
            return "Supported surfaces are nearby in all three regions. No direction is selected. Pause and inspect your surroundings."
        case .noPreference:
            return "The measurements are too similar or do not meet the comparison margins. No direction is selected. Pause and scan slowly."
        case .stale:
            return "Fresh, ordered depth and camera pose are required. The previous direction is removed. Pause and recheck."
        }
    }
    public var speech: String {
        switch self {
        case let .check(sector): return "Check \(sector.rawValue) with the phone."
        case .settling: return "Hold steady for a direction check."
        case .missingDepth, .stale: return "Direction uncertain. Hold steady."
        case .floorUnknown: return "Floor not identified. Scan slowly."
        case .tilted: return "Hold upright and aim forward."
        case .moving: return "View changed. Hold steady and recheck."
        case .nearbySurfaces: return "Surfaces nearby. No preferred direction."
        case .noPreference: return "No preferred direction. Scan slowly."
        }
    }
    public var key: String {
        switch self {
        case let .check(sector): return "check-\(sector.rawValue)"
        case .settling: return "settling"
        case .missingDepth: return "missing-depth"
        case .floorUnknown: return "floor-unknown"
        case .tilted: return "tilted"
        case .moving: return "moving"
        case .nearbySurfaces: return "nearby"
        case .noPreference: return "no-preference"
        case .stale: return "stale"
        }
    }
}

/// World-space pose of the portrait camera view. No heading map or calibration
/// is stored. Reject malformed/non-orthogonal vectors rather than guessing.
public struct InspectionPose: Sendable {
    public let position: SIMD3<Double>
    public let forward: SIMD3<Double>
    public let up: SIMD3<Double>
    public init?(position: SIMD3<Double>, forward: SIMD3<Double>, up: SIMD3<Double>) {
        guard [position.x, position.y, position.z, forward.x, forward.y, forward.z, up.x, up.y, up.z].allSatisfy({ $0.isFinite }) else { return nil }
        let fl = sqrt(Self.dot(forward, forward)), ul = sqrt(Self.dot(up, up))
        guard (0.9...1.1).contains(fl), (0.9...1.1).contains(ul) else { return nil }
        let f = forward / fl, u = up / ul
        guard abs(Self.dot(f, u)) < 0.05 else { return nil }
        self.position = position; self.forward = f; self.up = u
    }
    public var isUpright: Bool { up.y >= cos(25 * .pi / 180) && abs(forward.y) <= sin(25 * .pi / 180) }
    fileprivate func matches(_ other: InspectionPose) -> Bool {
        let delta = position - other.position
        return Self.dot(delta, delta) <= 0.12 * 0.12
            && Self.dot(forward, other.forward) >= cos(10 * .pi / 180)
            && Self.dot(up, other.up) >= cos(10 * .pi / 180)
    }
    private static func dot(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }
}

/// Conservative inspection heuristic, NOT a path planner. These thresholds are
/// prototype choices, not validated safety margins or sensor error bounds.
public struct DepthInspectionGuide {
    public static let settlingTime = 0.8
    public static let minimumSamples = 5
    private var lastTimestamp: Double?
    private var lastNow: Double?
    private var candidate: Sector?
    private var candidateSince = -Double.infinity
    private var samples = 0
    private var anchor: InspectionPose?
    public init() {}
    public mutating func reset() { self = DepthInspectionGuide() }

    public mutating func update(_ readings: [Sector: SectorReading], floorKnown: Bool,
                                pose: InspectionPose?, capturedAt: Double, now: Double) -> InspectionAssessment {
        guard DepthAnalysis.isFresh(capturedAt: capturedAt, now: now),
              lastTimestamp.map({ capturedAt > $0 }) ?? true,
              lastNow.map({ now >= $0 }) ?? true, let pose else {
            reset(); return .stale
        }
        if let lastTimestamp, capturedAt - lastTimestamp > DepthAnalysis.maximumAge { reset() }
        lastTimestamp = capturedAt; lastNow = now
        guard pose.isUpright else { clearCandidate(); anchor = nil; return .tilted }
        if let anchor, !pose.matches(anchor) {
            clearCandidate(); self.anchor = pose
            return .moving
        }
        if anchor == nil { anchor = pose }
        guard floorKnown else { clearCandidate(); return .floorUnknown }
        guard Sector.allCases.allSatisfy({ readings[$0]?.meters != nil && (readings[$0]?.coverage ?? 0) >= 0.6 }),
              let left = readings[.left]?.meters, let ahead = readings[.ahead]?.meters,
              let right = readings[.right]?.meters else { clearCandidate(); return .missingDepth }

        let proposed: Sector
        if ahead >= 1.75 && left >= 0.75 && right >= 0.75 {
            // Do not suggest a needless side change just because a wall there
            // is farther away. "Check ahead" is still not permission to walk.
            proposed = .ahead
        } else if left >= 1.75 && left >= ahead + 0.6 && left >= right + 0.5 {
            proposed = .left
        } else if right >= 1.75 && right >= ahead + 0.6 && right >= left + 0.5 {
            proposed = .right
        } else {
            clearCandidate()
            return max(left, ahead, right) < 1.75 ? .nearbySurfaces : .noPreference
        }
        if candidate != proposed {
            candidate = proposed; candidateSince = capturedAt; samples = 0
        }
        samples = min(samples + 1, Self.minimumSamples)
        guard samples >= Self.minimumSamples, capturedAt - candidateSince >= Self.settlingTime else { return .settling }
        return .check(proposed)
    }
    private mutating func clearCandidate() { candidate = nil; samples = 0; candidateSince = -.infinity }
}

public enum DepthGuidance {
    public static func cue(_ readings: [Sector: SectorReading], floorKnown: Bool,
                           inspection: InspectionAssessment? = nil) -> DepthCue {
        let ahead = readings[.ahead]?.meters
        guard let ahead else {
            return DepthCue(title: "Distance unknown", detail: "Pause and inspect your surroundings. Missing depth does not mean clear space.", speech: "Pause. Distance uncertain. Hold the phone steady.", key: "unknown", urgent: true)
        }
        let text = String(format: "Surface ahead, about %.1f meters.", ahead)
        let closeSide = [Sector.left, .right].first { (readings[$0]?.meters ?? .infinity) < 0.75 }
        if ahead < 1.25 {
            let check = inspection?.speech ?? "Check around you."
            return DepthCue(title: "Pause and check", detail: "\(text) \(check) This is not a verified walking route.", speech: "Pause. \(text) \(check)", key: "pause:\(check):\(Int((ahead * 2).rounded()))", urgent: true)
        }
        if let side = closeSide {
            return DepthCue(title: "Surface close on \(side.rawValue)", detail: "Pause and inspect around you. Other hazards may be missed.", speech: "Pause. Surface close on your \(side.rawValue). \(inspection?.speech ?? "")", key: "side:\(side.rawValue):\(inspection?.key ?? "")", urgent: true)
        }
        if let inspection {
            let distance = inspection.target.flatMap { readings[$0]?.meters }.map {
                String(format: " Surface about %.1f meters.", $0)
            } ?? ""
            return DepthCue(title: inspection.title, detail: inspection.detail,
                            speech: "Pause. \(inspection.speech)\(distance)", key: "inspection:\(inspection.key)", urgent: inspection.target == nil)
        }
        return DepthCue(title: readings[.ahead]?.label ?? "Distance unknown", detail: "Surface depth, not a guarantee of clearance. Check before moving.", speech: text, key: "ahead:\(Int((ahead * 2).rounded()))", urgent: false)
    }
}

/// Image pixel coordinates (origin top-left) -> ARKit camera coordinates.
/// ARKit scene depth is unprojected along camera -Z; +Y points up. The returned
/// point can be transformed by ARCamera.transform for classified-floor masking.
public enum DepthProjection {
    public static func cameraPoint(imageX: Double, imageY: Double, depth: Double,
                                   fx: Double, fy: Double, cx: Double, cy: Double) -> SIMD3<Double>? {
        guard [imageX, imageY, depth, fx, fy, cx, cy].allSatisfy({ $0.isFinite }),
              depth > 0, fx > 0, fy > 0 else { return nil }
        return SIMD3((imageX - cx) * depth / fx, -(imageY - cy) * depth / fy, -depth)
    }
}
