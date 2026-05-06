"""
AQUAALERT – FastAPI AI Microservice
Dự đoán độ ngập lụt bằng CatBoost model đã train sẵn.

Chạy: uvicorn main:app --host 0.0.0.0 --port 8000
"""

import math
import logging
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from catboost import CatBoostRegressor
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

MODEL_PATH = "../ai/catboost_flood_model_final_full_data.cbm"
_model: CatBoostRegressor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model
    logger.info("Đang tải model CatBoost từ: %s", MODEL_PATH)
    _model = CatBoostRegressor()
    _model.load_model(MODEL_PATH)
    logger.info("Model tải thành công. Features: %s", _model.feature_names_)
    yield
    logger.info("AI service đang tắt.")


app = FastAPI(title="AQUAALERT Flood Prediction Service", version="2.0.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Input schema – 30 features CHÍNH XÁC từ model (model.feature_names_)
# Thứ tự trong FEATURE_ORDER bên dưới quyết định array truyền vào model.
# ---------------------------------------------------------------------------
class WeatherData(BaseModel):
    # --- Lượng mưa hiện tại và tích lũy ---
    prcp: float = Field(..., description="Lượng mưa hiện tại (mm)")
    prcp_3h: float = Field(..., description="Tổng mưa 3 giờ qua (mm)")
    prcp_6h: float = Field(..., description="Tổng mưa 6 giờ qua (mm)")
    prcp_12h: float = Field(..., description="Tổng mưa 12 giờ qua (mm)")
    prcp_24h: float = Field(..., description="Tổng mưa 24 giờ qua (mm)")
    # --- Thời tiết cơ bản ---
    temp: float = Field(..., description="Nhiệt độ (°C)")
    rhum: float = Field(..., description="Độ ẩm tương đối (%)")
    wspd: float = Field(..., description="Tốc độ gió (km/h)")
    pres: float = Field(..., description="Áp suất khí quyển (hPa)")
    pressure_change_24h: float = Field(..., description="Thay đổi áp suất 24h (hPa)")
    # --- Lượng mưa tối đa trong cửa sổ thời gian ---
    max_prcp_3h: float = Field(..., description="Mưa tối đa trong 3 giờ qua (mm)")
    max_prcp_6h: float = Field(..., description="Mưa tối đa trong 6 giờ qua (mm)")
    max_prcp_12h: float = Field(..., description="Mưa tối đa trong 12 giờ qua (mm)")
    # --- Đặc điểm địa lý của node (tĩnh, lấy từ grid_nodes) ---
    elevation: float = Field(..., description="Độ cao địa hình (m)")
    slope: float = Field(..., description="Độ dốc (%)")
    impervious_ratio: float = Field(..., description="Tỷ lệ bề mặt không thấm nước (0-1)")
    dist_to_drain_km: float = Field(..., description="Khoảng cách đến cống thoát nước gần nhất (km)")
    dist_to_river_km: float = Field(..., description="Khoảng cách đến sông gần nhất (km)")
    dist_to_pump_km: float = Field(..., description="Khoảng cách đến trạm bơm gần nhất (km)")
    dist_to_main_road_km: float = Field(..., description="Khoảng cách đến đường chính gần nhất (km)")
    dist_to_park_km: float = Field(..., description="Khoảng cách đến công viên gần nhất (km)")
    # --- Đặc trưng thời gian ---
    hour: int = Field(..., ge=0, le=23, description="Giờ trong ngày (0-23)")
    dayofweek: int = Field(..., ge=0, le=6, description="Thứ trong tuần (0=Thứ 2, 6=CN)")
    month: int = Field(..., ge=1, le=12, description="Tháng (1-12)")
    dayofyear: int = Field(..., ge=1, le=366, description="Ngày trong năm (1-366)")
    # --- Đặc trưng chu kỳ (sin/cos encoding) ---
    hour_sin: float = Field(..., description="Sin của giờ (2π*hour/24)")
    hour_cos: float = Field(..., description="Cos của giờ (2π*hour/24)")
    month_sin: float = Field(..., description="Sin của tháng (2π*month/12)")
    month_cos: float = Field(..., description="Cos của tháng (2π*month/12)")
    # --- Mùa mưa ---
    rainy_season_flag: int = Field(..., ge=0, le=1, description="Cờ mùa mưa (1=mùa mưa, 0=khô)")

    class Config:
        json_schema_extra = {
            "example": {
                "prcp": 25.0, "prcp_3h": 60.0, "prcp_6h": 90.0,
                "prcp_12h": 110.0, "prcp_24h": 130.0,
                "temp": 28.5, "rhum": 88.0, "wspd": 15.0,
                "pres": 1008.0, "pressure_change_24h": -2.5,
                "max_prcp_3h": 30.0, "max_prcp_6h": 45.0, "max_prcp_12h": 55.0,
                "elevation": 5.2, "slope": 1.5, "impervious_ratio": 0.72,
                "dist_to_drain_km": 0.3, "dist_to_river_km": 1.2,
                "dist_to_pump_km": 0.8, "dist_to_main_road_km": 0.15,
                "dist_to_park_km": 0.5,
                "hour": 14, "dayofweek": 2, "month": 9, "dayofyear": 258,
                "hour_sin": -0.5, "hour_cos": -0.866,
                "month_sin": -0.866, "month_cos": -0.5,
                "rainy_season_flag": 1
            }
        }


# Thứ tự này PHẢI KHỚP với model.feature_names_ (đã verify khi startup)
FEATURE_ORDER: list[str] = [
    "prcp", "prcp_3h", "prcp_6h", "prcp_12h", "prcp_24h",
    "temp", "rhum", "wspd", "pres", "pressure_change_24h",
    "max_prcp_3h", "max_prcp_6h", "max_prcp_12h",
    "elevation", "slope", "impervious_ratio",
    "dist_to_drain_km", "dist_to_river_km", "dist_to_pump_km",
    "dist_to_main_road_km", "dist_to_park_km",
    "hour", "dayofweek", "month", "dayofyear",
    "hour_sin", "hour_cos", "month_sin", "month_cos",
    "rainy_season_flag",
]


def depth_to_risk(depth_cm: float) -> str:
    if depth_cm < 5:
        return "safe"
    if depth_cm < 20:
        return "medium"
    if depth_cm < 50:
        return "high"
    return "severe"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {"status": "ok", "model_loaded": _model is not None}


@app.post("/api/predict")
def predict_flood(data: WeatherData):
    """
    Nhận 30 features, trả về flood_depth_cm và risk_level.
    KHÔNG scale/normalize – CatBoost dùng raw values.
    """
    if _model is None:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng.")

    try:
        data_dict = data.model_dump()
        # Map đúng thứ tự FEATURE_ORDER → 2D array [[f1, f2, ..., f30]]
        ordered_features = [[data_dict[feat] for feat in FEATURE_ORDER]]

        raw = _model.predict(ordered_features)
        flood_depth_cm = max(0.0, float(raw[0]))  # không âm

        return {
            "flood_depth_cm": round(flood_depth_cm, 2),
            "risk_level": depth_to_risk(flood_depth_cm),
        }

    except KeyError as e:
        logger.error("Feature thiếu: %s", e)
        raise HTTPException(status_code=422, detail=f"Feature '{e}' thiếu trong request.")
    except Exception as e:
        logger.error("Lỗi predict: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/predict/batch")
async def predict_flood_batch(request: Request):
    """
    Dự đoán hàng loạt cho nhiều node cùng lúc.
    Nhận raw JSON array để tránh Pydantic parse overhead.
    Trả về list[{flood_depth_cm, risk_level}].
    """
    if _model is None:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng.")

    try:
        items: list[dict] = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"JSON parse error: {e}")

    if not items:
        return []

    try:
        matrix = [[row[feat] for feat in FEATURE_ORDER] for row in items]
        raw = _model.predict(matrix)
        results = []
        for val in raw:
            depth = max(0.0, float(val))
            results.append({"flood_depth_cm": round(depth, 2), "risk_level": depth_to_risk(depth)})
        return results
    except KeyError as e:
        logger.error("Feature thiếu trong batch: %s", e)
        raise HTTPException(status_code=422, detail=f"Feature '{e}' thiếu trong request.")
    except Exception as e:
        logger.error("Lỗi batch predict: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
