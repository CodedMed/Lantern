import Foundation

/// Visible-surface proximity, not floor clearance or a certified walking route.
/// Local axes: right, gravity-up, horizontal phone-forward. Rays are independent
/// of floor classification, camera height and a previously scanned room.
public enum LiveRayGeometry {
    public static func imagePoint(cameraRay: SIMD3<Double>, fx: Double, fy: Double, cx: Double, cy: Double,
                                  width: Double, height: Double) -> SIMD2<Double>? {
        guard [cameraRay.x, cameraRay.y, cameraRay.z, fx, fy, cx, cy, width, height].allSatisfy(\.isFinite),
              cameraRay.z < 0, fx > 0, fy > 0, width > 0, height > 0 else { return nil }
        let x = (fx * cameraRay.x / -cameraRay.z + cx) / width
        let y = (cy - fy * cameraRay.y / -cameraRay.z) / height
        guard x >= 0, x < 1, y >= 0, y < 1 else { return nil }
        return SIMD2(x, y)
    }
    public static func ray(_ sector: Sector, column: Int, row: Int) -> SIMD3<Double>? {
        guard (0..<DepthAnalysis.columns).contains(column), (0..<DepthAnalysis.rows).contains(row) else { return nil }
        let bounds: ClosedRange<Double> = sector == .left ? -24 ... -8 : sector == .right ? 8 ... 24 : -10 ... 10
        let yaw = (bounds.lowerBound + (Double(column) + 0.5) / Double(DepthAnalysis.columns) * (bounds.upperBound - bounds.lowerBound)) * .pi / 180
        let pitch = (12 - (Double(row) + 0.5) / Double(DepthAnalysis.rows) * 24) * .pi / 180
        return SIMD3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch))
    }
}

public struct LiveRegion: Sendable {
    public let reading: SectorReading
    public let nearestHit: Double?
    public let minimumBandCoverage: Double
    public let minimumColumnCoverage: Double
    public init(cells: [DepthCell]) {
        reading = DepthAnalysis.analyze(cells)
        guard cells.count == DepthAnalysis.rows * DepthAnalysis.columns else {
            nearestHit = nil; minimumBandCoverage = 0; minimumColumnCoverage = 0; return
        }
        func valid(_ cell: DepthCell) -> Bool {
            cell.confidence == 2 && !cell.isKnownFloor && cell.meters.isFinite && DepthAnalysis.supportedRange.contains(cell.meters)
        }
        nearestHit = cells.filter { valid($0) && !$0.isKnownFloor }.map(\.meters).min()
        minimumBandCoverage = (0..<3).map { band in
            let start = band * 4 * DepthAnalysis.columns
            return Double(cells[start..<(start + 4 * DepthAnalysis.columns)].filter(valid).count) / Double(4 * DepthAnalysis.columns)
        }.min() ?? 0
        minimumColumnCoverage = (0..<DepthAnalysis.columns).map { column in
            Double((0..<DepthAnalysis.rows).filter { valid(cells[$0 * DepthAnalysis.columns + column]) }.count) / Double(DepthAnalysis.rows)
        }.min() ?? 0
    }
    public var supportsAhead: Bool {
        reading.meters != nil && reading.coverage >= 0.5 && minimumBandCoverage >= 0.35 && minimumColumnCoverage >= 0.2
    }
    public func supportsAlternative(to ahead: Double) -> Bool {
        guard let meters = reading.meters, let nearestHit else { return false }
        // A single measured closer sample vetoes a side, even when a far wall
        // dominates its connected-patch reading. Unknown is never a large value.
        return reading.coverage >= 0.75 && minimumBandCoverage >= 0.6 && minimumColumnCoverage >= 0.5
            && meters >= 2 && nearestHit >= 1.8 && meters >= ahead + 0.7
    }
}

