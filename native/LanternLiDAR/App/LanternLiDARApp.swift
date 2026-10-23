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
                Text(sensor.status).font(.caption).foregroundStyle(.secondary)
                HStack(alignment: .top, spacing: 8) {
                    ForEach(Sector.allCases, id: \.self) { sector in
                        VStack(spacing: 8) {
                            Text(sector.rawValue.capitalized).font(.caption)
                            Text(sensor.running ? (sensor.readings[sector]?.label ?? "Unknown") : "—").font(.headline).minimumScaleFactor(0.7)
                            Text(sensor.running ? (sensor.readings[sector]?.explanation ?? "Waiting for fresh depth") : "Camera off")
                                .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }.frame(maxWidth: .infinity, alignment: .top).padding(8).frame(maxHeight: .infinity, alignment: .top)
                            .overlay(Rectangle().stroke(.gray.opacity(0.3)))
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("distance-\(sector.rawValue)")
                    }
                }.fixedSize(horizontal: false, vertical: true).accessibilityElement(children: .contain)
                Text(sensor.running ? sensor.cue.title : "Camera off").font(.title2.bold())
                Text(sensor.running ? sensor.cue.detail : "Point at your surroundings. Measurements come from ARKit's LiDAR depth feed, not assumed object sizes.")
                    .font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Button(sensor.running ? "Stop" : "Start LiDAR") {
                        if sensor.running { sensor.stop() } else { sensor.start() }
                    }.buttonStyle(.borderedProminent).disabled(!sensor.supported || sensor.requestingPermission)
                    Button("Repeat") { sensor.repeatCue() }.buttonStyle(.bordered).disabled(!sensor.running)
                }.controlSize(.large).tint(.black)
                Toggle("Short voice alerts", isOn: $sensor.voiceEnabled).tint(.black)
                DisclosureGroup("How to read the distances") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Left, Ahead, and Right match the three boxes in the camera view. Hold the phone upright and aim forward while stationary.")
                        Text("Meters describe the nearest supported surface patch, not an identified object or a guaranteed free path. The sample percentage is depth coverage, not an accuracy score.")
                        Text("Unknown is intentional when depth is uncertain, outside the 0.2–4.5 m software window, or only classified floor is sampled. Re-aim slowly at an opaque nearby wall or furniture; never assume Unknown means clear.")
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
