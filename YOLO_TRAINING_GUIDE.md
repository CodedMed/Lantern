# YOLO Model Training Guide for Lantern

## 🎯 Overview

This guide explains how to train custom YOLO models for Lantern's obstacle detection system.

---

## 📋 Prerequisites

### Software Requirements
- **Python 3.8+**
- **PyTorch 1.12+** with CUDA (for GPU training)
- **Ultralytics YOLOv5/YOLOv8** framework
- **LabelImg** or **Roboflow** for annotation

### Hardware Requirements
- **Recommended**: NVIDIA GPU with 8GB+ VRAM
- **Minimum**: 16GB RAM, 50GB storage
- **Cloud Alternative**: Google Colab, AWS SageMaker, or Paperspace

---

## 🚀 Quick Start

### Option 1: Google Colab (Easiest)

```python
# Install YOLOv8
!pip install ultralytics

# Import
from ultralytics import YOLO

# Train on custom dataset
model = YOLO('yolov8n.pt')  # Load pretrained model
results = model.train(
    data='obstacle_data.yaml',
    epochs=100,
    imgsz=640,
    batch=16,
    name='lantern_obstacles'
)

# Export for mobile
model.export(format='tflite')  # TensorFlow Lite
model.export(format='onnx')    # ONNX format
```

### Option 2: Local Training (Advanced)

```bash
# Clone YOLOv8 repository
git clone https://github.com/ultralytics/ultralytics
cd ultralytics

# Install dependencies
pip install -e .

# Train
yolo detect train data=obstacle_data.yaml model=yolov8n.pt epochs=100 imgsz=640
```

---

## 📂 Dataset Preparation

### 1. **Collect Images**

Recommended dataset size:
- **Minimum**: 500 images per class
- **Good**: 1,000-2,000 images per class
- **Excellent**: 5,000+ images per class

**Tips:**
- Capture diverse lighting conditions (bright, dim, indoor, outdoor)
- Include various angles and distances
- Mix crowded and sparse scenes
- Include edge cases (partial occlusions, shadows)

### 2. **Annotate Images**