public enum LiveStop: String, Equatable, Sendable { case close, obstacle, blockedView, uncertain, rechecking, camera }
public enum LiveAction: Equatable, Sendable {
    case starting, ahead, caution, sideClose(Sector), turn(Sector), stop(LiveStop)
    public var title: String {
        switch self {
        case .starting: return "CONNECTING LIDAR"
        case .ahead: return "FORWARD VIEW"
        case .caution: return "OBSTACLE AHEAD"
        case let .sideClose(side): return "CLOSE ON \(side.rawValue.uppercased())"
        case .turn(.left): return "STOP · TURN LEFT"
        case .turn(.right): return "STOP · TURN RIGHT"
        case .turn(.ahead), .stop(.close), .stop(.obstacle): return "STOP"
        case .stop(.blockedView): return "STOP · VIEW BLOCKED"
        case .stop(.uncertain): return "DEPTH UNCERTAIN"
        case .stop(.rechecking): return "RECHECKING HEADING"
        case .stop(.camera): return "POINT CAMERA FORWARD"
        }
    }
    public var detail: String {
        switch self {
        case .starting: return "Aim the rear camera forward. No floor scan or calibration is needed."
        case .ahead: return "No close surface was measured in the forward sensing band. This is not proof of a safe walking path."
        case .caution: return "A surface is approaching ahead. Slow down and watch the distance; a distant wall alone does not mean you must turn now."
        case let .sideClose(side): return "A surface is close on the \(side.rawValue). Keep clear of that side; the app is not assuming the opposite side is open."
        case let .turn(side): return "More measured space is visible to the \(side.rawValue). Stop, turn in place with the phone aligned to your body, then recheck before a step. The arrow does not verify footing or full body clearance."
        case .stop(.close): return "A surface is very close in the sensing band. Stop; no turn instruction overrides this warning."
        case .stop(.obstacle): return "A close surface is ahead. No reliable side alternative is ready. Stay stopped; the app will update automatically when the view changes."
        case .stop(.blockedView): return "Close surfaces are measured in all three bands: left, ahead and right. No measured side meets the turn criteria. This is a blocked view, not a loading or scanning step. Stay stopped; advice updates automatically as the view changes."
        case .stop(.uncertain): return "Fresh forward depth is insufficient. Pause. Unmeasured space is not being labeled clear."
        case .stop(.rechecking): return "The heading or proposed side changed. The old turn is cancelled while fresh measurements are checked."
        case .stop(.camera): return "Hold the phone upright and point it along your body’s forward direction. The camera cannot see through the back or sides of the phone."
        }
    }
    public func cue(meters: Double? = nil) -> DepthCue {
        let speech: String, key: String
        switch self {
        case .starting: speech = "Aim the camera forward."; key = "live:starting"
        case .ahead: speech = "No close surface measured ahead."; key = "live:ahead"
        case .caution:
            if let meters, meters.isFinite, DepthAnalysis.supportedRange.contains(meters) {
                speech = String(format: "Obstacle ahead, about %.1f meters. Slow down.", (meters * 2).rounded() / 2)
            } else { speech = "Obstacle ahead. Slow down." }
            key = "live:caution"
        case let .sideClose(side): speech = "Close on the \(side.rawValue). Keep clear."; key = "live:side-\(side.rawValue)"
        case let .turn(side): speech = "Stop. Turn \(side.rawValue) and recheck."; key = "live:turn-\(side.rawValue)"
        case .stop(let reason):
            key = "live:stop-\(reason.rawValue)"
            switch reason {
            case .close: speech = "Stop. Surface very close."
            case .obstacle: speech = "Stop. Obstacle ahead."
            case .blockedView: speech = "Stop. Close surfaces left, ahead and right."
            case .uncertain: speech = "Depth uncertain. Pause."
            case .rechecking: speech = "Pause. Rechecking the heading."
            case .camera: speech = "Pause. Point the camera forward."
            }
        }
        return DepthCue(title: title, detail: detail, speech: speech, key: key, urgent: self != .ahead && self != .starting)
    }
}

/// Actionable relative proximity hints. No floor-scan states, room map, API,
/// calibration, or claim of safe movement. Constants are unvalidated heuristics.
public struct LiveProximityGuide {
    public static let stopDistance = 0.65
    public static let turnDistance = 1.4
    public static let warningDistance = 2.3
    private var lastTimestamp: Double?
    private var lastNow: Double?
    private var candidate: Sector?
    private var candidateSince = -Double.infinity
    private var count = 0
    private var selected: Sector?
    private var turnPose: InspectionPose?
    private var lastPose: InspectionPose?
    private var lastAction: LiveAction = .starting
    private var warning = false
    public init() {}
    public mutating func reset() { self = LiveProximityGuide() }
    public static func distanceReadout(_ regions: [Sector: LiveRegion]) -> DepthCue {
        let phrases = Sector.allCases.map { side -> String in
            guard let meters = regions[side]?.nearestHit else { return "\(side.rawValue), unknown" }
            return String(format: "%@, about %.1f meters", side.rawValue, meters)
        }
        return DepthCue(title: "Closest sampled distances", detail: "Individual high-confidence hits, not route clearance.",
                        speech: "Closest sampled distances. " + phrases.joined(separator: ". ") + ".",
                        key: "live:distances", urgent: false)
    }

