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
                Text("Face the phone forward. Follow one direction at a time as obstacles get closer.")
                    .font(.subheadline)
                if sensor.running { liveCard }
                controls
                Text(sensor.status).font(.caption).foregroundStyle(.secondary)
                distanceCards
                ZStack {
                    SensorPreview(sensor: sensor)
                    if !sensor.running {
                        Color.black
                        VStack(spacing: 12) {
                            Image(systemName: "viewfinder").font(.largeTitle)
                            Text(sensor.supported ? "Live obstacle alerts" : "LiDAR hardware required")
                            Text(sensor.supported ? "Start to use the rear camera and LiDAR." : "Use a supported physical iPhone Pro or iPad Pro. The simulator has no sensor.")
                                .font(.caption).multilineTextAlignment(.center)
                        }.foregroundStyle(.white).padding()
                    }
                }.aspectRatio(1.1, contentMode: .fit).clipped()
                    .accessibilityLabel("Rear-camera preview. Only the measured sensing band is analyzed.")
                Toggle("Voice alerts", isOn: $sensor.voiceEnabled).tint(.black)
                DisclosureGroup("Audio settings") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Voice speed").font(.subheadline)
                        Slider(value: $sensor.voiceSpeed, in: 0.35...0.6, step: 0.01) {
                            Text("Voice speed")
                        } minimumValueLabel: { Text("Slower").font(.caption) } maximumValueLabel: { Text("Faster").font(.caption) }
                            .tint(.black)
                        Text("Directions are short. A new turn can interrupt general commentary; STOP or a changed path cancels an old turn. Repeat does not restart a sentence. VoiceOver voice and speed settings take precedence.")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(.top, 8)
                }
                DisclosureGroup("What these alerts mean") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("The app measures three gravity-level bands: left, ahead and right. Floor classification can improve filtering automatically but is never a setup requirement.")
                        Text("An obstacle ahead gives a slow-down warning. As it gets close, TURN LEFT or TURN RIGHT points toward a side with more measured room. The choice stays the same while that side remains supported by fresh depth.")
                        Text("Turn slowly with the phone facing along your body. The app follows the new view and updates as the obstacle leaves the way ahead. The phone only measures visible surfaces; a turn does not establish footing or full body clearance.")
                        Text("Missing or uncertain depth never becomes an open route. If neither side is reliably measured, STOP is the correct output.")
                        Text("STOP can mean close surfaces in all three bands, insufficient depth, or an immediate close obstacle. The explanation below it gives the reason. A wall filling the view provides no measured side opening.")
                        Text("The prototype begins avoidance at 1.6 m and releases it at 2.0 m, so small distance changes do not keep switching the answer. A 0.65 m close hit immediately triggers STOP. These fixed thresholds have not been validated as safe stopping distances.")
                    }.font(.caption).padding(.top, 8)
                }
                Text("Not validated for independent navigation. Low obstacles, overhead hazards, steps, drop-offs and glass can be missed. The arrow does not verify footing or full body clearance. Test with a sighted helper and keep using established mobility aids. Never use for road crossing.")
                    .font(.caption).foregroundStyle(.secondary)
                Text("No API key, recording, uploads or distance calibration. Processing stays on this device.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(.white).foregroundStyle(.black).preferredColorScheme(.light)
            .onChange(of: phase) { _, newPhase in
                if newPhase == .active { sensor.finishPermissionStartIfNeeded() }
                else if newPhase == .background || !sensor.requestingPermission { sensor.stop() }
            }
            .onDisappear { sensor.stop() }
    }

    private var liveCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("LIVE OBSTACLE ALERTS").font(.caption.bold())
            HStack(spacing: 16) {
                Image(systemName: adviceSymbol).font(.system(size: 44, weight: .bold)).accessibilityHidden(true)
                Text(sensor.liveAction.title).font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
            }
            if let distance = sensor.regions[.ahead]?.nearestHit {
                Text(String(format: "Nearest measured ahead · %.1f m", distance)).font(.title3.bold())
            }
            Text(sensor.liveAction.detail).font(.subheadline)
            Text("Limited sensing band—not a safe-route detector.").font(.caption.bold())
            DisclosureGroup("Measurement details") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Sector.allCases, id: \.self) { sector in
                        if let region = sensor.regions[sector] {
                            Text("\(sector.rawValue.capitalized): \(region.reading.label); \(Int((region.reading.coverage * 100).rounded()))% high-confidence coverage.")
                            Text("\(Int((region.nonFloorCoverage * 100).rounded()))% non-floor coverage for direction checks.")
                            if let nearest = region.nearestHit {
                                Text(String(format: "Closest individual sample: %.1f m", nearest))
                            }
                        }
                    }
                    Text("Floor filtering: \(sensor.floorKnown ? "available automatically" : "not yet available; proximity alerts still run").")
                    if let milliseconds = sensor.analysisMilliseconds {
                        Text(String(format: "Last analysis pass: %.1f ms. Not end-to-end response time.", milliseconds))
                    }
                    Text("Coverage is sample availability, not accuracy. Side hints require broader coverage and reject any measured closer sample.")
                }.font(.caption).padding(.top, 8)
            }.font(.caption).tint(.white)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(.black).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .contain).accessibilityIdentifier("live-proximity-guidance")
        // Speech owns announcements; do not create a second live-region queue.
    }

    private var adviceSymbol: String {
        switch sensor.liveAction {
        case .ahead: return "arrow.up"
        case .caution, .sideClose: return "exclamationmark.triangle"
        case .turn(.left): return "arrow.turn.up.left"
        case .turn(.right): return "arrow.turn.up.right"
        case .starting: return "viewfinder"
        case .turn(.ahead), .stop: return "hand.raised"
        }
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
            Text(sensor.running ? "Stop camera" : "Start").foregroundStyle(.white)
        }.buttonStyle(.borderedProminent).tint(.black).disabled(!sensor.supported || sensor.requestingPermission)
        Button("Repeat") { sensor.repeatCue() }.buttonStyle(.bordered).disabled(!sensor.running || !sensor.voiceEnabled)
            .accessibilityHint("Repeats current advice when speech is idle.")
        Button("Distances") { sensor.readDistances() }.buttonStyle(.bordered).disabled(!sensor.running || !sensor.voiceEnabled)
            .accessibilityHint("Reads current left, ahead and right distances.")
    }
    private var distanceCards: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(Sector.allCases, id: \.self) { sector in
                VStack(spacing: 8) {
                    Text(sector.rawValue.capitalized).font(.caption)
                    Text(distanceLabel(sector))
                        .font(.headline).minimumScaleFactor(0.7)
                    Text(sideStatus(sector)).font(.caption2)
                }.frame(maxWidth: .infinity, alignment: .top).padding(10).frame(maxHeight: .infinity, alignment: .top)
                    .background(isTurnTarget(sector) ? Color.black : Color.white)
                    .foregroundStyle(isTurnTarget(sector) ? Color.white : Color.black)
                    .overlay(Rectangle().stroke(isTurnTarget(sector) ? .black : .gray.opacity(0.3), lineWidth: 1))
                    .accessibilityElement(children: .combine).accessibilityIdentifier("distance-\(sector.rawValue)")
            }
        }.fixedSize(horizontal: false, vertical: true)
    }
    private func distanceLabel(_ sector: Sector) -> String {
        guard sensor.running else { return "—" }
        guard let meters = sensor.regions[sector]?.nearestHit else { return "Unknown" }
        return String(format: "~%.1f m", meters)
    }
    private func isTurnTarget(_ sector: Sector) -> Bool {
        if case .turn(let target) = sensor.liveAction { return target == sector }
        return false
    }
    private func sideStatus(_ sector: Sector) -> String {
        guard sensor.running, let region = sensor.regions[sector], let distance = region.nearestHit else { return "Not measured" }
        if isTurnTarget(sector) { return "Turn this way" }
        guard region.supportsAhead else { return "Partial reading" }
        return distance <= LiveProximityGuide.turnDistance ? "Close surface" : "Closest sample"
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
