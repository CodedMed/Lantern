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
        let input: [Sector: SectorReading] = [
            .ahead: SectorReading(meters: 0.8, coverage: 1),
            .left: SectorReading(meters: 1, coverage: 1),
            .right: SectorReading(meters: 3, coverage: 1)
        ]
        var guide = DepthInspectionGuide()
        let assessment = settle(&guide, input)
        let cue = DepthGuidance.cue(input, floorKnown: true, inspection: assessment)
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

    func testUnknownReasonsDoNotRelaxConfidenceOrRange() {
        let low = DepthAnalysis.analyze(grid(1.4, confidence: 1))
        XCTAssertNil(low.meters)
        XCTAssertEqual(low.issue, .lowConfidence)
        for meters in [0.1, 7.0] {
            let outside = DepthAnalysis.analyze(grid(meters))
            XCTAssertNil(outside.meters)
            XCTAssertEqual(outside.issue, .outsideRange)
        }
        XCTAssertEqual(DepthAnalysis.analyze(grid(1.4)).issue, nil)
    }

    func testFloorOnlyExplainsWhyMetersAreMissingWithoutClaimingClearance() {
        let result = DepthAnalysis.analyze(grid(1, floor: true))
        XCTAssertNil(result.meters)
        XCTAssertEqual(result.issue, .floorOnly)
        XCTAssertTrue(result.explanation.contains("Aim forward"))
        XCTAssertEqual(DepthGuidance.cue([.ahead: result], floorKnown: true).key, "unknown")
    }

    func testTooSmallObstacleIsNotMisreportedAsFloorOnly() {
        var cells = grid(1, floor: true)
        for i in [44, 45, 46, 54, 55] { cells[i] = DepthCell(meters: 0.8, confidence: 2) }
        let result = DepthAnalysis.analyze(cells)
        XCTAssertNil(result.meters)
        XCTAssertEqual(result.issue, .noSurface)
    }

    func testSmoothingPreservesUnknownExplanationAndClearsOldDistance() {
        var smoother = DepthSmoother()
        _ = smoother.update([.ahead: SectorReading(meters: 1, coverage: 1)], capturedAt: 1, now: 1)
        let lost = smoother.update([.ahead: DepthAnalysis.analyze(grid(7))], capturedAt: 1.1, now: 1.1)
        XCTAssertNil(lost[.ahead]?.meters)
        XCTAssertEqual(lost[.ahead]?.issue, .outsideRange)
    }

    func testCoverageExplanationIsNotAnAccuracyScore() {
        let reading = SectorReading(meters: 1.4, coverage: 0.7, issue: .floorOnly)
        XCTAssertNil(reading.issue)
        XCTAssertTrue(reading.explanation.contains("70%"))
        XCTAssertTrue(reading.explanation.contains("samples"))
        XCTAssertFalse(reading.explanation.contains("accuracy"))
    }

    private var routineCue: DepthCue {
        DepthGuidance.cue([.ahead: SectorReading(meters: 2, coverage: 1)], floorKnown: false)
    }
    private var closeCue: DepthCue {
        DepthGuidance.cue([.ahead: SectorReading(meters: 0.7, coverage: 1)], floorKnown: false)
    }

    func testNewWarningCanInterruptRoutineSpeech() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 10, speaking: false, manual: true))
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 11, speaking: true))
    }

    func testUnknownAndDirectionChangesFinishTheCurrentWarning() {
        var policy = DepthSpeechPolicy()
        let unknown = DepthGuidance.cue([:], floorKnown: false)
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 10, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 10.5, speaking: true))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 11, speaking: true))
        policy.didFinish(at: 12)
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 12.2, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 12.7, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(unknown, now: 13, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 14, speaking: true))
    }

    func testRoutineSpeechWaitsForCompletionPlusANaturalGap() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 10, speaking: false, manual: true))
        let changed = DepthGuidance.cue([.ahead: SectorReading(meters: 3, coverage: 1)], floorKnown: false)
        XCTAssertFalse(policy.shouldSpeak(changed, now: 14, speaking: true))
        policy.didFinish(at: 15)
        XCTAssertFalse(policy.shouldSpeak(changed, now: 15.1, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(changed, now: 15.6, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(changed, now: 15.9, speaking: false))
    }

    func testRepeatDoesNotCutOffAnActiveSentence() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 10, speaking: false, manual: true))
        XCTAssertFalse(policy.shouldSpeak(routineCue, now: 10.1, speaking: true, manual: true))
        policy.didFinish(at: 12)
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 12.2, speaking: false, manual: true))
    }

    func testIntermittentDepthDoesNotRepeatedlyRestartTheSameUnknownWarning() {
        var policy = DepthSpeechPolicy()
        let unknown = DepthGuidance.cue([:], floorKnown: false)
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 10, speaking: false, manual: true))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 10.1, speaking: true))
        XCTAssertFalse(policy.shouldSpeak(routineCue, now: 10.2, speaking: true))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 10.3, speaking: true))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 10.5, speaking: true))
        policy.didFinish(at: 12)
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 12.1, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 12.6, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(unknown, now: 13, speaking: false))
    }

    func testSpeechPolicyRejectsNonFiniteAndBackwardTime() {
        var policy = DepthSpeechPolicy()
        XCTAssertFalse(policy.shouldSpeak(routineCue, now: .nan, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 10, speaking: false, manual: true))
        XCTAssertFalse(policy.shouldSpeak(closeCue, now: 9, speaking: false, manual: true))
    }

    func testFlickeringCandidatesAreNotNarrated() {
        var policy = DepthSpeechPolicy()
        let unknown = DepthGuidance.cue([:], floorKnown: false)
        XCTAssertFalse(policy.shouldSpeak(routineCue, now: 1, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 1.2, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(routineCue, now: 1.4, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 1.6, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(unknown, now: 2, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(unknown, now: 2.5, speaking: false))
    }

    func testSamePriorityCloseAheadChangesNeverInterrupt() {
        var policy = DepthSpeechPolicy()
        let anotherDirection = DepthGuidance.cue([
            .ahead: SectorReading(meters: 0.8, coverage: 1),
            .left: SectorReading(meters: 1, coverage: 1),
            .right: SectorReading(meters: 3, coverage: 1)
        ], floorKnown: true, inspection: .check(.right))
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 1, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(anotherDirection, now: 3, speaking: true))
        XCTAssertFalse(policy.shouldSpeak(closeCue, now: 5, speaking: true))
    }

    func testLevelOscillationDoesNotRepeatedlyInterrupt() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 10, speaking: false, manual: true))
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 11, speaking: true))
        policy.didFinish(at: 13)
        XCTAssertFalse(policy.shouldSpeak(routineCue, now: 14, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 14.5, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(closeCue, now: 15.5, speaking: true))
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 17, speaking: true))
    }

    func testPersistentContextCanBeRepeatedWithoutEveryFrameChatter() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 10, speaking: false))
        policy.didFinish(at: 12)
        XCTAssertFalse(policy.shouldSpeak(closeCue, now: 20, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(closeCue, now: 21.5, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 22, speaking: false))
    }

    func testShortWarningsPutPauseBeforeDistanceOrDirection() {
        XCTAssertTrue(closeCue.speech.hasPrefix("Pause."))
        XCTAssertTrue(DepthGuidance.cue([:], floorKnown: false).speech.hasPrefix("Pause."))
        XCTAssertFalse(closeCue.speech.contains("walk"))
    }

    func testCloserDistanceCanUpdateAfterWarningFinishesWithoutInterruptingIt() {
        var policy = DepthSpeechPolicy()
        let closer = DepthGuidance.cue([.ahead: SectorReading(meters: 0.2, coverage: 1)], floorKnown: false)
        XCTAssertNotEqual(closer.key, closeCue.key)
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 10, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(closer, now: 11, speaking: true))
        policy.didFinish(at: 12.5)
        XCTAssertFalse(policy.shouldSpeak(closer, now: 12.6, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(closer, now: 13, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(closer, now: 13.4, speaking: false))
    }

    private var uprightPose: InspectionPose {
        InspectionPose(position: SIMD3(0, 0, 0), forward: SIMD3(0, 0, -1), up: SIMD3(0, 1, 0))!
    }
    private func scene(_ left: Double = 1, _ ahead: Double = 0.8, _ right: Double = 3, coverage: Double = 1) -> [Sector: SectorReading] {
        [.left: SectorReading(meters: left, coverage: coverage), .ahead: SectorReading(meters: ahead, coverage: coverage), .right: SectorReading(meters: right, coverage: coverage)]
    }
    private func settle(_ guide: inout DepthInspectionGuide, _ input: [Sector: SectorReading], start: Double = 1,
                        pose: InspectionPose? = nil) -> InspectionAssessment {
        var result = InspectionAssessment.stale
        for i in 0...10 {
            let stamp = start + Double(i) * 0.1
            result = guide.update(input, floorKnown: true, pose: pose ?? uprightPose, capturedAt: stamp, now: stamp)
        }
        return result
    }
    func testDirectionNeedsTimeAndDistinctFramesNotOneLargeDistance() {
        var guide = DepthInspectionGuide()
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 1, now: 1), .settling)
        XCTAssertNil(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 1.4, now: 1.4).target)
        XCTAssertNil(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 1.81, now: 1.81).target) // Only three frames.
        _ = guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 1.9, now: 1.9)
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 2, now: 2), .check(.right))
    }
    func testDirectionSelectsLeftOrRightSymmetrically() {
        var guide = DepthInspectionGuide()
        XCTAssertEqual(settle(&guide, scene()), .check(.right))
        guide.reset()
        XCTAssertEqual(settle(&guide, scene(3, 0.8, 1)), .check(.left))
    }
    func testAheadIsInspectedWithoutNeedlessSideChanges() {
        var guide = DepthInspectionGuide()
        XCTAssertEqual(settle(&guide, scene(3, 2, 4)), .check(.ahead))
    }
    func testTiesAndSmallDistanceDifferencesHaveNoSidePreference() {
        for input in [scene(3, 0.8, 3), scene(3, 0.8, 3.2), scene(1, 1.6, 1.9)] {
            var guide = DepthInspectionGuide()
            XCTAssertEqual(settle(&guide, input), .noPreference)
        }
    }
    func testAllNearbySurfacesNeverSelectDirection() {
        var guide = DepthInspectionGuide()
        XCTAssertEqual(settle(&guide, scene(0.6, 0.8, 1.2)), .nearbySurfaces)
    }
    func testUnknownFloorOrAnyUnknownRegionImmediatelyWithdrawsDirection() {
        for sector in Sector.allCases {
            var guide = DepthInspectionGuide()
            XCTAssertNotNil(settle(&guide, scene()).target)
            var input = scene(); input[sector] = .unknown
            XCTAssertEqual(guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: 2.1, now: 2.1), .scan(sector))
            XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 2.2, now: 2.2), .settling)
        }
        var guide = DepthInspectionGuide()
        _ = settle(&guide, scene())
        XCTAssertEqual(guide.update(scene(), floorKnown: false, pose: uprightPose, capturedAt: 2.1, now: 2.1), .floorUnknown)
    }
    func testValidDisplayDistanceDoesNotBypassStrongerDirectionCoverage() {
        for coverage in [0.35, 0.5, 0.59] {
            var guide = DepthInspectionGuide()
            XCTAssertNotNil(scene(coverage: coverage)[.right]?.meters)
            XCTAssertEqual(settle(&guide, scene(coverage: coverage)), .scan(.ahead))
        }
    }
    func testMissingDictionaryEntryDoesNotTreatMissingSideAsFarAway() {
        var guide = DepthInspectionGuide()
        var input = scene(); input.removeValue(forKey: .left)
        XCTAssertEqual(settle(&guide, input), .scan(.left))
    }
    func testFloorOnlyOrOutsideRangeDoesNotMeanDirectionIsOpen() {
        for value in [DepthAnalysis.analyze(grid(1, floor: true)), DepthAnalysis.analyze(grid(7)), SectorReading(meters: .infinity, coverage: 1)] {
            var guide = DepthInspectionGuide()
            var input = scene(); input[.right] = value
            XCTAssertEqual(settle(&guide, input), .scan(.right))
        }
    }
    func testNewNearbySurfaceRemovesDirectionWithoutWaitingForSettling() {
        var guide = DepthInspectionGuide()
        _ = settle(&guide, scene())
        XCTAssertEqual(guide.update(scene(1, 0.8, 0.6), floorKnown: true, pose: uprightPose, capturedAt: 2.1, now: 2.1), .nearbySurfaces)
    }
    func testDirectionReversalIsWithheldUntilNewViewSettles() {
        var guide = DepthInspectionGuide()
        XCTAssertEqual(settle(&guide, scene()), .check(.right))
        XCTAssertEqual(guide.update(scene(3, 0.8, 1), floorKnown: true, pose: uprightPose, capturedAt: 2.1, now: 2.1), .settling)
        XCTAssertEqual(settle(&guide, scene(3, 0.8, 1), start: 2.2), .check(.left))
    }
    func testAlternatingDirectionsNeverAccumulateIntoARecommendation() {
        var guide = DepthInspectionGuide()
        for i in 0...40 {
            let stamp = Double(i) * 0.1
            let input = i % 2 == 0 ? scene() : scene(3, 0.8, 1)
            XCTAssertNil(guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: stamp, now: stamp).target)
        }
    }
    func testPoseTranslationWithdrawsDirectionAndRequiresNewSettling() {
        var guide = DepthInspectionGuide()
        _ = settle(&guide, scene())
        let shifted = InspectionPose(position: SIMD3(0.15, 0, 0), forward: SIMD3(0, 0, -1), up: SIMD3(0, 1, 0))!
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: shifted, capturedAt: 2.1, now: 2.1), .moving)
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: shifted, capturedAt: 2.2, now: 2.2), .settling)
        XCTAssertEqual(settle(&guide, scene(), start: 2.3, pose: shifted), .check(.right))
    }
    func testSlowCumulativeRotationCannotKeepAnOldDirection() {
        var guide = DepthInspectionGuide()
        _ = settle(&guide, scene())
        var result = InspectionAssessment.stale
        for i in 1...6 {
            let angle = Double(i * 2) * .pi / 180
            let rotated = InspectionPose(position: SIMD3(0, 0, 0), forward: SIMD3(-sin(angle), 0, -cos(angle)), up: SIMD3(0, 1, 0))!
            let stamp = 2 + Double(i) * 0.1
            result = guide.update(scene(), floorKnown: true, pose: rotated, capturedAt: stamp, now: stamp)
        }
        XCTAssertEqual(result, .moving)
    }
    func testPitchAndRollOutsideWindowWithholdDirection() {
        let angle = 40.0 * .pi / 180
        let pitch = InspectionPose(position: .zero, forward: SIMD3(0, sin(angle), -cos(angle)), up: SIMD3(0, cos(angle), sin(angle)))!
        let roll = InspectionPose(position: .zero, forward: SIMD3(0, 0, -1), up: SIMD3(sin(angle), cos(angle), 0))!
        for pose in [pitch, roll] {
            var guide = DepthInspectionGuide()
            XCTAssertEqual(settle(&guide, scene(), pose: pose), .tilted)
        }
    }
    func testInvalidPoseIsRejectedRatherThanGuessingDirection() {
        XCTAssertNil(InspectionPose(position: SIMD3(.nan, 0, 0), forward: SIMD3(0, 0, -1), up: SIMD3(0, 1, 0)))
        XCTAssertNil(InspectionPose(position: .zero, forward: .zero, up: SIMD3(0, 1, 0)))
        XCTAssertNil(InspectionPose(position: .zero, forward: SIMD3(0, 0, -1), up: SIMD3(0, 0, -1)))
        var guide = DepthInspectionGuide()
        _ = settle(&guide, scene())
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: nil, capturedAt: 2.1, now: 2.1), .stale)
    }
    func testStaleFutureRepeatedAndOutOfOrderFramesCannotRetainDirection() {
        for (stamp, now) in [(2.1, 2.7), (3.0, 2.1), (2.0, 2.1), (1.9, 2.1), (Double.nan, 2.1), (2.1, Double.nan)] {
            var guide = DepthInspectionGuide()
            _ = settle(&guide, scene())
            XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: stamp, now: now), .stale)
        }
    }
    func testLongGapAndStopResetRequireNewSettling() {
        var guide = DepthInspectionGuide()
        _ = settle(&guide, scene())
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 3, now: 3), .settling)
        guide.reset()
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 3.1, now: 3.1), .settling)
    }
    func testUnknownDirectionDoesNotDelayImmediateCloseAheadWarning() {
        var guide = DepthInspectionGuide()
        let inspection = guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 1, now: 1)
        let cue = DepthGuidance.cue(scene(), floorKnown: true, inspection: inspection)
        var speech = DepthSpeechPolicy()
        XCTAssertEqual(cue.speechPriority, 2)
        XCTAssertTrue(speech.shouldSpeak(cue, now: 1, speaking: false))
        XCTAssertTrue(cue.speech.hasPrefix("Pause."))
        XCTAssertFalse(cue.speech.contains("Check right"))
    }
    func testDirectionUpdatesPreserveSentenceCompletionAndGap() {
        let input = scene()
        let early = DepthGuidance.cue(input, floorKnown: true, inspection: .settling)
        let confirmed = DepthGuidance.cue(input, floorKnown: true, inspection: .check(.right))
        var speech = DepthSpeechPolicy()
        XCTAssertTrue(speech.shouldSpeak(early, now: 1, speaking: false))
        XCTAssertFalse(speech.shouldSpeak(confirmed, now: 2, speaking: true))
        XCTAssertFalse(speech.shouldSpeak(confirmed, now: 3, speaking: true))
        speech.didFinish(at: 4)
        XCTAssertFalse(speech.shouldSpeak(confirmed, now: 4.1, speaking: false))
        XCTAssertFalse(speech.shouldSpeak(confirmed, now: 4.5, speaking: false))
        XCTAssertTrue(speech.shouldSpeak(confirmed, now: 4.9, speaking: false))
    }
    func testDirectionSelectionInvariantsAcrossDistanceCombinations() {
        for left in [0.3, 0.7, 1.0, 1.6, 1.8, 2.5, 4.0] {
            for ahead in [0.3, 0.7, 1.0, 1.6, 1.8, 2.5, 4.0] {
                for right in [0.3, 0.7, 1.0, 1.6, 1.8, 2.5, 4.0] {
                    var guide = DepthInspectionGuide()
                    let result = settle(&guide, scene(left, ahead, right))
                    switch result.target {
                    case .left:
                        XCTAssertGreaterThanOrEqual(left, 1.75)
                        XCTAssertGreaterThanOrEqual(left - ahead, 0.6 - 1e-9)
                        XCTAssertGreaterThanOrEqual(left - right, 0.5 - 1e-9)
                    case .right:
                        XCTAssertGreaterThanOrEqual(right, 1.75)
                        XCTAssertGreaterThanOrEqual(right - ahead, 0.6 - 1e-9)
                        XCTAssertGreaterThanOrEqual(right - left, 0.5 - 1e-9)
                    case .ahead:
                        XCTAssertGreaterThanOrEqual(ahead, 1.75)
                        XCTAssertGreaterThanOrEqual(min(left, right), 0.75)
                    case nil: break
                    }
                }
            }
        }
    }
    func testStrongSteadyReadingsCanConfirmOnFastPath() {
        var guide = DepthInspectionGuide()
        for stamp in [1.0, 1.12, 1.24] {
            XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: stamp, now: stamp), .settling)
        }
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 1.36, now: 1.36), .check(.right))
    }
    func testFastPathDoesNotRelaxCoverageOrSeparation() {
        for input in [scene(coverage: 0.79), scene(1, 0.8, 1.9), scene(2.3, 0.8, 3)] {
            var guide = DepthInspectionGuide()
            for stamp in [1.0, 1.12, 1.24, 1.36, 1.48] {
                XCTAssertEqual(guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: stamp, now: stamp), .settling)
            }
            XCTAssertEqual(guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: 1.9, now: 1.9), .check(.right))
        }
    }
    func testVariableDistancesFallBackToNormalSettling() {
        var guide = DepthInspectionGuide()
        for (i, right) in [3.0, 3.4, 3.0, 3.4, 3.0].enumerated() {
            let stamp = 1 + Double(i) * 0.12
            XCTAssertEqual(guide.update(scene(1, 0.8, right), floorKnown: true, pose: uprightPose, capturedAt: stamp, now: stamp), .settling)
        }
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 1.9, now: 1.9), .check(.right))
    }
    func testFastPathStillWithdrawsImmediatelyAfterLossOrReversal() {
        var guide = DepthInspectionGuide()
        for stamp in [1.0, 1.12, 1.24, 1.36] {
            _ = guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: stamp, now: stamp)
        }
        XCTAssertEqual(guide.update(scene(3, 0.8, 1), floorKnown: true, pose: uprightPose, capturedAt: 1.48, now: 1.48), .settling)
        var lost = scene(); lost[.left] = .unknown
        XCTAssertEqual(guide.update(lost, floorKnown: true, pose: uprightPose, capturedAt: 1.6, now: 1.6), .scan(.left))
    }
    func testConfirmedDirectionSkipsDoubleDebounceButKeepsCompletionGap() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 1, speaking: false))
        let confirmed = DepthGuidance.cue(scene(), floorKnown: true, inspection: .check(.right))
        XCTAssertFalse(policy.shouldSpeak(confirmed, now: 1.4, speaking: true))
        policy.didFinish(at: 1.5)
        XCTAssertFalse(policy.shouldSpeak(confirmed, now: 2, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(confirmed, now: 2.31, speaking: false)) // No extra 3-second start cooldown.
    }
    func testCloseWarningsAndConfirmedDirectionsAreShortActionFirstPrompts() {
        let pending = DepthGuidance.cue(scene(), floorKnown: true, inspection: .settling)
        let ready = DepthGuidance.cue(scene(), floorKnown: true, inspection: .check(.right))
        XCTAssertEqual(pending.speech, "Pause. Surface close ahead.")
        XCTAssertEqual(ready.speech, "Pause. Check right with the phone.")
        XCTAssertLessThanOrEqual(ready.speech.split(separator: " ").count, 8)
    }
    func testDistanceDetailsAreOnDemandAndKeepUnknownRegionsUnknown() {
        var input = scene(); input[.left] = .unknown
        XCTAssertEqual(DepthGuidance.distanceReadout(input).speech,
                       "Left, unknown. Ahead, about 0.8 meters. Right, about 3.0 meters.")
        XCTAssertEqual(DepthGuidance.distanceReadout([:]).speech,
                       "Left, unknown. Ahead, unknown. Right, unknown.")
    }
    func testOnDemandDistancesNeverCutOffCurrentSpeech() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 1, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(DepthGuidance.distanceReadout(scene()), now: 1.5, speaking: true, manual: true))
        policy.didFinish(at: 2)
        XCTAssertTrue(policy.shouldSpeak(DepthGuidance.distanceReadout(scene()), now: 2.1, speaking: false, manual: true))
    }
    func testConfirmedActionDoesNotRepeatForDecimalDistanceWobble() {
        let first = DepthGuidance.cue(scene(1, 0.8, 3), floorKnown: true, inspection: .check(.right))
        let changed = DepthGuidance.cue(scene(1, 0.7, 3), floorKnown: true, inspection: .check(.right))
        XCTAssertEqual(first.key, changed.key)
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(first, now: 1, speaking: false))
        policy.didFinish(at: 2)
        XCTAssertFalse(policy.shouldSpeak(changed, now: 3, speaking: false))
    }
    func testReportedScreenshotProvidesRightScanInsteadOfDeadEnd() {
        let input: [Sector: SectorReading] = [
            .left: SectorReading(meters: 1.9, coverage: 0.77),
            .ahead: SectorReading(meters: 1.4, coverage: 0.83),
            .right: SectorReading(meters: nil, coverage: 0.2, issue: .lowConfidence)
        ]
        var guide = DepthInspectionGuide()
        let result = settle(&guide, input)
        XCTAssertEqual(result, .scan(.right))
        XCTAssertNil(result.target) // Not a measured direction comparison.
        XCTAssertEqual(result.scanTarget, .right)
        XCTAssertTrue(result.detail.contains("Do not step"))
        let cue = DepthGuidance.cue(input, floorKnown: true, inspection: result)
        XCTAssertEqual(cue.speech, "Pause. Right depth uncertain. Re-aim the phone slowly.")
        XCTAssertFalse(cue.hasConfirmedInspection)
        XCTAssertNil(input[.right]?.meters)
    }
    func testScanTargetDoesNotFlapBetweenTwoUncertainSides() {
        var guide = DepthInspectionGuide()
        var input = scene(1, 2, 3)
        input[.left] = SectorReading(meters: nil, coverage: 0.05)
        input[.right] = SectorReading(meters: nil, coverage: 0.1)
        XCTAssertEqual(guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: 1, now: 1), .scan(.left))
        input[.left] = SectorReading(meters: nil, coverage: 0.2)
        input[.right] = SectorReading(meters: nil, coverage: 0.01)
        XCTAssertEqual(guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: 1.1, now: 1.1), .scan(.left))
        input[.left] = SectorReading(meters: 1, coverage: 0.8)
        XCTAssertEqual(guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: 1.2, now: 1.2), .scan(.right))
    }
    func testUnmeasuredAheadAlwaysTakesPriorityOverSideRecovery() {
        var guide = DepthInspectionGuide()
        var input = scene(); input[.right] = .unknown
        _ = guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: 1, now: 1)
        input[.ahead] = .unknown
        let result = guide.update(input, floorKnown: true, pose: uprightPose, capturedAt: 1.1, now: 1.1)
        XCTAssertEqual(result, .scan(.ahead))
        let cue = DepthGuidance.cue(input, floorKnown: true, inspection: result)
        XCTAssertTrue(cue.speech.contains("Ahead depth uncertain"))
        XCTAssertTrue(cue.key.hasPrefix("unknown:"))
    }
    func testRecoveringAllReadingsMustSettleAgainBeforeComparison() {
        var guide = DepthInspectionGuide()
        _ = settle(&guide, scene())
        var missing = scene(); missing[.right] = .unknown
        XCTAssertEqual(guide.update(missing, floorKnown: true, pose: uprightPose, capturedAt: 2.1, now: 2.1), .scan(.right))
        XCTAssertEqual(guide.update(scene(), floorKnown: true, pose: uprightPose, capturedAt: 2.2, now: 2.2), .settling)
        XCTAssertEqual(settle(&guide, scene(), start: 2.3), .check(.right))
    }
    func testRecoveryScanDoesNotInterruptCurrentSentence() {
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(closeCue, now: 1, speaking: false))
        let cue = DepthGuidance.cue(scene(), floorKnown: true, inspection: .scan(.right))
        XCTAssertFalse(policy.shouldSpeak(cue, now: 2, speaking: true))
        policy.didFinish(at: 3)
        XCTAssertFalse(policy.shouldSpeak(cue, now: 3.4, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(cue, now: 4, speaking: false))
    }
    func testAheadRecoveryUsesUncertaintyDebounceNotConfirmedFastSpeech() {
        var input = scene(); input[.ahead] = .unknown
        let cue = DepthGuidance.cue(input, floorKnown: true, inspection: .scan(.ahead))
        var policy = DepthSpeechPolicy()
        XCTAssertFalse(policy.shouldSpeak(cue, now: 1, speaking: false))
        XCTAssertFalse(policy.shouldSpeak(cue, now: 1.4, speaking: false))
        XCTAssertTrue(policy.shouldSpeak(cue, now: 1.9, speaking: false))
    }
    func testCloseAheadWarningStillOutranksRecoveryScan() {
        var input = scene(); input[.right] = .unknown
        let cue = DepthGuidance.cue(input, floorKnown: true, inspection: .scan(.right))
        XCTAssertEqual(cue.speechPriority, 2)
        XCTAssertTrue(cue.speech.hasPrefix("Pause. Close ahead."))
        var policy = DepthSpeechPolicy()
        XCTAssertTrue(policy.shouldSpeak(routineCue, now: 1, speaking: false, manual: true))
        XCTAssertTrue(policy.shouldSpeak(cue, now: 2.1, speaking: true))
    }
}

