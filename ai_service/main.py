"""
AQUAALERT – FastAPI AI Microservice  v3.1.0
Pipeline 2 tầng dự báo độ ngập:
  Stage 1: CatBoost Regressor (30 features) → depth_s1 thô
           • Nếu depth_s1 < FLOOD_THRESHOLD_CM → không ngập → trả 0 cm
           • Nếu depth_s1 >= FLOOD_THRESHOLD_CM → có ngập → chạy Stage 2
  Stage 2: LightGBM Tweedie Regressor (15 features) → flood_depth_cm chính xác
           Nếu Stage 2 không tải được → dùng depth_s1 trực tiếp (đã qua gate).

Chạy: uvicorn main:app --host 0.0.0.0 --port 8000
"""

import asyncio
import logging
import pickle
from contextlib import asynccontextmanager

import numpy as np
import uvicorn
from catboost import CatBoostRegressor
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from services.landslide_service import init_landslide_model, predict_landslide_risk

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

STAGE1_PATH = "models/flood/catboost_flood_model_final_full_data.cbm"
STAGE2_PATH = "models/flood/hanoi_flood_stage2_regressor_production.pkl"

_stage1: CatBoostRegressor | None = None
_stage2 = None          # LGBMRegressor hoặc None nếu không tải được
_stage2_features: list[str] | None = None   # feature order của stage 2


def _load_stage2() -> tuple:
    """Load LightGBM stage-2 model. Trả (model, feature_list) hoặc (None, None)."""
    try:
        import lightgbm  # noqa: F401 – kiểm tra lightgbm khả dụng
        with open(STAGE2_PATH, "rb") as f:
            mdl = pickle.load(f)
        # Lấy feature names nếu model được train với DataFrame
        feat_names: list[str] | None = None
        if hasattr(mdl, "feature_names_in_"):
            feat_names = list(mdl.feature_names_in_)
        logger.info(
            "[Stage2] LightGBM model tải thành công. n_features=%s, features=%s",
            getattr(mdl, "n_features_in_", "?"),
            feat_names,
        )
        return mdl, feat_names
    except Exception as e:
        logger.warning("[Stage2] Không tải được LightGBM model (fallback Stage1): %s", e)
        return None, None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _stage1, _stage2, _stage2_features

    # ── Stage 1: CatBoost ──────────────────────────────────────────────────────
    logger.info("[Stage1] Đang tải CatBoost model: %s", STAGE1_PATH)
    _stage1 = CatBoostRegressor()
    _stage1.load_model(STAGE1_PATH)
    logger.info("[Stage1] Tải thành công. Features: %s", _stage1.feature_names_)

    # ── Stage 2: LightGBM ─────────────────────────────────────────────────────
    _stage2, _stage2_features = _load_stage2()

    # ── Landslide ONNX ────────────────────────────────────────────────────────
    init_landslide_model()

    # ── Warm-up Stage 1 ───────────────────────────────────────────────────────
    try:
        dummy = [[0.0] * len(FEATURE_ORDER)]
        _stage1.predict(dummy)
        logger.info("[Warm-up] Stage1 warm-up OK (%d features).", len(FEATURE_ORDER))
    except Exception as e:
        logger.warning("[Warm-up] Stage1 warm-up thất bại: %s", e)

    # ── Warm-up Stage 2 ───────────────────────────────────────────────────────
    if _stage2 is not None:
        try:
            n = getattr(_stage2, "n_features_in_", 1)
            _stage2.predict(np.zeros((1, n)))
            logger.info("[Warm-up] Stage2 warm-up OK (%d features).", n)
        except Exception as e:
            logger.warning("[Warm-up] Stage2 warm-up thất bại: %s", e)

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


# Ngưỡng để Stage 1 phân loại "có ngập" → kích hoạt Stage 2.
# Dưới ngưỡng: trả thẳng 0 cm (không ngập).
FLOOD_THRESHOLD_CM: float = 15.0


def depth_to_risk(depth_cm: float) -> str:
    if depth_cm < 5:
        return "safe"
    if depth_cm < 20:
        return "medium"
    if depth_cm < 50:
        return "high"
    return "severe"