    public mutating func update(_ regions: [Sector: LiveRegion], pose: InspectionPose?, capturedAt: Double, now: Double) -> LiveAction {
        guard DepthAnalysis.isFresh(capturedAt: capturedAt, now: now),
              lastTimestamp.map({ capturedAt > $0 }) ?? true, lastNow.map({ now >= $0 }) ?? true else {
            reset(); return emit(.stop(.uncertain))
        }
        if let lastTimestamp, capturedAt - lastTimestamp > DepthAnalysis.maximumAge { reset() }
        lastTimestamp = capturedAt; lastNow = now
        // Any sampled high-confidence close surface wins over coverage and
        // connected-patch smoothing, including a thin hit to either side.
        if regions.values.compactMap(\.nearestHit).contains(where: { $0 <= Self.stopDistance }) {
            clearTurn(); return emit(.stop(.close))
        }
        guard let pose, pose.isUpright else { clearTurn(); return emit(.stop(.camera)) }
        defer { lastPose = pose }
        func headingChanged(_ other: InspectionPose, degrees: Double) -> Bool {
            pose.forward.x * other.forward.x + pose.forward.y * other.forward.y + pose.forward.z * other.forward.z < cos(degrees * .pi / 180)
        }
        if lastPose.map({ headingChanged($0, degrees: 12) }) == true || turnPose.map({ headingChanged($0, degrees: 10) }) == true {
            clearTurn(); return emit(.stop(.rechecking))
        }
        guard let ahead = regions[.ahead], ahead.supportsAhead, let patchDistance = ahead.reading.meters else {
            clearTurn(); return emit(.stop(.uncertain))
        }
        let distance = min(patchDistance, ahead.nearestHit ?? patchDistance)
        if distance > Self.turnDistance {
            let wasTurning: Bool
            if case .turn = lastAction { wasTurning = true } else { wasTurning = false }
            clearTurn()
            if wasTurning { return emit(.stop(.rechecking)) }
            if let side = [Sector.left, .right].filter({ (regions[$0]?.nearestHit ?? .infinity) <= 1.1 })
                .min(by: { (regions[$0]?.nearestHit ?? .infinity) < (regions[$1]?.nearestHit ?? .infinity) }) {
                return emit(.sideClose(side))
            }
            if distance <= Self.warningDistance { warning = true }
            else if distance >= Self.warningDistance + 0.3 { warning = false }
            return emit(warning ? .caution : .ahead)
        }
        let alternatives = [Sector.left, .right].filter { regions[$0]?.supportsAlternative(to: distance) == true }
        guard !alternatives.isEmpty else {
            clearTurn()
            // Explain a genuinely measured near view differently from missing
            // side data. Do not infer a wall's identity or a route outside view.
            let allNear = Sector.allCases.allSatisfy { sector in
                guard let region = regions[sector], region.supportsAhead,
                      let patch = region.reading.meters else { return false }
                return patch <= Self.turnDistance
            }
            return emit(.stop(allNear ? .blockedView : .obstacle))
        }
        let best = alternatives.max { (regions[$0]?.nearestHit ?? 0) < (regions[$1]?.nearestHit ?? 0) }!
        let target: Sector
        if let selected, alternatives.contains(selected),
           (regions[best]?.nearestHit ?? 0) - (regions[selected]?.nearestHit ?? 0) < 0.5 { target = selected }
        else { target = best }
        if candidate != target {
            candidate = target; candidateSince = capturedAt; count = 0
            if selected != nil { selected = nil; turnPose = nil; return emit(.stop(.rechecking)) }
        }
        count = min(count + 1, 4)
        guard count >= 3, capturedAt - candidateSince >= 0.25 else { return emit(.stop(.obstacle)) }
        if selected != target { selected = target; turnPose = pose }
        return emit(.turn(target))
    }
    private mutating func clearTurn() { candidate = nil; candidateSince = -.infinity; count = 0; selected = nil; turnPose = nil }
    private mutating func emit(_ action: LiveAction) -> LiveAction { lastAction = action; return action }
}
