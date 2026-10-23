import ARKit
import AVFoundation
import Combine
import DepthCore
import QuartzCore
import simd
import UIKit

/// All delegate callbacks and published state use the main queue. ARKit acquires
/// depth itself; this app samples at <= 10 Hz and never queues camera frames.
final class LidarController: NSObject, ObservableObject, ARSessionDelegate, AVSpeechSynthesizerDelegate {
    let session = ARSession()
    @Published private(set) var running = false
    @Published private(set) var requestingPermission = false
    @Published private(set) var status = "Camera off"
    @Published private(set) var readings: [Sector: SectorReading] = [:]
    @Published private(set) var floorKnown = false
    @Published private(set) var inspection: InspectionAssessment = .stale
    @Published private(set) var obstacleDecision: ObstacleDecision = .stop(.unknown)
    @Published private(set) var obstacleCorridors: [Sector: ObstacleCorridor] = [:]
    @Published private(set) var obstaclePaths: [ObstaclePath] = []
    @Published var obstacleGuidanceEnabled = false {
        didSet {
            obstacleGuide.reset()
            obstacleMemory.reset()
            obstacleFloorLevel = nil
            obstacleDecision = .stop(.unknown)
            obstacleCorridors = [:]
            obstaclePaths = []
            stopSpeech()
            speechPolicy = DepthSpeechPolicy()
            cue = obstacleGuidanceEnabled ? obstacleDecision.cue : DepthGuidance.cue(readings, floorKnown: floorKnown, inspection: inspection)
        }
    }
    @Published private(set) var cue = DepthGuidance.cue([:], floorKnown: false)
    @Published var voiceEnabled = true {
        didSet {
            if !voiceEnabled { stopSpeech() }
            else {
                speechPolicy = DepthSpeechPolicy()
                if running { repeatCue() }
            }
        }
    }
    @Published var voiceSpeed: Double = 0.46
    var viewport = CGSize.zero
    let supported = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        && AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) != nil
    private var generation = 0
    private var deferredPermissionStart: Int?
    private var startedAt = Double.infinity
    private var lastProcessed = -Double.infinity
    private var lastReceived: Double?
    private var smoother = DepthSmoother()
    private var inspectionGuide = DepthInspectionGuide()
    private var obstacleGuide = ObstacleGuide()
    private var obstacleMemory = ObstacleDepthMemory()
    private var obstacleFloorLevel: Float?
    private var expiryTimer: Timer?
    private let speech = AVSpeechSynthesizer()
    private var speechPolicy = DepthSpeechPolicy()
    private var activeUtterance: AVSpeechUtterance?

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = .main
        speech.delegate = self
        speech.usesApplicationAudioSession = false
    }

    func start() {
        guard supported else {
            status = "LiDAR unavailable. Use a supported physical iPhone Pro or iPad Pro."
            return
        }
        guard !running && !requestingPermission else { return }
        generation += 1
        let token = generation
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: begin(token: token)
        case .notDetermined:
            requestingPermission = true
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, token == self.generation else { return }
                    if granted {
                        // A permission sheet can temporarily make the scene
                        // inactive. Start only after it is active again.
                        self.deferredPermissionStart = token
                        self.finishPermissionStartIfNeeded()
                    } else {
                        self.requestingPermission = false
                        self.status = "Camera access denied. Allow Lantern LiDAR in iPhone Settings."
                    }
                }
            }
        default: status = "Camera access denied. Allow Lantern LiDAR in iPhone Settings."
        }
    }

    func finishPermissionStartIfNeeded() {
        guard let token = deferredPermissionStart,
              UIApplication.shared.applicationState == .active else { return }
        deferredPermissionStart = nil
        requestingPermission = false
        begin(token: token)
    }

    private func begin(token: Int) {
        guard token == generation, UIApplication.shared.applicationState == .active else { return }
        let configuration = ARWorldTrackingConfiguration()
        configuration.worldAlignment = .gravity
        configuration.frameSemantics = [.sceneDepth]
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .none
        clearReadings()
        lastProcessed = -.infinity
        speechPolicy = DepthSpeechPolicy()
        startedAt = CACurrentMediaTime()
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        running = true
        status = "Starting LiDAR. Keep the phone upright and pointing along your walking direction."
        expiryTimer?.invalidate()
        expiryTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, self.running else { return }
            guard let stamp = self.lastReceived,
                  DepthAnalysis.isFresh(capturedAt: stamp, now: CACurrentMediaTime()) else {
                self.loseDepth("Waiting for fresh, confident LiDAR depth. Hold steady and aim forward.")
                return
            }
        }
    }

    func stop() {
        generation += 1
        deferredPermissionStart = nil
        startedAt = .infinity
        requestingPermission = false
        running = false
        expiryTimer?.invalidate()
        expiryTimer = nil
        session.pause()
        clearReadings()
        status = "Camera off"
    }

    private func clearReadings(stopSpeech: Bool = true) {
        smoother.reset()
        inspectionGuide.reset()
        obstacleGuide.reset()
        obstacleMemory.reset()
        obstacleFloorLevel = nil
        obstacleDecision = .stop(.unknown)
        obstacleCorridors = [:]
        obstaclePaths = []
        inspection = .stale
        readings = [:]
        floorKnown = false
        lastReceived = nil
        cue = obstacleGuidanceEnabled ? obstacleDecision.cue : DepthGuidance.cue([:], floorKnown: false)
        if stopSpeech { self.stopSpeech() }
    }

    private func loseDepth(_ message: String) {
        // Clear visual meters immediately, but do not turn every confidence
        // dropout into a speech interruption. Offer only the current unknown cue.
        clearReadings(stopSpeech: false)
        status = message
        if CACurrentMediaTime() - startedAt >= 1 { say(cue) }
    }

    func repeatCue() {
        revalidateManualReadout()
        say(cue, manual: true)
    }
    func readDistances() {
        revalidateManualReadout()
        say(DepthGuidance.distanceReadout(readings), manual: true)
    }
    private func revalidateManualReadout() {
        guard let stamp = lastReceived, DepthAnalysis.isFresh(capturedAt: stamp, now: CACurrentMediaTime()) else {
            // A button tap must not use an old direction while waiting for the
            // next expiry-timer tick. Do not interrupt an active sentence.
            clearReadings(stopSpeech: false)
            return
        }
    }

    private func stopSpeech() {
        activeUtterance = nil
        speech.stopSpeaking(at: .immediate)
    }

    private func say(_ cue: DepthCue, manual: Bool = false) {
        guard voiceEnabled, running else { return }
        let now = CACurrentMediaTime()
        guard speechPolicy.shouldSpeak(cue, now: now, speaking: activeUtterance != nil || speech.isSpeaking, manual: manual) else { return }
        // The policy permits this only for a higher-priority STOP/close-ahead cue.
        // Normal changes and Repeat wait instead of cutting off a sentence.
        if activeUtterance != nil || speech.isSpeaking { stopSpeech() }
        let utterance = AVSpeechUtterance(string: cue.speech)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = Float(min(0.6, max(0.35, voiceSpeed)))
        utterance.prefersAssistiveTechnologySettings = true
        activeUtterance = utterance
        speech.speak(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finishSpeech(utterance)
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        finishSpeech(utterance)
    }
    private func finishSpeech(_ utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.activeUtterance === utterance else { return }
            self.activeUtterance = nil
            self.speechPolicy.didFinish(at: CACurrentMediaTime())
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard running, frame.timestamp >= startedAt, frame.timestamp - lastProcessed >= 0.1 else { return }
        lastProcessed = frame.timestamp
        guard DepthAnalysis.isFresh(capturedAt: frame.timestamp, now: CACurrentMediaTime()) else {
            loseDepth("Depth delayed. Pause and wait for a fresh view.")
            return
        }
        guard case .normal = frame.camera.trackingState else {
            loseDepth("Tracking uncertain. Hold the phone steady, aim forward, and improve room lighting.")
            return
        }
        guard viewport.width > 0, viewport.height > 0,
              let depth = frame.sceneDepth, let confidence = depth.confidenceMap,
              let sampled = sample(frame: frame, depth: depth.depthMap, confidence: confidence) else {
            loseDepth("LiDAR depth or confidence unavailable. Uncover the rear sensors and aim forward.")
            return
        }
        lastReceived = frame.timestamp
        floorKnown = sampled.floorKnown
        readings = smoother.update(sampled.readings, capturedAt: frame.timestamp, now: CACurrentMediaTime())
        // Use the actual portrait view axes, not ARKit's landscape image axes.
        // Compare raw current-frame readings for direction eligibility: display
        // smoothing must not conceal a newly nearer candidate-side surface.
        let camera = simd_inverse(frame.camera.viewMatrix(for: .portrait))
        let pose = InspectionPose(
            position: SIMD3(Double(camera[3].x), Double(camera[3].y), Double(camera[3].z)),
            forward: SIMD3(-Double(camera[2].x), -Double(camera[2].y), -Double(camera[2].z)),
            up: SIMD3(Double(camera[1].x), Double(camera[1].y), Double(camera[1].z)))
        inspection = inspectionGuide.update(sampled.readings, floorKnown: floorKnown, pose: pose,
                                             capturedAt: frame.timestamp, now: CACurrentMediaTime())
        obstacleCorridors = sampled.corridors
        obstaclePaths = sampled.paths
        obstacleDecision = obstacleGuide.update(sampled.paths, pose: pose, floorLevel: sampled.floorLevel,
                                                 capturedAt: frame.timestamp, now: CACurrentMediaTime())
        cue = obstacleGuidanceEnabled ? obstacleDecision.cue(aheadMeters: sampled.paths.first(where: { $0.degrees == 0 })?.corridor.nearestObstacle)
            : DepthGuidance.cue(readings, floorKnown: floorKnown, inspection: inspection)
        status = floorKnown ? "LiDAR live · classified floor excluded" : "LiDAR live · floor not identified; aim forward"
        say(cue)
    }

    private func sample(frame: ARFrame, depth: CVPixelBuffer, confidence: CVPixelBuffer)
        -> (readings: [Sector: SectorReading], floorKnown: Bool, corridors: [Sector: ObstacleCorridor], paths: [ObstaclePath], floorLevel: Double?)? {
        guard CVPixelBufferGetPixelFormatType(depth) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8 else { return nil }
        let width = CVPixelBufferGetWidth(depth), height = CVPixelBufferGetHeight(depth)
        guard width > 0, height > 0,
              CVPixelBufferGetWidth(confidence) == width,
              CVPixelBufferGetHeight(confidence) == height else { return nil }
        guard CVPixelBufferLockBaseAddress(depth, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
        guard CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
        guard let db = CVPixelBufferGetBaseAddress(depth), let cb = CVPixelBufferGetBaseAddress(confidence) else { return nil }
        let depthStride = CVPixelBufferGetBytesPerRow(depth), confidenceStride = CVPixelBufferGetBytesPerRow(confidence)
        guard depthStride >= width * MemoryLayout<Float>.stride, confidenceStride >= width else { return nil }
        let displayToImage = frame.displayTransform(for: .portrait, viewportSize: viewport).inverted()
        let resolution = frame.camera.imageResolution
        let intrinsics = frame.camera.intrinsics
        let floors = frame.anchors.compactMap { $0 as? ARPlaneAnchor }.filter {
            $0.alignment == .horizontal && $0.classification == .floor
        }
        // Test each point against a classified floor anchor's bounded polygon,
        // never a guessed camera height or an arbitrary horizontal tabletop.
        let floorPatches = floors.compactMap { anchor -> FloorPatch? in
            let geometry = anchor.geometry
            let vertices = geometry.boundaryVertices
            guard vertices.count >= 3, vertices.count <= 512 else { return nil }
            let boundary = vertices.map { v in
                return SIMD2<Double>(Double(v.x), Double(v.z))
            }
            guard boundary.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }
            let center = anchor.transform * SIMD4<Float>(anchor.center.x, anchor.center.y, anchor.center.z, 1)
            return FloorPatch(inverse: simd_inverse(anchor.transform), y: anchor.center.y, boundary: boundary,
                              worldHeight: center.y, isLevel: anchor.transform[1].y > 0.98)
        }
        var result: [Sector: SectorReading] = [:]
        for sector in Sector.allCases {
            var cells: [DepthCell] = []
            let bounds = sector.horizontalBounds
            for row in 0..<DepthAnalysis.rows {
                for column in 0..<DepthAnalysis.columns {
                    let sx = bounds.lowerBound + (Double(column) + 0.5) / Double(DepthAnalysis.columns) * (bounds.upperBound - bounds.lowerBound)
                    let sy = 0.3 + (Double(row) + 0.5) / Double(DepthAnalysis.rows) * 0.5
                    let imagePoint = CGPoint(x: sx, y: sy).applying(displayToImage)
                    guard imagePoint.x >= 0, imagePoint.x < 1, imagePoint.y >= 0, imagePoint.y < 1 else {
                        cells.append(.unknown); continue
                    }
                    let px = Int(Double(imagePoint.x) * Double(width)), py = Int(Double(imagePoint.y) * Double(height))
                    let z = db.advanced(by: py * depthStride).assumingMemoryBound(to: Float.self)[px]
                    let quality = cb.advanced(by: py * confidenceStride).assumingMemoryBound(to: UInt8.self)[px]
                    guard quality == UInt8(ARConfidenceLevel.high.rawValue),
                          let point = DepthProjection.cameraPoint(
                            imageX: (Double(px) + 0.5) / Double(width) * Double(resolution.width),
                            imageY: (Double(py) + 0.5) / Double(height) * Double(resolution.height),
                            depth: Double(z), fx: Double(intrinsics[0][0]), fy: Double(intrinsics[1][1]),
                            cx: Double(intrinsics[2][0]), cy: Double(intrinsics[2][1])) else {
                        cells.append(.unknown); continue
                    }
                    let p = SIMD4<Float>(Float(point.x), Float(point.y), Float(point.z), 1)
                    let world = frame.camera.transform * p
                    let isFloor = floorPatches.contains { $0.contains(world) }
                    // Convert the unprojected point to slant range rather than
                    // treating off-axis camera-Z depth as Euclidean distance.
                    let meters = sqrt(point.x * point.x + point.y * point.y + point.z * point.z)
                    cells.append(DepthCell(meters: meters, confidence: quality, isKnownFloor: isFloor))
                }
            }
            result[sector] = DepthAnalysis.analyze(cells)
        }
        let walking = obstacleGuidanceEnabled ? walkingCorridors(frame: frame, depthBase: db, confidenceBase: cb,
            width: width, height: height, depthStride: depthStride, confidenceStride: confidenceStride,
            floorPatches: floorPatches) : (paths: [], floorLevel: nil)
        let summaries = Dictionary(uniqueKeysWithValues: walking.paths.filter { abs($0.degrees) == 30 || $0.degrees == 0 }.map { ($0.sector, $0.corridor) })
        return (result, !floorPatches.isEmpty, summaries, walking.paths, walking.floorLevel)
    }

    /// All buffers remain locked by sample(). Uses the full camera/depth field,
    /// not the three display-region summaries. Nothing retains an ARFrame.
    private func walkingCorridors(frame: ARFrame, depthBase: UnsafeMutableRawPointer, confidenceBase: UnsafeMutableRawPointer,
                                  width: Int, height: Int, depthStride: Int, confidenceStride: Int,
                                  floorPatches: [FloorPatch]) -> (paths: [ObstaclePath], floorLevel: Double?) {
        let origin = SIMD3(frame.camera.transform[3].x, frame.camera.transform[3].y, frame.camera.transform[3].z)
        let levels = floorPatches.filter {
            $0.isLevel && $0.worldHeight.isFinite && (0.6...1.7).contains(origin.y - $0.worldHeight)
        }.map(\.worldHeight)
        guard let level = levels.max() else { obstacleMemory.reset(); obstacleFloorLevel = nil; return ([], nil) }
        if let previous = obstacleFloorLevel, abs(previous - level) > 0.08 { obstacleMemory.reset() }
        obstacleFloorLevel = level
        var forward = SIMD3(-frame.camera.transform[2].x, Float(0), -frame.camera.transform[2].z)
        guard simd_length(forward).isFinite, simd_length(forward) > 0.1 else { obstacleMemory.reset(); return ([], Double(level)) }
        forward = simd_normalize(forward)
        let right = SIMD3(-forward.z, Float(0), forward.x)
        let intrinsics = frame.camera.intrinsics, resolution = frame.camera.imageResolution
        let fx = Double(intrinsics[0][0]), fy = Double(intrinsics[1][1])
        let cx = Double(intrinsics[2][0]), cy = Double(intrinsics[2][1])
        func worldPoint(_ p: SIMD3<Double>) -> SIMD3<Double> {
            SIMD3(Double(origin.x) + Double(right.x) * p.x + Double(forward.x) * p.z,
                  Double(level) + p.y, Double(origin.z) + Double(right.z) * p.x + Double(forward.z) * p.z)
        }
        // Bound storage and CPU independently of the camera's full resolution.
        // Mask uncertainty now; an old clear patch cannot replace new bad depth.
        let columns = 64, rows = 48
        var depths = Array(repeating: Float.nan, count: columns * rows)
        for row in 0..<rows {
            for col in 0..<columns {
                let px = min(width - 1, Int((Double(col) + 0.5) / Double(columns) * Double(width)))
                let py = min(height - 1, Int((Double(row) + 0.5) / Double(rows) * Double(height)))
                if confidenceBase.advanced(by: py * confidenceStride).assumingMemoryBound(to: UInt8.self)[px] == 2 {
                    depths[row * columns + col] = depthBase.advanced(by: py * depthStride).assumingMemoryBound(to: Float.self)[px]
                }
            }
        }
        func vector(_ v: SIMD4<Float>) -> SIMD3<Double> { SIMD3(Double(v.x), Double(v.y), Double(v.z)) }
        guard let snapshot = ObstacleDepthSnapshot(timestamp: frame.timestamp, position: vector(frame.camera.transform[3]),
            right: vector(frame.camera.transform[0]), up: vector(frame.camera.transform[1]), back: vector(frame.camera.transform[2]),
            fx: fx / Double(resolution.width), fy: fy / Double(resolution.height),
            cx: cx / Double(resolution.width), cy: cy / Double(resolution.height),
            width: columns, height: rows, depths: depths) else { obstacleMemory.reset(); return ([], Double(level)) }
        obstacleMemory.insert(snapshot)
        func localPoints(turning: Bool) -> [SIMD3<Double>] {
            obstacleMemory.hits(now: frame.timestamp, turning: turning).map { world in
                let delta = world - vector(frame.camera.transform[3])
                return SIMD3(delta.x * Double(right.x) + delta.z * Double(right.z), world.y - Double(level),
                             delta.x * Double(forward.x) + delta.z * Double(forward.z))
            }
        }
        let forwardPoints = localPoints(turning: false), turningPoints = localPoints(turning: true)
        let paths = ObstacleGeometry.headings.map { degrees in
            let groundSupported = ObstacleGeometry.groundChecks(degrees: degrees).allSatisfy { p in
                let w = worldPoint(p)
                return floorPatches.contains { $0.contains(SIMD4(Float(w.x), Float(w.y), Float(w.z), 1)) }
            }
            let probes = ObstacleGeometry.probes(degrees: degrees).map {
                obstacleMemory.probe(worldPoint($0), now: frame.timestamp, turning: degrees != 0)
            }
            return ObstaclePath(degrees: degrees, corridor: ObstacleCorridor(probes: probes, floorSupported: groundSupported,
                nearestObstacle: ObstacleGeometry.obstacleRange(degrees == 0 ? forwardPoints : turningPoints, degrees: degrees)))
        }
        return (paths, Double(level))
    }

    func sessionWasInterrupted(_ session: ARSession) {
        stop()
        status = "LiDAR interrupted. Tap Start when ready."
    }
    func session(_ session: ARSession, didFailWithError error: Error) {
        stop()
        status = "LiDAR session failed. Close other camera apps and tap Start to retry."
    }
}

private struct FloorPatch {
    let inverse: simd_float4x4
    let y: Float
    let boundary: [SIMD2<Double>]
    let worldHeight: Float
    let isLevel: Bool
    func contains(_ world: SIMD4<Float>) -> Bool {
        let local = inverse * world
        return abs(local.y - y) < 0.08 && FloorBoundary.contains(SIMD2(Double(local.x), Double(local.z)), vertices: boundary)
    }
}