# 15 features Stage 2 cần — map từ Stage 1 input + tính toán thêm
# antecedent_dry_days, prcp_accum_3days, elevation_diff_to_neighbors,
# river_water_level_m, rain_to_river_level_ratio, hist_mean_depth
# không có trong Stage 1 input → được ước tính / mặc định 0 nếu không có.
STAGE2_FEATURE_ORDER = [
    "prcp",
    "prcp_12h",
    "max_prcp_6h",
    "antecedent_dry_days",       # không có trong stage1 → default 0
    "prcp_accum_3days",          # ≈ prcp_24h * 3 (ước tính)
    "elevation",
    "elevation_diff_to_neighbors",  # không có → default 0
    "slope",
    "impervious_ratio",
    "dist_to_drain_km",
    "dist_to_pump_km",
    "river_water_level_m",       # không có → ước tính từ depth_stage1 / 10
    "rain_to_river_level_ratio", # prcp / max(river_water_level_m, 0.01)
    "month",
    "hist_mean_depth",           # ≈ depth_stage1 (dùng output stage1 làm prior)
]


def _build_stage2_row(s1_row: list[float], depth_s1: float) -> list[float]:
    """Tạo vector 15 features cho Stage 2 từ Stage 1 input + depth_stage1."""
    d = dict(zip(FEATURE_ORDER, s1_row))
    prcp            = d["prcp"]
    prcp_12h        = d["prcp_12h"]
    max_prcp_6h     = d["max_prcp_6h"]
    elevation       = d["elevation"]
    slope           = d["slope"]
    impervious      = d["impervious_ratio"]
    dist_drain      = d["dist_to_drain_km"]
    dist_pump       = d["dist_to_pump_km"]
    month           = d["month"]
    prcp_24h        = d["prcp_24h"]

    # Ước tính các features không có trong Stage 1
    antecedent_dry_days        = 0.0                          # không có dữ liệu lịch sử
    prcp_accum_3days           = prcp_24h * 2.5               # xấp xỉ 3-day accumulation
    elevation_diff_neighbors   = 0.0                          # không có spatial neighbors
    river_water_level_m        = max(depth_s1 / 15.0, 0.0)   # depth→water level proxy
    rain_to_river_level_ratio  = prcp / max(river_water_level_m, 0.01)
    hist_mean_depth            = depth_s1                     # prior từ stage 1

    return [
        prcp, prcp_12h, max_prcp_6h,
        antecedent_dry_days, prcp_accum_3days,
        elevation, elevation_diff_neighbors,
        slope, impervious,
        dist_drain, dist_pump,
        river_water_level_m, rain_to_river_level_ratio,
        month, hist_mean_depth,
    ]