**Tools:**
- [Roboflow](https://roboflow.com) - Web-based, auto-annotation
- [LabelImg](https://github.com/heartexlabs/labelImg) - Desktop app
- [CVAT](https://cvat.org) - Collaborative annotation

**Format**: YOLO format
```
<class_id> <x_center> <y_center> <width> <height>
```

Example (`obstacle.txt`):
```
0 0.5 0.6 0.3 0.4
1 0.2 0.3 0.15 0.25
```

### 3. **Dataset Structure**

```
obstacle_dataset/
├── images/
│   ├── train/
│   │   ├── img001.jpg
│   │   ├── img002.jpg
│   │   └── ...
│   ├── val/
│   │   ├── img101.jpg
│   │   └── ...
│   └── test/
│       ├── img201.jpg
│       └── ...
└── labels/
    ├── train/
    │   ├── img001.txt
    │   ├── img002.txt
    │   └── ...
    ├── val/
    │   ├── img101.txt
    │   └── ...
    └── test/
        ├── img201.txt
        └── ...
```

### 4. **Create Data Config**

**obstacle_data.yaml**:
```yaml
# Dataset configuration for Lantern obstacle detection

path: ./obstacle_dataset  # Root path
train: images/train       # Training images (relative to path)
val: images/val          # Validation images
test: images/test        # Test images (optional)

# Number of classes
nc: 10

# Class names
names:
  0: person
  1: car
  2: bicycle
  3: stairs
  4: door
  5: obstacle
  6: curb
  7: pole
  8: sign
  9: traffic_light
```

---

## 🎓 Training

### YOLOv8 Training (Recommended)

```python
from ultralytics import YOLO

# Load pretrained model
model = YOLO('yolov8n.pt')  # nano (fastest)
# model = YOLO('yolov8s.pt')  # small
# model = YOLO('yolov8m.pt')  # medium
# model = YOLO('yolov8l.pt')  # large

# Train
results = model.train(
    data='obstacle_data.yaml',
    epochs=100,              # Training iterations
    imgsz=640,              # Input image size
    batch=16,               # Batch size (reduce if OOM)
    device=0,               # GPU device (0 for first GPU, 'cpu' for CPU)
    workers=8,              # Data loading workers
    patience=50,            # Early stopping patience
    save=True,              # Save checkpoints
    project='lantern',      # Project name
    name='obstacle_v1',     # Experiment name
    
    # Augmentation
    hsv_h=0.015,           # HSV-Hue augmentation
    hsv_s=0.7,             # HSV-Saturation
    hsv_v=0.4,             # HSV-Value
    degrees=0.0,           # Rotation
    translate=0.1,         # Translation
    scale=0.5,             # Scale
    shear=0.0,             # Shear
    perspective=0.0,       # Perspective
    flipud=0.0,            # Vertical flip
    fliplr=0.5,            # Horizontal flip
    mosaic=1.0,            # Mosaic augmentation
    mixup=0.0,             # Mixup augmentation
    
    # Hyperparameters
    lr0=0.01,              # Initial learning rate
    lrf=0.01,              # Final learning rate
    momentum=0.937,        # Momentum
    weight_decay=0.0005,   # Weight decay
    warmup_epochs=3.0,     # Warmup epochs
    warmup_momentum=0.8,   # Warmup momentum
    box=7.5,               # Box loss gain
    cls=0.5,               # Class loss gain
    dfl=1.5,               # DFL loss gain
    
    # Optimization
    optimizer='SGD',       # Optimizer (SGD, Adam, AdamW)
    close_mosaic=10,       # Disable mosaic in final epochs
)

# Validate
metrics = model.val()
print(f"mAP50: {metrics.box.map50}")
print(f"mAP50-95: {metrics.box.map}")

# Export for mobile
model.export(format='tflite', imgsz=640, int8=True)  # Quantized TFLite
model.export(format='onnx', opset=12)                # ONNX
```

### Training Metrics to Monitor

- **mAP@0.5**: Mean Average Precision (IoU threshold 0.5)
- **mAP@0.5:0.95**: Mean Average Precision (IoU range)
- **Precision**: Correct predictions / Total predictions
- **Recall**: Correct predictions / Total ground truth
- **Box Loss**: Bounding box regression loss
- **Class Loss**: Classification loss
- **Objectness Loss**: Object confidence loss

**Good Performance**:
- mAP@0.5 > 0.75 (75%)
- mAP@0.5:0.95 > 0.50 (50%)
- Precision & Recall > 0.70 (70%)

---

## 📱 Model Export for React Native

### TensorFlow Lite (Recommended)

```python
# Export to TFLite with INT8 quantization
model.export(
    format='tflite',
    imgsz=640,
    int8=True,           # INT8 quantization for smaller size
    data='obstacle_data.yaml'
)

# Output: lantern/obstacle_v1/weights/best_int8.tflite
```

### ONNX (Alternative)

```python
# Export to ONNX
model.export(
    format='onnx',
    imgsz=640,
    opset=12,           # ONNX opset version
    dynamic=False,      # Static input shape
    simplify=True       # Simplify model
)

# Output: lantern/obstacle_v1/weights/best.onnx
```

### TensorFlow.js (Web/Expo)

```python
# Convert TFLite to TF.js
import tensorflowjs as tfjs

tfjs.converters.convert_tf_saved_model(
    'lantern/obstacle_v1/weights/saved_model',
    'lantern/obstacle_v1/tfjs_model',
    quantization_dtype_map={'uint8': 'uint8'}
)

# Output: tfjs_model/model.json
```

---

## 🔧 Model Optimization

### Quantization (Reduce Size)

```python
# Post-training quantization
from ultralytics import YOLO

model = YOLO('lantern/obstacle_v1/weights/best.pt')

# INT8 quantization (4x smaller)
model.export(format='tflite', int8=True, data='obstacle_data.yaml')

# FP16 quantization (2x smaller)
model.export(format='onnx', half=True)
```

### Pruning (Faster Inference)

```python
# Model pruning (requires torch.prune)
import torch.nn.utils.prune as prune

# Prune 30% of weights in conv layers
for module in model.model.modules():
    if isinstance(module, torch.nn.Conv2d):
        prune.l1_unstructured(module, name='weight', amount=0.3)
        
# Export pruned model
model.export(format='tflite', int8=True)
```

---

## 📊 Dataset Augmentation Tips

Use Roboflow or Albumentations for advanced augmentation:

```python
import albumentations as A

transform = A.Compose([
    A.RandomBrightnessContrast(p=0.5),
    A.HueSaturationValue(p=0.5),
    A.GaussNoise(p=0.3),
    A.MotionBlur(p=0.3),
    A.RandomFog(p=0.2),
    A.RandomShadow(p=0.3),
    A.RandomRain(p=0.2),
    A.RandomSnow(p=0.1),
], bbox_params=A.BboxParams(format='yolo'))
```

---

## 🌐 Hosting Trained Model

### Option 1: GitHub Releases
```bash
# Upload to GitHub releases
gh release create v1.0 lantern/obstacle_v1/weights/best.tflite
```

### Option 2: Firebase Storage
```javascript
// Upload to Firebase
import storage from '@react-native-firebase/storage';

const reference = storage().ref('models/obstacle_v1.tflite');
await reference.putFile('/path/to/best.tflite');
const url = await reference.getDownloadURL();
```

### Option 3: Google Cloud Storage
```bash
# Upload to GCS
gsutil cp lantern/obstacle_v1/weights/best.tflite gs://lantern-models/
gsutil acl ch -u AllUsers:R gs://lantern-models/best.tflite
```

---

## 🔗 Integration with Lantern App

1. **Upload Model**: Host on Firebase, GCS, or GitHub
2. **Get URL**: `https://storage.googleapis.com/.../best.tflite`
3. **Update Config**: Edit `modelConfig.js`

```javascript
// modelConfig.js
export const CUSTOM_MODELS = {
  OBSTACLE_V1: {
    name: 'Obstacle Detector v1',
    url: 'https://storage.googleapis.com/lantern-models/obstacle_v1.tflite',
    inputSize: 640,
    classes: ['person', 'car', 'bicycle', 'stairs', 'door', 'obstacle', 'curb', 'pole', 'sign', 'traffic_light'],
    version: '1.0.0',
  },
};
```

4. **Load in App**:
```javascript
import YOLODetector from './services/YOLODetector';
import { CUSTOM_MODELS } from './config/modelConfig';

await YOLODetector.loadModel(
  'CUSTOM',
  CUSTOM_MODELS.OBSTACLE_V1.url,
  CUSTOM_MODELS.OBSTACLE_V1.classes
);
```

---

## 📈 Performance Benchmarks

| Model | Size | mAP@0.5 | Inference (ms) | Use Case |
|-------|------|---------|----------------|----------|
| YOLOv8n | 6 MB | 0.75 | 30-50 | Real-time mobile |
| YOLOv8s | 22 MB | 0.82 | 60-100 | Balanced |
| YOLOv8m | 52 MB | 0.86 | 120-200 | High accuracy |
| Custom (quantized) | 3 MB | 0.70 | 25-40 | Optimized mobile |

---

## 🛠️ Troubleshooting

### OOM (Out of Memory)
```python
# Reduce batch size
batch=8  # or even batch=4

# Reduce image size
imgsz=416  # instead of 640
```

### Low mAP
- Collect more diverse training data
- Increase training epochs (100 → 200)
- Use stronger augmentation
- Try larger model (nano → small → medium)

### Slow Inference
- Use quantization (INT8)
- Use smaller model (medium → small → nano)
- Reduce input size (640 → 416 → 320)

---

## 📚 Resources

- [YOLOv8 Docs](https://docs.ultralytics.com/)
- [Roboflow](https://roboflow.com) - Dataset management
- [CVAT](https://cvat.org) - Annotation tool
- [Papers with Code](https://paperswithcode.com/task/object-detection) - State-of-the-art models

---

## 💡 Next Steps

1. **Collect data** for your specific use case
2. **Annotate** 500-1000 images minimum
3. **Train** using Google Colab (free GPU)
4. **Export** to TFLite INT8
5. **Upload** to cloud storage
6. **Integrate** with Lantern app
7. **Test** and iterate

Happy training! 🚀
