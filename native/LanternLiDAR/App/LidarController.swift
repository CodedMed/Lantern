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
    @Published private(set) var floorKnown = false
    @Published private(set) var liveAction: LiveAction = .starting
    @Published private(set) var regions: [Sector: LiveRegion] = [:]
    @Published private(set) var analysisMilliseconds: Double?
    @Published private(set) var cue = LiveAction.starting.cue()
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
    private var liveGuide = LiveProximityGuide()
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
        status = "Starting LiDAR · aim forward"
        expiryTimer?.invalidate()
        expiryTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, self.running else { return }
            guard let stamp = self.lastReceived,
                  DepthAnalysis.isFresh(capturedAt: stamp, now: CACurrentMediaTime()) else {
                self.loseDepth("Waiting for fresh LiDAR depth")
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
        liveGuide.reset()
        liveAction = .starting
        regions = [:]
        analysisMilliseconds = nil
        floorKnown = false
        lastReceived = nil
        cue = LiveAction.starting.cue()
        if stopSpeech { self.stopSpeech() }
    }

    private func loseDepth(_ message: String) {
        // Clear visual meters immediately, but do not turn every confidence
        // dropout into a speech interruption. Offer only the current unknown cue.
        clearReadings(stopSpeech: false)
        liveAction = .stop(.uncertain)
        cue = liveAction.cue()
        status = message
        if CACurrentMediaTime() - startedAt >= 1 { say(cue) }
    }

    func repeatCue() {
        guard revalidateManualReadout() else { return }
        say(cue, manual: true)
    }
    func readDistances() {
        guard revalidateManualReadout() else { return }
        say(LiveProximityGuide.distanceReadout(regions), manual: true)
    }
    private func revalidateManualReadout() -> Bool {
        guard let stamp = lastReceived, DepthAnalysis.isFresh(capturedAt: stamp, now: CACurrentMediaTime()) else {
            // A button tap must not use an old direction while waiting for the
            // next expiry-timer tick. Do not interrupt an active sentence.
            clearReadings(stopSpeech: false)
            liveAction = .stop(.uncertain)
            cue = liveAction.cue()
            // A stale-data STOP is an automatic revocation, not an ordinary
            // manual readout that must wait for an obsolete turn to finish.
            say(cue)
            return false
        }
        return true
    }

    private func stopSpeech() {
        activeUtterance = nil
        speech.stopSpeaking(at: .immediate)
    }

    private func say(_ cue: DepthCue, manual: Bool = false) {
        guard voiceEnabled, running else { return }
        let now = CACurrentMediaTime()
        guard speechPolicy.shouldSpeak(cue, now: now, speaking: activeUtterance != nil || speech.isSpeaking, manual: manual) else { return }
        // Confirmed turns can supersede routine commentary; new forward advice
        // or STOP cancels an obsolete turn. Repeat and distance jitter wait.
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
        let analysisStarted = CACurrentMediaTime()
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
        regions = sampled.regions
        // Use the actual portrait view axes, not ARKit's landscape image axes.
        // Compare raw current-frame readings for direction eligibility: display
        // smoothing must not conceal a newly nearer candidate-side surface.
        let camera = simd_inverse(frame.camera.viewMatrix(for: .portrait))
        let pose = InspectionPose(
            position: SIMD3(Double(camera[3].x), Double(camera[3].y), Double(camera[3].z)),
            forward: SIMD3(-Double(camera[2].x), -Double(camera[2].y), -Double(camera[2].z)),
            up: SIMD3(Double(camera[1].x), Double(camera[1].y), Double(camera[1].z)))
        liveAction = liveGuide.update(sampled.regions, pose: pose, capturedAt: frame.timestamp, now: CACurrentMediaTime())
        let ahead = sampled.regions[.ahead]
        cue = liveAction.cue(meters: ahead?.nearestHit ?? ahead?.reading.meters)
        status = "LiDAR live · automatic proximity alerts"
        analysisMilliseconds = (CACurrentMediaTime() - analysisStarted) * 1000
        say(cue)
    }

    private func sample(frame: ARFrame, depth: CVPixelBuffer, confidence: CVPixelBuffer)
        -> (regions: [Sector: LiveRegion], floorKnown: Bool)? {
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
        let resolution = frame.camera.imageResolution
        let intrinsics = frame.camera.intrinsics
        let worldToCamera = simd_inverse(frame.camera.transform)
        var forward = SIMD3(-frame.camera.transform[2].x, Float(0), -frame.camera.transform[2].z)
        guard simd_length(forward).isFinite, simd_length(forward) > 0.1 else { return nil }
        forward = simd_normalize(forward)
        let right = SIMD3(-forward.z, Float(0), forward.x)
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
            return FloorPatch(inverse: simd_inverse(anchor.transform), y: anchor.center.y, boundary: boundary)
        }
        var result: [Sector: LiveRegion] = [:]
        for sector in Sector.allCases {
            var cells: [DepthCell] = []
            for row in 0..<DepthAnalysis.rows {
                for column in 0..<DepthAnalysis.columns {
                    guard let ray = LiveRayGeometry.ray(sector, column: column, row: row) else { cells.append(.unknown); continue }
                    // Gravity-level rays, not a floor/ceiling crop guessed from
                    // the screen. Floor anchors improve filtering if available;
                    // no floor anchor or scan is required to process this frame.
                    let direction = right * Float(ray.x) + SIMD3<Float>(0, Float(ray.y), 0) + forward * Float(ray.z)
                    let cameraRay = worldToCamera * SIMD4(direction.x, direction.y, direction.z, 0)
                    guard let imagePoint = LiveRayGeometry.imagePoint(cameraRay: SIMD3(Double(cameraRay.x), Double(cameraRay.y), Double(cameraRay.z)),
                        fx: Double(intrinsics[0][0]), fy: Double(intrinsics[1][1]), cx: Double(intrinsics[2][0]), cy: Double(intrinsics[2][1]),
                        width: Double(resolution.width), height: Double(resolution.height)) else {
                        cells.append(.unknown); continue
                    }
                    let px = Int(imagePoint.x * Double(width)), py = Int(imagePoint.y * Double(height))
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
            result[sector] = LiveRegion(cells: cells)
        }
        return (result, !floorPatches.isEmpty)
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
    func contains(_ world: SIMD4<Float>) -> Bool {
        let local = inverse * world
        return abs(local.y - y) < 0.08 && FloorBoundary.contains(SIMD2(Double(local.x), Double(local.z)), vertices: boundary)
    }
}