def _run_pipeline(ordered_features_2d: list[list[float]]) -> list[dict]:
    """
    Pipeline 2 tầng với flood gate:

    1. Stage 1 (CatBoost): dự báo depth_s1 thô.
       - depth_s1 < FLOOD_THRESHOLD_CM → KHÔNG NGẬP → trả 0 cm, bỏ qua Stage 2.
       - depth_s1 >= FLOOD_THRESHOLD_CM → CÓ NGẬP → chuyển sang Stage 2.

    2. Stage 2 (LightGBM Tweedie): tinh chỉnh depth với 15 features.
       - Nếu Stage 2 chưa tải hoặc bị lỗi → dùng depth_s1 trực tiếp.
    """
    # --- Stage 1: CatBoost ---
    raw1 = _stage1.predict(ordered_features_2d)  # type: ignore[union-attr]
    depths_s1 = [max(0.0, float(v)) for v in raw1]

    # Tách index: ngập và không ngập
    flood_indices = [i for i, d in enumerate(depths_s1) if d >= FLOOD_THRESHOLD_CM]
    no_flood_indices = [i for i, d in enumerate(depths_s1) if d < FLOOD_THRESHOLD_CM]

    # Khởi tạo kết quả cuối — mặc định 0 cm cho tất cả
    final: list[dict | None] = [None] * len(depths_s1)

    # Không ngập: Stage 1 gate đóng → trả 0 cm ngay
    for i in no_flood_indices:
        final[i] = {
            "flood_depth_cm": 0.0,
            "risk_level": "safe",
            "label": 0,
            "stage": 1,
            "stage1_depth_cm": round(depths_s1[i], 2),
        }

    # Có ngập: chạy Stage 2 để tinh chỉnh
    if flood_indices:
        if _stage2 is None:
            # Stage 2 không tải được → dùng depth_s1 trực tiếp
            for i in flood_indices:
                d = depths_s1[i]
                final[i] = {
                    "flood_depth_cm": round(d, 2),
                    "risk_level": depth_to_risk(d),
                    "label": 1,
                    "stage": 1,
                    "stage1_depth_cm": round(d, 2),
                }
        else:
            try:
                import pandas as pd
                flood_rows = [ordered_features_2d[i] for i in flood_indices]
                flood_depths_s1 = [depths_s1[i] for i in flood_indices]

                s2_rows = [
                    _build_stage2_row(row, flood_depths_s1[j])
                    for j, row in enumerate(flood_rows)
                ]
                s2_df = pd.DataFrame(s2_rows, columns=STAGE2_FEATURE_ORDER)
                raw2 = _stage2.predict(s2_df)

                for j, i in enumerate(flood_indices):
                    d2 = max(0.0, float(raw2[j]))
                    final[i] = {
                        "flood_depth_cm": round(d2, 2),
                        "risk_level": depth_to_risk(d2),
                        "label": 1,
                        "stage": 2,
                        "stage1_depth_cm": round(depths_s1[i], 2),
                    }
            except Exception as e:
                logger.warning("[Stage2] Predict lỗi, fallback depth_s1: %s", e)
                for i in flood_indices:
                    d = depths_s1[i]
                    final[i] = {
                        "flood_depth_cm": round(d, 2),
                        "risk_level": depth_to_risk(d),
                        "label": 1,
                        "stage": 1,
                        "stage1_depth_cm": round(d, 2),
                    }

    return final  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "stage1_loaded": _stage1 is not None,
        "stage2_loaded": _stage2 is not None,
        "pipeline": "2-stage" if _stage2 is not None else "1-stage (fallback)",
    }


@app.post("/api/predict")
def predict_flood(data: WeatherData):
    """
    Nhận 30 features → pipeline 2 tầng → flood_depth_cm tinh chỉnh + risk_level.
    Stage1: CatBoost (thô) → Stage2: LightGBM Tweedie (tinh chỉnh).
    """
    if _stage1 is None:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng.")

    try:
        data_dict = data.model_dump()
        ordered = [[data_dict[feat] for feat in FEATURE_ORDER]]
        result = _run_pipeline(ordered)[0]
        return result
    except KeyError as e:
        raise HTTPException(status_code=422, detail=f"Feature '{e}' thiếu trong request.")
    except Exception as e:
        logger.error("Lỗi predict: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/predict/landslide")
def predict_landslide(data: dict):
    """
    Nhận dictionary chứa các features (địa hình, mưa, độ ẩm...).
    Chạy dự báo sạt lở qua ONNX model.
    """
    try:
        result = predict_landslide_risk(data)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("Lỗi predict landslide: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/predict/batch")
async def predict_flood_batch(request: Request):
    """
    Dự đoán hàng loạt — pipeline 2 tầng.
    Nhận raw JSON array để tránh Pydantic parse overhead.
    Trả về list[{flood_depth_cm, risk_level, stage, stage1_depth_cm?}].
    """
    if _stage1 is None:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng.")

    try:
        items: list[dict] = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"JSON parse error: {e}")

    if not items:
        return []

    try:
        matrix = [[row[feat] for feat in FEATURE_ORDER] for row in items]
        # Chạy pipeline trong thread riêng: _stage1.predict() + _stage2.predict() đều CPU-bound
        results = await asyncio.to_thread(_run_pipeline, matrix)
        return results
    except KeyError as e:
        logger.error("Feature thiếu trong batch: %s", e)
        raise HTTPException(status_code=422, detail=f"Feature '{e}' thiếu trong request.")
    except Exception as e:
        logger.error("Lỗi batch predict: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
