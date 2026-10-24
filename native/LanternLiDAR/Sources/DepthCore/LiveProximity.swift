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
    public let nonFloorCoverage: Double
    public let minimumBandCoverage: Double
    public let minimumColumnCoverage: Double
    public init(cells: [DepthCell]) {
        reading = DepthAnalysis.analyze(cells)
        guard cells.count == DepthAnalysis.rows * DepthAnalysis.columns else {
            nearestHit = nil; nonFloorCoverage = 0; minimumBandCoverage = 0; minimumColumnCoverage = 0; return
        }
        func valid(_ cell: DepthCell) -> Bool {
            cell.confidence == 2 && !cell.isKnownFloor && cell.meters.isFinite && DepthAnalysis.supportedRange.contains(cell.meters)
        }
        nearestHit = cells.filter { valid($0) && !$0.isKnownFloor }.map(\.meters).min()
        nonFloorCoverage = Double(cells.filter(valid).count) / Double(cells.count)
        minimumBandCoverage = (0..<3).map { band in
            let start = band * 4 * DepthAnalysis.columns
            return Double(cells[start..<(start + 4 * DepthAnalysis.columns)].filter(valid).count) / Double(4 * DepthAnalysis.columns)
        }.min() ?? 0
        minimumColumnCoverage = (0..<DepthAnalysis.columns).map { column in
            Double((0..<DepthAnalysis.rows).filter { valid(cells[$0 * DepthAnalysis.columns + column]) }.count) / Double(DepthAnalysis.rows)
        }.min() ?? 0
    }
    public var supportsAhead: Bool {
        reading.meters != nil && nonFloorCoverage >= 0.5 && minimumBandCoverage >= 0.35 && minimumColumnCoverage >= 0.2
    }
    public func supportsAlternative(to ahead: Double) -> Bool {
        guard let meters = reading.meters, let nearestHit else { return false }
        // A single measured closer sample vetoes a side, even when a far wall
        // dominates its connected-patch reading. Unknown is never a large value.
        return nonFloorCoverage >= 0.75 && minimumBandCoverage >= 0.6 && minimumColumnCoverage >= 0.5
            && meters >= 2 && nearestHit >= 1.8 && meters >= ahead + 0.7 && nearestHit >= ahead + 0.35
    }
    /// Keep an already-confirmed side through modest coverage/relative-distance
    /// variation. All inputs must still be CURRENT and high-confidence. The
    /// absolute obstacle-distance veto is identical to acquiring a new side.
    public func sustainsAlternative(to ahead: Double) -> Bool {
        guard let meters = reading.meters, let nearestHit else { return false }
        return nonFloorCoverage >= 0.65 && minimumBandCoverage >= 0.5 && minimumColumnCoverage >= 0.4
            && meters >= 2 && nearestHit >= 1.8 && meters >= ahead + 0.4 && nearestHit >= ahead + 0.35
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
        case .turn(.left): return "TURN LEFT"
        case .turn(.right): return "TURN RIGHT"
        case .turn(.ahead), .stop(.close), .stop(.obstacle): return "STOP"
        case .stop(.blockedView): return "STOP"
        case .stop(.uncertain): return "DEPTH UNCERTAIN"
        case .stop(.rechecking): return "RECHECKING HEADING"
        case .stop(.camera): return "POINT CAMERA FORWARD"
        }
    }
    public var detail: String {
        switch self {
        case .starting: return "Aim the rear camera forward. No floor scan or calibration is needed."
        case .ahead: return "No close surface was measured in the forward sensing band. This is not proof of a safe walking path."
        case .caution: return "An obstacle is ahead. Slow down. A direction will appear as it gets closer if a side has enough measured room."
        case let .sideClose(side): return "A surface is close on the \(side.rawValue). Keep clear of that side; the app is not assuming the opposite side is open."
        case let .turn(side): return "The obstacle is close ahead and more room is measured to the \(side.rawValue). Turn slowly toward that side with the phone facing the same way as your body. Follow the next instruction as the view changes."
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
        case .caution: speech = "Obstacle ahead. Slow down."; key = "live:caution"
        case let .sideClose(side): speech = "Close on the \(side.rawValue). Keep clear."; key = "live:side-\(side.rawValue)"
        case let .turn(side): speech = "Turn \(side.rawValue)."; key = "live:turn-\(side.rawValue)"
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
    public static let turnDistance = 1.6
    public static let turnExitDistance = 2.0
    public static let warningDistance = 2.3
    private var lastTimestamp: Double?
    private var lastNow: Double?
    private var evidence: [Sector: SideEvidence] = [:]
    private var selected: Sector?
    private var preferred: Sector?
    private var preferenceUntil = -Double.infinity
    private var lastPose: InspectionPose?
    private var lastAction: LiveAction = .starting
    private var avoiding = false
    private var warning = false
    private var closeLatched = false
    private struct SideEvidence {
        var since: Double
        var samples: Int
        var score: Double
        func ready(at time: Double) -> Bool { samples >= 3 && time - since >= 0.25 }
    }
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
        let nearest = regions.values.compactMap(\.nearestHit).min()
        // Raw emergency hits always win; the small release band prevents
        // 0.64/0.66 m jitter from repeatedly releasing an emergency STOP.
        if let nearest, nearest <= Self.stopDistance || (closeLatched && nearest < 0.85) {
            closeLatched = true; clearTurn(); avoiding = true
            return emit(.stop(.close))
        }
        closeLatched = false
        guard let pose, pose.isUpright else { clearTurn(); return emit(.stop(.camera)) }
        defer { lastPose = pose }
        // Normal turning is expected. A direction survives only by passing the
        // checks below against each NEW view, never by retaining old geometry.
        // Discard evidence after an abrupt frame-to-frame rotation/translation.
        if let lastPose {
            let delta = pose.position - lastPose.position
            let translationSquared = delta.x * delta.x + delta.y * delta.y + delta.z * delta.z
            let headingDot = pose.forward.x * lastPose.forward.x + pose.forward.y * lastPose.forward.y + pose.forward.z * lastPose.forward.z
            if translationSquared > 0.35 * 0.35 || headingDot < cos(25 * .pi / 180) {
                clearTurn(); return emit(.stop(.rechecking))
            }
        }
        guard let ahead = regions[.ahead], ahead.supportsAhead, let patchDistance = ahead.reading.meters else {
            clearTurn(); return emit(.stop(.uncertain))
        }
        let distance = min(patchDistance, ahead.nearestHit ?? patchDistance)
        if distance <= Self.turnDistance { avoiding = true }
        else if distance >= Self.turnExitDistance { avoiding = false; selected = nil }

        // Gather both sides while approaching, so a useful turn can be ready
        // BEFORE the front reaches the avoidance threshold. Evidence is lost
        // immediately if the current side fails the acquisition checks.
        for side in [Sector.left, .right] {
            guard distance <= Self.warningDistance,
                  let region = regions[side], region.supportsAlternative(to: distance), let hit = region.nearestHit else {
                evidence[side] = nil; continue
            }
            if var previous = evidence[side] {
                previous.samples = min(previous.samples + 1, 100)
                previous.score = 0.75 * previous.score + 0.25 * hit
                evidence[side] = previous
            } else { evidence[side] = SideEvidence(since: capturedAt, samples: 1, score: hit) }
        }

        if avoiding {
            if let selected {
                if regions[selected]?.sustainsAlternative(to: distance) == true {
                    // Keep one answer while it remains supported. A larger
                    // reading on the other side alone never reverses a turn.
                    preferenceUntil = capturedAt + 1
                    return emit(.turn(selected))
                }
                self.selected = nil
                // The old side is withdrawn in this frame. Even a previously
                // prepared opposite side must wait until the next update, so
                // speech gets a STOP before a contradictory instruction.
                if distance > Self.turnDistance { avoiding = false; return forwardAction(regions, distance) }
                if [Sector.left, .right].contains(where: { evidence[$0]?.ready(at: capturedAt) == true }) {
                    return emit(.stop(.rechecking))
                }
                return emit(blockedAction(regions))
            }
            let ready = [Sector.left, .right].filter { evidence[$0]?.ready(at: capturedAt) == true }
            if !ready.isEmpty {
                // If the previous side has already recovered but is still
                // reconfirming, do not reverse into the other side for one frame.
                if let preferred, capturedAt <= preferenceUntil, evidence[preferred] != nil,
                   !ready.contains(preferred) { return emit(.caution) }
                let target: Sector
                if let preferred, capturedAt <= preferenceUntil, ready.contains(preferred) { target = preferred }
                else {
                    // Never let a historical far value improve today's score.
                    func score(_ side: Sector) -> Double { min(regions[side]?.nearestHit ?? 0, evidence[side]?.score ?? 0) }
                    target = ready.max { score($0) < score($1) }!
                }
                selected = target; preferred = target; preferenceUntil = capturedAt + 1
                return emit(.turn(target))
            }
            if distance <= Self.turnDistance {
                // A measured candidate needs a few distinct frames. Warn during
                // that short confirmation instead of speaking STOP immediately
                // before a usable turn. No candidate still means STOP.
                if !evidence.isEmpty { return emit(.caution) }
                return emit(blockedAction(regions))
            }
        }
        return forwardAction(regions, distance)
    }
    private func blockedAction(_ regions: [Sector: LiveRegion]) -> LiveAction {
        let allNear = Sector.allCases.allSatisfy { side in
            guard let region = regions[side], region.supportsAhead, let patch = region.reading.meters else { return false }
            return patch <= Self.turnDistance
        }
        return .stop(allNear ? .blockedView : .obstacle)
    }
    private mutating func forwardAction(_ regions: [Sector: LiveRegion], _ distance: Double) -> LiveAction {
        // Hold a side warning through small 1.1 m threshold/left-right jitter.
        let closestSide = [Sector.left, .right].filter({ (regions[$0]?.nearestHit ?? .infinity) <= 1.1 })
            .min(by: { (regions[$0]?.nearestHit ?? .infinity) < (regions[$1]?.nearestHit ?? .infinity) })
        if case .sideClose(let previous) = lastAction,
           let hit = regions[previous]?.nearestHit, hit <= 1.3 {
            // Stability must not hide a materially closer new side hazard.
            if let closestSide, closestSide != previous, let other = regions[closestSide]?.nearestHit,
               other <= hit - 0.3 { return emit(.sideClose(closestSide)) }
            return emit(.sideClose(previous))
        }
        if let closestSide { return emit(.sideClose(closestSide)) }
        if distance <= Self.warningDistance { warning = true }
        else if distance >= Self.warningDistance + 0.3 { warning = false }
        return emit(warning ? .caution : .ahead)
    }
    private mutating func clearTurn() {
        evidence = [:]; selected = nil; preferred = nil; preferenceUntil = -.infinity
    }
    private mutating func emit(_ action: LiveAction) -> LiveAction { lastAction = action; return action }
}
