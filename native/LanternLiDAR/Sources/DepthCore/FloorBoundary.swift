import Foundation

/// A classified anchor's ordered boundary in its own X/Z coordinates. Using
/// the actual polygon avoids masking the corners of a rotated bounding box.
public enum FloorBoundary {
    public static func contains(_ point: SIMD2<Double>, vertices: [SIMD2<Double>]) -> Bool {
        guard point.x.isFinite, point.y.isFinite, vertices.count >= 3, vertices.count <= 512,
              vertices.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return false }
        var inside = false
        var previous = vertices[vertices.count - 1]
        for current in vertices {
            if (current.y > point.y) != (previous.y > point.y) {
                let crossingX = (previous.x - current.x) * (point.y - current.y)
                    / (previous.y - current.y) + current.x
                if point.x < crossingX { inside.toggle() }
            }
            previous = current
        }
        return inside
    }
}