final class ObstacleGuidanceTests: XCTestCase {
    private var pose: InspectionPose { InspectionPose(position: .zero, forward: SIMD3(0, 0, -1), up: SIMD3(0, 1, 0))! }
    private var observed: ObstacleCorridor { ObstacleCorridor(probes: Array(repeating: .observedBeyond, count: 75), floorSupported: true, nearestObstacle: nil) }
    private var unknown: ObstacleCorridor { ObstacleCorridor(probes: Array(repeating: .unknown, count: 75), floorSupported: true, nearestObstacle: nil) }
    private var blocked: ObstacleCorridor { ObstacleCorridor(probes: Array(repeating: .observedBeyond, count: 75), floorSupported: true, nearestObstacle: 0.8) }
    private func settle(_ guide: inout ObstacleGuide, _ corridors: [Sector: ObstacleCorridor], start: Double = 1) -> ObstacleDecision {
        var result = ObstacleDecision.stop(.unknown)
        for i in 0...8 {
            let stamp = start + Double(i) * 0.1
            result = guide.update(corridors, pose: pose, floorLevel: 0, capturedAt: stamp, now: stamp)
        }
        return result
    }
    func testForwardIsPreferredWithoutNeedingBothSidesMeasured() {
        var guide = ObstacleGuide()
        XCTAssertEqual(settle(&guide, [.ahead: observed, .left: unknown, .right: unknown]), .ahead)
    }
    func testObservedLeftCanBeSuggestedWithRightUnknownAfterStopping() {
        var guide = ObstacleGuide()
        let scene: [Sector: ObstacleCorridor] = [.ahead: blocked, .left: observed, .right: unknown]
        XCTAssertEqual(guide.update(scene, pose: pose, floorLevel: 0, capturedAt: 1, now: 1), .stop(.obstacle))
        XCTAssertEqual(settle(&guide, scene, start: 1.1), .turn(.left))
    }
    func testObservedRightCanBeSuggestedWithLeftUnknown() {
        var guide = ObstacleGuide()
        XCTAssertEqual(settle(&guide, [.ahead: blocked, .left: unknown, .right: observed]), .turn(.right))
    }
    func testUnknownAheadDoesNotProduceTurnTowardAnObservedSide() {
        var guide = ObstacleGuide()
        XCTAssertEqual(settle(&guide, [.ahead: unknown, .left: observed, .right: observed]), .stop(.unknown))
    }
    func testAllBlockedOrUnknownAlternativesStop() {
        for alternative in [blocked, unknown] {
            var guide = ObstacleGuide()
            XCTAssertEqual(settle(&guide, [.ahead: blocked, .left: alternative, .right: alternative]), .stop(.noAlternative))
        }
    }
    func testNewForwardObstacleWithdrawsForwardImmediately() {
        var guide = ObstacleGuide()
        XCTAssertEqual(settle(&guide, [.ahead: observed]), .ahead)
        XCTAssertEqual(guide.update([.ahead: blocked], pose: pose, floorLevel: 0, capturedAt: 1.9, now: 1.9), .stop(.noAlternative))
    }
    func testFloorGapsCannotProduceForward() {
        var guide = ObstacleGuide()
        let gap = ObstacleCorridor(probes: observed.probes, floorSupported: false, nearestObstacle: nil)
        XCTAssertEqual(settle(&guide, [.ahead: gap]), .stop(.floor))
    }
    func testAnyUnobservedBodyProbePreventsForward() {
        for index in [0, 37, 74] {
            var guide = ObstacleGuide()
            var probes = observed.probes; probes[index] = .unknown
            XCTAssertEqual(settle(&guide, [.ahead: ObstacleCorridor(probes: probes, floorSupported: true, nearestObstacle: nil)]), .stop(.unknown))
        }
    }
    func testOccludedProbeVetoesCorridorEvenWithoutDenseObstacleHit() {
        var probes = observed.probes; probes[12] = .occluded
        let corridor = ObstacleCorridor(probes: probes, floorSupported: true, nearestObstacle: nil)
        XCTAssertTrue(corridor.isBlocked)
        XCTAssertFalse(corridor.isObserved)
    }
    func testMalformedProbeCountsAndNonfiniteObstacleCannotSuggestTurn() {
        for corridor in [ObstacleCorridor(probes: [], floorSupported: true, nearestObstacle: nil),
                         ObstacleCorridor(probes: observed.probes, floorSupported: true, nearestObstacle: .nan),
                         ObstacleCorridor(probes: observed.probes, floorSupported: true, nearestObstacle: -1)] {
            var guide = ObstacleGuide()
            XCTAssertEqual(settle(&guide, [.ahead: corridor, .left: observed]), .stop(.unknown))
        }
    }
    func testWalkingMotionPreventsPrematureTurnAdvice() {
        var guide = ObstacleGuide()
        for i in 0...20 {
            let stamp = 1 + Double(i) * 0.1
            let moving = InspectionPose(position: SIMD3(0, 0, -Double(i) * 0.08), forward: SIMD3(0, 0, -1), up: SIMD3(0, 1, 0))!
            let result = guide.update([.ahead: blocked, .left: observed], pose: moving, floorLevel: 0, capturedAt: stamp, now: stamp)
            XCTAssertEqual(result, .stop(.obstacle))
        }
    }
    func testStableForwardUpdatesDoNotRequireStandingStillForever() {
        var guide = ObstacleGuide()
        var result = ObstacleDecision.stop(.unknown)
        for i in 0...8 {
            let stamp = 1 + Double(i) * 0.1
            let moving = InspectionPose(position: SIMD3(0, 0, -Double(i) * 0.05), forward: SIMD3(0, 0, -1), up: SIMD3(0, 1, 0))!
            result = guide.update([.ahead: observed], pose: moving, floorLevel: 0, capturedAt: stamp, now: stamp)
        }
        XCTAssertEqual(result, .ahead)
    }
    func testTurningRequiresFreshHeadingAssessment() {
        var guide = ObstacleGuide()
        _ = settle(&guide, [.ahead: blocked, .left: observed])
        let a = 15.0 * .pi / 180
        let turned = InspectionPose(position: .zero, forward: SIMD3(-sin(a), 0, -cos(a)), up: SIMD3(0, 1, 0))!
        XCTAssertEqual(guide.update([.ahead: observed], pose: turned, floorLevel: 0, capturedAt: 1.9, now: 1.9), .stop(.recheck))
    }
    func testStaleDuplicateFutureOrInvalidPoseNeverRetainsDirection() {
        for (stamp, now) in [(1.8, 1.9), (1.7, 1.9), (3.0, 2.0), (2.0, 2.7), (Double.nan, 2.0)] {
            var guide = ObstacleGuide()
            _ = settle(&guide, [.ahead: observed])
            XCTAssertEqual(guide.update([.ahead: observed], pose: pose, floorLevel: 0, capturedAt: stamp, now: now), .stop(.unknown))
        }
        var guide = ObstacleGuide()
        XCTAssertEqual(guide.update([.ahead: observed], pose: nil, floorLevel: 0, capturedAt: 1, now: 1), .stop(.unknown))
    }
    func testFloorHeightJumpOrMissingFloorRequiresStop() {
        var guide = ObstacleGuide()
        _ = settle(&guide, [.ahead: observed])
        XCTAssertEqual(guide.update([.ahead: observed], pose: pose, floorLevel: 0.2, capturedAt: 1.9, now: 1.9), .stop(.recheck))
        XCTAssertEqual(guide.update([.ahead: observed], pose: pose, floorLevel: nil, capturedAt: 2, now: 2), .stop(.floor))
    }
    func testGeometryChecksBodyWidthAndHeightNotJustCentralRay() {
        XCTAssertEqual(ObstacleGeometry.probes(.ahead).count, 75)
        XCTAssertEqual(ObstacleGeometry.obstacleRange([SIMD3(0.45, 0.8, 1)], sector: .ahead), 1)
        XCTAssertNil(ObstacleGeometry.obstacleRange([SIMD3(0.7, 0.8, 1)], sector: .ahead))
        XCTAssertNil(ObstacleGeometry.obstacleRange([SIMD3(0, 0, 1), SIMD3(0, 2.4, 1)], sector: .ahead))
        XCTAssertNotNil(ObstacleGeometry.obstacleRange([ObstacleGeometry.point(across: 0, height: 1, along: 1, sector: .left)], sector: .left))
    }
    func testDepthProbeNeedsConfidentNeighborSupportBeyondTarget() {
        let good = ObstacleObservation(cameraDepth: 3, range: 3.2, confidence: 2)
        let bad = ObstacleObservation(cameraDepth: .nan, range: .nan, confidence: 0)
        XCTAssertEqual(ObstacleObservation.classify(targetCameraDepth: 2, neighborhood: Array(repeating: good, count: 5) + Array(repeating: bad, count: 4)), .observedBeyond)
        XCTAssertEqual(ObstacleObservation.classify(targetCameraDepth: 2, neighborhood: Array(repeating: good, count: 4) + Array(repeating: bad, count: 5)), .unknown)
        XCTAssertEqual(ObstacleObservation.classify(targetCameraDepth: .nan, neighborhood: Array(repeating: good, count: 9)), .unknown)
    }
    func testThinCloserSampleVetoesOtherwiseFarDepthNeighborhood() {
        var observations = Array(repeating: ObstacleObservation(cameraDepth: 3, range: 3, confidence: 2), count: 9)
        observations[4] = ObstacleObservation(cameraDepth: 0.6, range: 0.6, confidence: 2)
        XCTAssertEqual(ObstacleObservation.classify(targetCameraDepth: 2, neighborhood: observations), .occluded)
    }
    func testSensorOutOfRangeAndLowConfidenceAreNotFreeSpace() {
        for sample in [ObstacleObservation(cameraDepth: 6, range: 6, confidence: 2), ObstacleObservation(cameraDepth: 3, range: 3, confidence: 1)] {
            XCTAssertEqual(ObstacleObservation.classify(targetCameraDepth: 2, neighborhood: Array(repeating: sample, count: 9)), .unknown)
        }
    }
    func testStopCanInterruptForwardButTurnChangesFinishSentence() {
        var speech = DepthSpeechPolicy()
        XCTAssertTrue(speech.shouldSpeak(ObstacleDecision.ahead.cue, now: 1, speaking: false, manual: true))
        XCTAssertTrue(speech.shouldSpeak(ObstacleDecision.stop(.obstacle).cue, now: 2.1, speaking: true))
        XCTAssertFalse(speech.shouldSpeak(ObstacleDecision.turn(.left).cue, now: 3, speaking: true))
        XCTAssertFalse(speech.shouldSpeak(ObstacleDecision.turn(.right).cue, now: 3.5, speaking: true))
        speech.didFinish(at: 4)
        XCTAssertFalse(speech.shouldSpeak(ObstacleDecision.turn(.right).cue, now: 4.4, speaking: false))
        XCTAssertTrue(speech.shouldSpeak(ObstacleDecision.turn(.right).cue, now: 4.9, speaking: false))
    }
    func testTurnPromptIsMovementHeadingAndAlwaysSaysStopFirst() {
        XCTAssertEqual(ObstacleDecision.turn(.left).cue.speech, "Stop. Turn slightly left, then recheck.")
        XCTAssertFalse(ObstacleDecision.turn(.right).cue.speech.contains("phone"))
        XCTAssertFalse(ObstacleDecision.ahead.cue.speech.contains("safe"))
    }
}
