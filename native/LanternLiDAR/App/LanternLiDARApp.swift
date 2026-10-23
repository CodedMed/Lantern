import ARKit
import DepthCore
import SwiftUI

@main
struct LanternLiDARApp: App {
    var body: some Scene { WindowGroup { LidarScreen() } }
}

private struct LidarScreen: View {
    @StateObject private var sensor = LidarController()
    @Environment(\.scenePhase) private var phase
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Lantern").font(.title2.bold())
                    Spacer()
                    Text("LiDAR prototype").font(.caption).foregroundStyle(.secondary)
                }
                if sensor.running { adviceCard }
                controls
                Text(sensor.status).font(.caption).foregroundStyle(.secondary)
                distanceCards
                ZStack {
                    SensorPreview(sensor: sensor)
                    if !sensor.running {
                        Color.black
                        VStack(spacing: 12) {
                            Image(systemName: "viewfinder").font(.largeTitle)
                            Text(sensor.supported ? "Real depth. No chair calibration." : "LiDAR hardware required")
                            Text(sensor.supported ? "Start to use the rear camera and LiDAR." : "Use a supported physical iPhone Pro or iPad Pro. The simulator has no sensor.")
                                .font(.caption).multilineTextAlignment(.center)
                        }.foregroundStyle(.white).padding()
                    } else {
                        GeometryReader { geometry in
                            ForEach(Sector.allCases, id: \.self) { sector in
                                Rectangle().stroke(.white.opacity(0.65), lineWidth: 1)
                                    .overlay(alignment: .top) { Text(sector.rawValue.uppercased()).font(.caption.bold()).padding(6).background(.black.opacity(0.6)).foregroundStyle(.white) }
                                    .frame(width: geometry.size.width * (sector.horizontalBounds.upperBound - sector.horizontalBounds.lowerBound), height: geometry.size.height * 0.5)
                                    .position(x: geometry.size.width * (sector.horizontalBounds.lowerBound + sector.horizontalBounds.upperBound) / 2, y: geometry.size.height * 0.55)
                            }
                        }.allowsHitTesting(false)
                    }
                }.aspectRatio(0.85, contentMode: .fit).clipped().accessibilityLabel("Rear-camera preview with left, ahead and right sampling regions")
                Toggle("Short voice alerts", isOn: $sensor.voiceEnabled).tint(.black)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Voice speed").font(.subheadline)
                    Slider(value: $sensor.voiceSpeed, in: 0.35...0.6, step: 0.01) {
                        Text("Voice speed")
                    } minimumValueLabel: { Text("Slower").font(.caption) } maximumValueLabel: { Text("Faster").font(.caption) }
                        .tint(.black)
                    Text("Messages finish before ordinary updates. Only a new close-ahead warning may interrupt. VoiceOver voice and speed settings take precedence when enabled.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                DisclosureGroup("How to read the distances") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Left, Ahead, and Right match the three boxes in the camera view. Hold the phone upright and aim forward while stationary.")
                        Text("Meters describe the nearest supported surface patch, not an identified object or a guaranteed free path. The sample percentage is depth coverage, not an accuracy score.")
                        Text("Unknown is intentional when depth is uncertain, outside the 0.2–4.5 m software window, or only classified floor is sampled. Re-aim slowly at an opaque nearby wall or furniture; never assume Unknown means clear.")
                        Text("A direction comparison needs all three distances, stronger sample coverage, an identified floor and a steady, upright view. Missing readings produce a phone-only SCAN prompt to help measure that region, not a walking choice. CHECK appears only after comparison and settling. Unknown never means open space.")
                    }.font(.caption).padding(.top, 8)
                }
                Text("No API key, recording, upload, or distance calibration. Sensor data stays on this device.").font(.caption)
                Text("Experimental surface awareness, not navigation or collision avoidance. Glass, dark/reflective surfaces, thin hazards, steps and drop-offs can be missed. Unknown is not clear. Keep using established mobility aids. Never use for road crossing.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(.white).foregroundStyle(.black).preferredColorScheme(.light)
            .onChange(of: phase) { _, newPhase in
                if newPhase == .active { sensor.finishPermissionStartIfNeeded() }
                else if newPhase == .background || !sensor.requestingPermission { sensor.stop() }
            }
            .onDisappear { sensor.stop() }
    }
    private var adviceCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(sensor.inspection.scanTarget == nil ? "PAUSE · DIRECTION TO INSPECT" : "PAUSE · PHONE SCAN ONLY").font(.caption.bold())
            HStack(alignment: .center, spacing: 16) {
                Image(systemName: inspectionSymbol).font(.system(size: 48, weight: .bold))
                    .accessibilityHidden(true)
                Text(adviceHeadline)
                    .font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
            }
            if sensor.cue.speechPriority == 2 {
                Text("Surface close ahead · \(sensor.readings[.ahead]?.label ?? "Unknown")").font(.subheadline.bold())
            } else if sensor.cue.key.hasPrefix("side:") {
                Text(sensor.cue.title).font(.subheadline.bold())
            }
            Text(sensor.inspection.target == nil ? sensor.inspection.detail : "Check with the phone, not a step instruction. Readings support an inspection, not a verified walking route.")
                .font(.subheadline)
            DisclosureGroup("Why this advice?") {
                Text(sensor.inspection.detail).font(.caption).padding(.top, 4)
            }.font(.caption)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(.black).foregroundStyle(.white).tint(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("inspection-guidance")
        // Not a live region: app speech handles changes without duplicate alerts.
    }
    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { controlButtons }
            VStack(alignment: .leading, spacing: 12) { controlButtons }
        }.controlSize(.large).tint(.black)
    }
    @ViewBuilder private var controlButtons: some View {
        Button {
            if sensor.running { sensor.stop() } else { sensor.start() }
        } label: {
            Text(sensor.running ? "Stop" : "Start LiDAR").foregroundStyle(.white)
        }.buttonStyle(.borderedProminent).tint(.black).disabled(!sensor.supported || sensor.requestingPermission)
        Button("Repeat") { sensor.repeatCue() }.buttonStyle(.bordered).disabled(!sensor.running || !sensor.voiceEnabled)
            .accessibilityHint("Repeats current guidance when the voice is idle. Does not restart a sentence already playing.")
        Button("Distances") { sensor.readDistances() }.buttonStyle(.bordered).disabled(!sensor.running || !sensor.voiceEnabled)
            .accessibilityHint("Reads the current left, ahead and right surface distances when the voice is idle.")
    }
    private var distanceCards: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(Sector.allCases, id: \.self) { sector in
                VStack(spacing: 8) {
                    Text(sector.rawValue.capitalized).font(.caption)
                    Text(sensor.running ? (sensor.readings[sector]?.label ?? "Unknown") : "—").font(.headline).minimumScaleFactor(0.7)
                    Text(sensor.running ? (sensor.readings[sector]?.explanation ?? "Waiting for fresh depth") : "Camera off")
                        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity, alignment: .top).padding(8).frame(maxHeight: .infinity, alignment: .top)
                    .overlay(Rectangle().stroke(sensor.inspection.scanTarget == sector ? .black : .gray.opacity(0.3), lineWidth: sensor.inspection.scanTarget == sector ? 2 : 1))
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("distance-\(sector.rawValue)")
            }
        }.fixedSize(horizontal: false, vertical: true).accessibilityElement(children: .contain)
    }
    private var inspectionSymbol: String {
        if sensor.inspection.scanTarget != nil { return "viewfinder" }
        switch sensor.inspection.target {
        case .left: return "arrow.left"
        case .ahead: return "arrow.up"
        case .right: return "arrow.right"
        case nil: return "hand.raised"
        }
    }
    private var adviceHeadline: String {
        if let sector = sensor.inspection.target { return "CHECK \(sector.rawValue.uppercased())" }
        if let sector = sensor.inspection.scanTarget { return "SCAN \(sector.rawValue.uppercased())" }
        return sensor.inspection.title
    }
}

private final class PreviewView: ARSCNView {
    var onLayout: ((CGSize) -> Void)?
    override func layoutSubviews() { super.layoutSubviews(); onLayout?(bounds.size) }
}

private struct SensorPreview: UIViewRepresentable {
    let sensor: LidarController
    func makeUIView(context: Context) -> ARSCNView {
        let view = PreviewView(frame: .zero)
        view.session = sensor.session
        view.automaticallyUpdatesLighting = false
        view.onLayout = { [weak sensor] size in sensor?.viewport = size }
        return view
    }
    func updateUIView(_ view: ARSCNView, context: Context) { sensor.viewport = view.bounds.size }
}
