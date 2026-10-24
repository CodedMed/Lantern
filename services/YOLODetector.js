// Legacy filename retained for native imports. This is COCO-SSD, not YOLO.
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";
import { decodeJpeg } from "@tensorflow/tfjs-react-native";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as FileSystem from "expo-file-system/legacy";
import { normalizeDetections } from "../utils/scene.mjs";

class ObjectDetector {
  model = null;
  pending = null;
  busy = false;
  isInitialized = false;
  modelConfig = { name: "COCO-SSD / Lite MobileNet V2" };
  confidenceThreshold = 0.5;
  async loadModel(modelType = "COCO_SSD") {
    if (modelType !== "COCO_SSD")
      throw new Error(
        "Only COCO_SSD is configured. No YOLO weights are included.",
      );
    if (this.model) return true;
    if (!this.pending)
      this.pending = (async () => {
        const registered = await tf.setBackend("rn-webgl");
        if (!registered)
          throw new Error("The native TensorFlow backend is unavailable.");
        await tf.ready();
        this.model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        this.isInitialized = true;
      })().finally(() => {
        this.pending = null;
      });
    await this.pending;
    return true;
  }
  async detect(uri, threshold = this.confidenceThreshold) {
    if (this.busy) throw new Error("A scan is already running.");
    this.busy = true;
    let tensor;
    try {
      await this.loadModel();
      const encoded = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = Uint8Array.from(atob(encoded), (character) =>
        character.charCodeAt(0),
      );
      tensor = decodeJpeg(bytes);
      const [height, width] = tensor.shape;
      return normalizeDetections(
        await this.model.detect(tensor, 20, threshold),
        width,
        height,
        threshold,
      );
    } finally {
      tensor?.dispose();
      this.busy = false;
    }
  }
}
export default new ObjectDetector();
