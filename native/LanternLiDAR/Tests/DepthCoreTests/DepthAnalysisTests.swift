import XCTest
@testable import DepthCore

final class DepthAnalysisTests: XCTestCase {
    private func grid(_ meters: Double = 2, confidence: UInt8 = 2, floor: Bool = false) -> [DepthCell] {
        Array(repeating: DepthCell(meters: meters, confidence: confidence, isKnownFloor: floor), count: 120)
    }
    func testMeterReadingNeedsNoMeasuredReferenceOrObjectClass() {
        XCTAssertEqual(DepthAnalysis.analyze(grid(1.4)).meters, 1.4)
    }
    func testLowAndMediumConfidenceAreUnknown() {
        XCTAssertNil(DepthAnalysis.analyze(grid(confidence: 0)).meters)
        XCTAssertNil(DepthAnalysis.analyze(grid(confidence: 1)).meters)
        XCTAssertNil(DepthAnalysis.analyze(grid(confidence: 255)).meters)
    }
    func testMalformedPublicReadingCannotProduceNaNOrFalseGuidance() {
        XCTAssertEqual(SectorReading(meters: .nan, coverage: 1).label, "Unknown")
        XCTAssertNil(SectorReading(meters: .infinity, coverage: 1).meters)
        XCTAssertNil(SectorReading(meters: 1, coverage: .nan).meters)
        XCTAssertNil(SectorReading(meters: 1, coverage: 0.1).meters)
        let cue = DepthGuidance.cue([.ahead: SectorReading(meters: .nan, coverage: 1)], floorKnown: true)
        XCTAssertEqual(cue.title, "Distance unknown")
    }
    func testNonFiniteZeroNegativeAndOutsideSoftwareRangeAreUnknown() {
        for value in [Double.nan, .infinity, -.infinity, 0, -2, 0.1, 7] {
            XCTAssertNil(DepthAnalysis.analyze(grid(value)).meters)
        }
    }
    func testMalformedDimensionsAreRejected() {
        XCTAssertNil(DepthAnalysis.analyze([], columns: 0, rows: 0).meters)
        XCTAssertNil(DepthAnalysis.analyze(grid(), columns: 10, rows: 11).meters)
        XCTAssertNil(DepthAnalysis.analyze([], columns: Int.max, rows: Int.max).meters)
    }
    func testInsufficientReliableCoverageIsNotCalledClear() {
        var cells = grid(confidence: 0)
        for i in 0..<30 { cells[i] = DepthCell(meters: 2, confidence: 2) }
        let result = DepthAnalysis.analyze(cells)
        XCTAssertNil(result.meters)
        XCTAssertEqual(result.coverage, 0.25)
    }
    func testIsolatedNearOutlierDoesNotBecomeDistance() {
        var cells = grid(3)
        cells[45] = DepthCell(meters: 0.3, confidence: 2)
        XCTAssertEqual(DepthAnalysis.analyze(cells).meters, 3)
    }
    func testConnectedNearPatchTakesPriorityOverFarWall() {
        var cells = grid(3)
        for i in [44, 45, 46, 54, 55, 56] { cells[i] = DepthCell(meters: 0.9, confidence: 2) }
        XCTAssertEqual(DepthAnalysis.analyze(cells).meters, 0.9)
    }
    func testDispersedOutliersCannotCombineIntoOneNearPatch() {
        var cells = grid(3)
        for i in [0, 9, 40, 49, 80, 89] { cells[i] = DepthCell(meters: 0.4, confidence: 2) }
        XCTAssertEqual(DepthAnalysis.analyze(cells).meters, 3)
    }
    func testKnownFloorDoesNotBecomeObstacleOrSafeRoute() {
        let result = DepthAnalysis.analyze(grid(1, floor: true))
        XCTAssertNil(result.meters)
        XCTAssertEqual(result.coverage, 1)
        XCTAssertEqual(result.label, "Unknown")
    }
    func testObstacleAboveClassifiedFloorRemainsPresent() {
        var cells = grid(1, floor: true)
        for i in [44, 45, 46, 54, 55, 56] { cells[i] = DepthCell(meters: 0.8, confidence: 2) }
        XCTAssertEqual(DepthAnalysis.analyze(cells).meters, 0.8)
    }
    func testMissingOrLowConfidenceFrameClearsSmoothedMetersAtOnce() {
        var smoother = DepthSmoother()
        _ = smoother.update([.ahead: SectorReading(meters: 2, coverage: 1)], capturedAt: 1, now: 1.1)
        let lost = smoother.update([.ahead: .unknown], capturedAt: 1.2, now: 1.3)
        XCTAssertNil(lost[.ahead]?.meters)
        let returned = smoother.update([.ahead: SectorReading(meters: 1.4, coverage: 1)], capturedAt: 1.4, now: 1.5)
        XCTAssertEqual(returned[.ahead]?.meters, 1.4) // No chair reacquisition or confirmation.
    }
    func testNewCloserSurfaceDoesNotWaitBehindFarMedian() {
        var smoother = DepthSmoother()
        for stamp in [1.0, 1.1, 1.2] {
            _ = smoother.update([.ahead: SectorReading(meters: 3, coverage: 1)], capturedAt: stamp, now: stamp)
        }
        let close = smoother.update([.ahead: SectorReading(meters: 0.8, coverage: 1)], capturedAt: 1.3, now: 1.3)
        XCTAssertEqual(close[.ahead]?.meters, 0.8)
    }
    func testFartherNoiseIsMedianSmoothed() {
        var smoother = DepthSmoother()
        var result: [Sector: SectorReading] = [:]
        for (index, value) in [1.0, 1.1, 1.8].enumerated() {
            result = smoother.update([.ahead: SectorReading(meters: value, coverage: 1)], capturedAt: Double(index) * 0.1, now: Double(index) * 0.1)
        }
        XCTAssertEqual(result[.ahead]?.meters, 1.1)
    }
    func testStaleFutureAndOutOfOrderFramesCannotRetainDistance() {
        XCTAssertFalse(DepthAnalysis.isFresh(capturedAt: 1, now: 1.6))
        XCTAssertFalse(DepthAnalysis.isFresh(capturedAt: 2, now: 1))
        XCTAssertFalse(DepthAnalysis.isFresh(capturedAt: .nan, now: 1))
        var smoother = DepthSmoother()
        _ = smoother.update([.ahead: SectorReading(meters: 2, coverage: 1)], capturedAt: 1, now: 1)
        XCTAssertTrue(smoother.update([:], capturedAt: 0.5, now: 1.1).isEmpty)
    }
    func testLongGapDoesNotMixOldSceneIntoNewReading() {
        var smoother = DepthSmoother()
        _ = smoother.update([.ahead: SectorReading(meters: 1, coverage: 1)], capturedAt: 1, now: 1)
        let newScene = smoother.update([.ahead: SectorReading(meters: 3, coverage: 1)], capturedAt: 2, now: 2)
        XCTAssertEqual(newScene[.ahead]?.meters, 3)
    }
    func testDirectionIsWhereToCheckNotWhereToWalk() {
        let cue = DepthGuidance.cue([
            .ahead: SectorReading(meters: 0.8, coverage: 1),
            .left: SectorReading(meters: 1, coverage: 1),
            .right: SectorReading(meters: 3, coverage: 1)
        ], floorKnown: true)
        XCTAssertTrue(cue.speech.contains("Check right"))
        XCTAssertFalse(cue.speech.lowercased().contains("walk"))
        XCTAssertFalse(cue.speech.lowercased().contains("safe"))
    }
    func testUnknownSideOrUnknownFloorCannotSelectDirection() {
        let input: [Sector: SectorReading] = [
            .ahead: SectorReading(meters: 0.8, coverage: 1),
            .left: SectorReading(meters: 1, coverage: 1),
            .right: SectorReading(meters: 3, coverage: 1)
        ]
        XCTAssertFalse(DepthGuidance.cue(input, floorKnown: false).speech.contains("Check right"))
        var missing = input; missing[.left] = .unknown
        XCTAssertFalse(DepthGuidance.cue(missing, floorKnown: true).speech.contains("Check right"))
    }
    func testUnknownDepthNeverAnnouncesClearance() {
        let cue = DepthGuidance.cue([:], floorKnown: true)
        XCTAssertEqual(cue.title, "Distance unknown")
        XCTAssertTrue(cue.urgent)
        XCTAssertFalse(cue.speech.contains("clear"))
    }
    func testPinholeUnprojectionUsesARKitCameraAxesAndActualIntrinsics() {
        XCTAssertEqual(DepthProjection.cameraPoint(imageX: 320, imageY: 240, depth: 2, fx: 500, fy: 500, cx: 320, cy: 240), SIMD3(0, 0, -2))
        XCTAssertEqual(DepthProjection.cameraPoint(imageX: 570, imageY: 490, depth: 2, fx: 500, fy: 500, cx: 320, cy: 240), SIMD3(1, -1, -2))
        XCTAssertNil(DepthProjection.cameraPoint(imageX: 320, imageY: 240, depth: .nan, fx: 500, fy: 500, cx: 320, cy: 240))
        XCTAssertNil(DepthProjection.cameraPoint(imageX: 320, imageY: 240, depth: 2, fx: 0, fy: 500, cx: 320, cy: 240))
    }
    func testFloorPolygonDoesNotMaskBoundingBoxCornersOutsideRotatedFloor() {
        let diamond: [SIMD2<Double>] = [SIMD2(0, -1), SIMD2(1, 0), SIMD2(0, 1), SIMD2(-1, 0)]
        XCTAssertTrue(FloorBoundary.contains(SIMD2(0, 0), vertices: diamond))
        XCTAssertFalse(FloorBoundary.contains(SIMD2(0.9, 0.9), vertices: diamond))
        XCTAssertFalse(FloorBoundary.contains(SIMD2(2, 0), vertices: diamond))
        XCTAssertTrue(FloorBoundary.contains(SIMD2(0, 0), vertices: Array(diamond.reversed())))
    }
    func testInvalidFloorBoundariesCannotSuppressGeometry() {
        XCTAssertFalse(FloorBoundary.contains(SIMD2(0, 0), vertices: []))
        XCTAssertFalse(FloorBoundary.contains(SIMD2(0, 0), vertices: [SIMD2(0, 0), SIMD2(1, 0)]))
        XCTAssertFalse(FloorBoundary.contains(SIMD2(0, 0), vertices: [SIMD2(.nan, 0), SIMD2(1, 1), SIMD2(0, 1)]))
        XCTAssertFalse(FloorBoundary.contains(SIMD2(.infinity, 0), vertices: [SIMD2(0, 0), SIMD2(1, 1), SIMD2(0, 1)]))
    }
}
