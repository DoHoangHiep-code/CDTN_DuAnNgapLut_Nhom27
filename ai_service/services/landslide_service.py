import os
import logging
import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    ort = None

logger = logging.getLogger(__name__)

# Khởi tạo session 1 lần duy nhất ở global scope
_session = None

def init_landslide_model(model_path: str = "models/landslide/landslide_model.onnx"):
    global _session
    if ort is None:
        logger.error("onnxruntime is not installed. Landslide model cannot be loaded.")
        return
        
    if not os.path.exists(model_path):
        logger.warning(f"Landslide model file not found at {model_path}.")
        return
        
    try:
        # Load ONNX model
        _session = ort.InferenceSession(model_path)
        print("Landslide ONNX Model Loaded Successfully")
        logger.info("Landslide ONNX Model Loaded Successfully")
    except Exception as e:
        logger.error(f"Failed to load landslide model: {e}")

def predict_landslide_risk(features_dict: dict) -> dict:
    if _session is None:
        raise RuntimeError("Landslide model session is not initialized or model file is missing.")
        
    try:
        # Map các giá trị từ dictionary thành numpy array
        # Chú ý: input dict phải có thứ tự các key đúng với lúc train model
        features_list = list(features_dict.values())
        input_array = np.array([features_list], dtype=np.float32)
        
        # Lấy tên input của model
        input_name = _session.get_inputs()[0].name
        
        # Run prediction
        output = _session.run(None, {input_name: input_array})
        
        # Trích xuất probability (xử lý linh hoạt các format output của ONNX)
        probability = 0.0
        if len(output) > 1 and isinstance(output[1], list) and isinstance(output[1][0], dict):
            # Format phổ biến của scikit-learn/ONNX classification: [label, prob_dict]
            prob_dict = output[1][0]
            # Lấy xác suất của class 1 (hoặc class cuối)
            probability = float(prob_dict.get(1, prob_dict.get(True, list(prob_dict.values())[-1])))
        else:
            arr = output[0]
            if isinstance(arr, np.ndarray):
                if arr.ndim >= 2 and arr.shape[1] > 1:
                    probability = float(arr[0, 1])  # Class 1 probability
                else:
                    probability = float(np.ravel(arr)[0])
            else:
                probability = float(arr)
        
        # Ràng buộc giá trị từ 0 -> 1
        probability = max(0.0, min(1.0, probability))
        
        # Phân loại rủi ro (Ngưỡng có thể điều chỉnh)
        if probability >= 0.7:
            risk_level = "DANGER"
        elif probability >= 0.4:
            risk_level = "WARNING"
        else:
            risk_level = "SAFE"
            
        return {
            "probability": round(probability, 4),
            "risk_level": risk_level
        }
        
    except Exception as e:
        logger.error(f"Error during landslide prediction: {e}")
        raise e
