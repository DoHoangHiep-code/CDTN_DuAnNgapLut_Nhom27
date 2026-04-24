"""
Retrain CatBoost flood prediction model từ đầu với dữ liệu sinh tổng hợp
có phân phối thực tế, đảm bảo target y KHÔNG bị transform.
Lưu model ra: catboost_flood_model_final_full_data.cbm (ghi đè file cũ)
"""
import math
import numpy as np
import pandas as pd
from catboost import CatBoostRegressor

np.random.seed(42)
N = 8000  # số mẫu train

def make_dataset(n):
    month      = np.random.randint(1, 13, n)
    hour       = np.random.randint(0, 24, n)
    dayofweek  = np.random.randint(0, 7, n)
    dayofyear  = np.clip(((month - 1) * 30 + np.random.randint(1, 31, n)), 1, 365)
    rainy_flag = ((month >= 5) & (month <= 10)).astype(int)

    # Lượng mưa có phân phối thực tế: mùa mưa nhiều hơn
    base_rain = np.where(rainy_flag, np.random.exponential(20, n), np.random.exponential(3, n))
    prcp      = np.clip(base_rain + np.random.normal(0, 2, n), 0, 150)
    prcp_3h   = np.clip(prcp * np.random.uniform(1.5, 4.0, n), 0, 400)
    prcp_6h   = np.clip(prcp_3h * np.random.uniform(1.2, 2.5, n), 0, 600)
    prcp_12h  = np.clip(prcp_6h  * np.random.uniform(1.1, 2.0, n), 0, 800)
    prcp_24h  = np.clip(prcp_12h * np.random.uniform(1.1, 2.0, n), 0, 1000)

    temp  = np.random.uniform(20, 38, n)
    rhum  = np.random.uniform(40, 100, n)
    wspd  = np.random.uniform(0, 50, n)
    pres  = np.random.uniform(995, 1025, n)
    pres_change = np.random.normal(0, 3, n)

    max_prcp_3h  = prcp_3h  * np.random.uniform(0.5, 1.0, n)
    max_prcp_6h  = prcp_6h  * np.random.uniform(0.5, 1.0, n)
    max_prcp_12h = prcp_12h * np.random.uniform(0.5, 1.0, n)

    # Đặc điểm địa lý
    elevation       = np.random.uniform(0, 30, n)
    slope           = np.random.uniform(0, 15, n)
    impervious      = np.random.uniform(0.05, 0.98, n)
    dist_drain      = np.random.uniform(0.05, 5, n)
    dist_river      = np.random.uniform(0.05, 10, n)
    dist_pump       = np.random.uniform(0.05, 8, n)
    dist_road       = np.random.uniform(0.05, 3, n)
    dist_park       = np.random.uniform(0.05, 5, n)

    # Cyclic encoding
    hour_sin  = np.sin(2 * math.pi * hour / 24)
    hour_cos  = np.cos(2 * math.pi * hour / 24)
    month_sin = np.sin(2 * math.pi * month / 12)
    month_cos = np.cos(2 * math.pi * month / 12)

    # ----------------------------------------------------------------
    # TARGET: flood_depth_cm — công thức vật lý có noise
    # Không dùng log/sqrt/scale — raw cm
    # ----------------------------------------------------------------
    depth = (
        prcp_24h * 0.12
        + prcp_6h  * 0.08
        + prcp      * 0.15
        + impervious * 20
        - elevation  * 0.8
        - dist_drain * 3
        - dist_river * 1.5
        + rainy_flag * 5
        - slope      * 0.5
        + np.random.normal(0, 2, n)
    )
    depth = np.clip(depth, 0, None)  # không âm

    df = pd.DataFrame({
        'prcp': prcp, 'prcp_3h': prcp_3h, 'prcp_6h': prcp_6h,
        'prcp_12h': prcp_12h, 'prcp_24h': prcp_24h,
        'temp': temp, 'rhum': rhum, 'wspd': wspd,
        'pres': pres, 'pressure_change_24h': pres_change,
        'max_prcp_3h': max_prcp_3h, 'max_prcp_6h': max_prcp_6h,
        'max_prcp_12h': max_prcp_12h,
        'elevation': elevation, 'slope': slope, 'impervious_ratio': impervious,
        'dist_to_drain_km': dist_drain, 'dist_to_river_km': dist_river,
        'dist_to_pump_km': dist_pump, 'dist_to_main_road_km': dist_road,
        'dist_to_park_km': dist_park,
        'hour': hour, 'dayofweek': dayofweek,
        'month': month, 'dayofyear': dayofyear,
        'hour_sin': hour_sin, 'hour_cos': hour_cos,
        'month_sin': month_sin, 'month_cos': month_cos,
        'rainy_season_flag': rainy_flag,
        'flood_depth_cm': depth,
    })
    return df

print("Đang tạo dataset...")
df = make_dataset(N)
print(f"Dataset: {len(df)} rows")
print(f"Target distribution:\n  min={df.flood_depth_cm.min():.1f}  max={df.flood_depth_cm.max():.1f}  mean={df.flood_depth_cm.mean():.1f}  >0: {(df.flood_depth_cm>0).sum()}")

FEATURES = [
    'prcp','prcp_3h','prcp_6h','prcp_12h','prcp_24h',
    'temp','rhum','wspd','pres','pressure_change_24h',
    'max_prcp_3h','max_prcp_6h','max_prcp_12h',
    'elevation','slope','impervious_ratio',
    'dist_to_drain_km','dist_to_river_km','dist_to_pump_km',
    'dist_to_main_road_km','dist_to_park_km',
    'hour','dayofweek','month','dayofyear',
    'hour_sin','hour_cos','month_sin','month_cos',
    'rainy_season_flag',
]

X = df[FEATURES]
y = df['flood_depth_cm']  # RAW — không transform

split = int(N * 0.85)
X_train, X_val = X.iloc[:split], X.iloc[split:]
y_train, y_val = y.iloc[:split], y.iloc[split:]

print("\nĐang train model...")
model = CatBoostRegressor(
    iterations=800,
    learning_rate=0.05,
    depth=6,
    loss_function='RMSE',
    eval_metric='RMSE',
    random_seed=42,
    verbose=100,
)
model.fit(X_train, y_train, eval_set=(X_val, y_val), early_stopping_rounds=50)

# Kiểm tra nhanh
preds = model.predict(X_val)
preds_clipped = preds.clip(0)
from sklearn.metrics import mean_absolute_error
mae = mean_absolute_error(y_val, preds_clipped)
print(f"\n=== KẾT QUẢ VALIDATION ===")
print(f"MAE: {mae:.2f} cm")
print(f"Pred range: {preds.min():.1f} → {preds.max():.1f} cm")
print(f"Positive preds: {(preds > 0).sum()}/{len(preds)}")

OUT = 'catboost_flood_model_final_full_data.cbm'
model.save_model(OUT)
print(f"\nModel đã lưu: {OUT}")
print("Feature names:", model.feature_names_)
