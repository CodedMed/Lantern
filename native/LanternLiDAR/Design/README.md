# Lantern app icon

Generated with Codex's **built-in image-generation tool**, not the CLI. The
chosen artwork is a black-and-white lantern with an inner forward light beam.
It matches the native app's monochrome interface. No existing logo was copied
or edited. This is not a trademark-clearance claim.

Final iOS asset: `../App/Assets.xcassets/AppIcon.appiconset/Lantern-1024.png`.
The generated square was mechanically resized to 1024 × 1024 with macOS `sips`;
it is opaque RGB PNG, without pre-rounded canvas corners. Xcode's asset compiler
generates the device icon variations. The Home Screen label is **Lantern**.

## Final generation prompt

Use case: logo-brand. Create one final iOS app icon for Lantern, a minimalist
LiDAR spatial-awareness prototype. Square 1024 x 1024, full-bleed opaque near-black
background. Center a single bold, beautifully balanced white lantern symbol: a
rounded upright lantern outline, small arched handle, and a clear tapered beam
of light forming a forward path inside the lantern. Monochrome black and warm
white only, flat graphic, confident rounded geometry, high contrast, memorable
strong silhouette readable at 40 pixels. The symbol occupies about 68 percent
of the canvas with generous clean negative space. It should feel like a polished
independent accessibility app, calm and precise. No text, letters, slogan,
gradients, textures, photographic objects, 3D, shadows, extra symbols, mockup,
phone, or border. Do not round the square canvas corners; iOS applies its own
mask. Deliver the icon artwork itself.

## Integration

- AppIcon is part of the app target's Resources build phase, not the website.
- Both Debug and Release set `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`.
- No signing team, API keys or device credentials are part of the asset.
- [Apple: configuring an app icon using an asset catalog](https://developer.apple.com/documentation/xcode/configuring-your-app-icon)
