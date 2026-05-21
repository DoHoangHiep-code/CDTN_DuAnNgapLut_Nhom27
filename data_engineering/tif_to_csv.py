"""
Chuyển đổi GeoTIFF (từ gee_prediction_map_pipeline.py v2) → CSV.

Thay đổi so với v1:
  - Đọc band `record_date_unix` từ TIF → thêm cột `record_date` (YYYY-MM-DD)
  - Fallback: nếu TIF không có band ngày, parse từ tên file (features_Prov_YYYY-MM-DD.tif)
  - Xử lý NoData per-band (chỉ drop pixel khi tất cả feature bands đều là NoData)
  - Báo cáo chi tiết % null từng band để dễ debug

Cách chạy:
    pip install rasterio numpy pandas tqdm
    python tif_to_csv.py
"""

import os
import re
import glob
import numpy as np
import pandas as pd
import rasterio
from datetime import datetime, timezone
from tqdm import tqdm

# ── CẤU HÌNH ──────────────────────────────────────────────────────────────
GEOTIFF_DIR = '/content/drive/MyDrive/DoAn_Landslide_PredMap'
OUTPUT_CSV  = 'grid_prediction_datv2.csv'

# 30 feature bands (thứ tự phải khớp với ee.Image.cat trong GEE pipeline)
FEATURE_NAMES = [
    'elevation', 'slope', 'aspect', 'hillshade',
    'curvature_plan', 'curvature_profile', 'tpi', 'tri', 'roughness', 'twi',
    'rain_1d_accum', 'rain_3d_accum', 'rain_7d_accum',
    'rain_14d_accum', 'rain_30d_accum',
    'max_rain_1d_in_7d', 'max_rain_1d_in_3d',
    'api_7d', 'api_14d',
    'soil_moisture_1d', 'soil_moisture_7d',
    'ndvi', 'evi', 'ndwi', 'bsi',
    'lulc_class',
    'dist_to_river_m', 'dist_to_road_m',
    'slope_x_deforestation', 'twi_x_rain7d', 'rain_intensity_ratio',
]
N_FEATURE_BANDS = len(FEATURE_NAMES)  # = 30

# Band thứ 31 là record_date_unix (nếu TIF v2)
DATE_BAND_NAME = 'record_date_unix'

# Bands địa hình tĩnh: không bao giờ null nếu DEM phủ đủ
# Dùng để quyết định pixel có hợp lệ không
STATIC_BANDS = ['elevation', 'slope']

# ──────────────────────────────────────────────────────────────────────────


def unix_days_to_date(unix_days: float) -> str:
    """Chuyển số ngày từ Unix epoch (1970-01-01) sang chuỗi YYYY-MM-DD."""
    try:
        ts = int(unix_days) * 86400  # giây
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
    except Exception:
        return 'unknown'


def parse_date_from_filename(fname: str) -> str:
    """
    Trích xuất ngày từ tên file dạng:
      features_YenBai_2025-05-17.tif  →  '2025-05-17'
      features_YenBai.tif             →  'unknown'
    """
    match = re.search(r'(\d{4}-\d{2}-\d{2})', fname)
    return match.group(1) if match else 'unknown'


def read_tif(tif_path: str) -> dict:
    """
    Đọc một file TIF, trả về dict gồm:
      data         : ndarray [n_bands, H, W]
      transform    : affine transform
      nodata       : giá trị nodata (hoặc None)
      n_bands      : số band trong file
      has_date_band: True nếu TIF có band record_date_unix
      H, W         : kích thước raster
    """
    with rasterio.open(tif_path) as src:
        return {
            'data'         : src.read(),
            'transform'    : src.transform,
            'nodata'       : src.nodata,
            'n_bands'      : src.count,
            'has_date_band': src.count >= N_FEATURE_BANDS + 1,
            'H'            : src.height,
            'W'            : src.width,
        }


def process_tif(tif_path: str) -> pd.DataFrame:
    """
    Chuyển 1 file TIF → DataFrame với các cột:
      province, record_date, lat, lon, <30 feature cols>
    """
    fname    = os.path.basename(tif_path)
    province = re.sub(r'features_|\.tif$', '', fname)
    # Bỏ phần ngày trong tên tỉnh (nếu có): YenBai_2025-05-17 → YenBai
    province = re.sub(r'_\d{4}-\d{2}-\d{2}$', '', province)

    info = read_tif(tif_path)
    data      = info['data']       # [n_bands, H, W]
    transform = info['transform']
    nodata    = info['nodata']
    H, W      = info['H'], info['W']
    n_bands   = info['n_bands']

    # ── 1. Lấy mảng ngày ──────────────────────────────────────────────────
    if info['has_date_band']:
        # Band thứ 31 (index 30) là record_date_unix
        date_band    = data[N_FEATURE_BANDS]   # [H, W]
        date_flat    = date_band.flatten()
        has_date_arr = True
    else:
        # TIF cũ không có band ngày → parse từ tên file
        date_str_fallback = parse_date_from_filename(fname)
        has_date_arr      = False

    # ── 2. Lấy mảng feature ───────────────────────────────────────────────
    # Chỉ lấy N_FEATURE_BANDS đầu (bỏ band ngày nếu có)
    feat_data = data[:N_FEATURE_BANDS]  # [30, H, W]

    # ── 3. Tọa độ lat/lon ─────────────────────────────────────────────────
    cols_grid, rows_grid = np.meshgrid(np.arange(W), np.arange(H))
    xs, ys = rasterio.transform.xy(
        transform, rows_grid.flatten(), cols_grid.flatten()
    )
    lons = np.array(xs, dtype=np.float32)
    lats = np.array(ys, dtype=np.float32)

    # ── 4. Flatten features → [n_pixels, 30] ─────────────────────────────
    X = feat_data.reshape(N_FEATURE_BANDS, -1).T.astype(np.float32)
    # [n_pixels, 30]

    # ── 5. Mask pixel không hợp lệ ────────────────────────────────────────
    # Coi pixel hợp lệ khi ít nhất các band địa hình tĩnh không phải nodata/NaN
    static_idx = [FEATURE_NAMES.index(b) for b in STATIC_BANDS
                  if b in FEATURE_NAMES]

    if nodata is not None:
        # Drop pixel khi TẤT CẢ band tĩnh đều là nodata
        static_nodata = np.all(X[:, static_idx] == nodata, axis=1)
        valid = ~static_nodata
    else:
        # Drop pixel khi tất cả bands đều NaN
        valid = ~np.isnan(X).all(axis=1)

    n_valid = valid.sum()
    if n_valid == 0:
        print(f"    ⚠️  {province}: không có pixel hợp lệ, bỏ qua.")
        return pd.DataFrame()

    X_valid    = X[valid]
    lons_valid = lons[valid]
    lats_valid = lats[valid]

    # ── 6. Thay nodata per-band bằng NaN ─────────────────────────────────
    # Giữ pixel nhưng để NaN cho band bị mask (dynamic bands như SMAP)
    if nodata is not None:
        X_valid = np.where(X_valid == nodata, np.nan, X_valid)

    # ── 7. Ngày bản ghi ───────────────────────────────────────────────────
    if has_date_arr:
        date_valid = date_flat[valid]
        # Chuyển từng pixel (đa số cùng giá trị) → chuỗi YYYY-MM-DD
        # Lấy mode để tránh nhiễu từ pixel biên
        unique_days, counts = np.unique(
            date_valid[~np.isnan(date_valid)], return_counts=True
        )
        if len(unique_days) > 0:
            dominant_day = unique_days[np.argmax(counts)]
            record_date  = unix_days_to_date(dominant_day)
        else:
            record_date = parse_date_from_filename(fname)
    else:
        record_date = date_str_fallback

    # ── 8. Tạo DataFrame ──────────────────────────────────────────────────
    df = pd.DataFrame(X_valid, columns=FEATURE_NAMES)
    df.insert(0, 'record_date', record_date)
    df.insert(0, 'lon',         lons_valid.round(5))
    df.insert(0, 'lat',         lats_valid.round(5))
    df.insert(0, 'province',    province)

    # ── 9. Báo cáo null per-band ─────────────────────────────────────────
    null_pct = df[FEATURE_NAMES].isna().mean() * 100
    null_cols = null_pct[null_pct > 0].sort_values(ascending=False)
    if not null_cols.empty:
        print(f"    ℹ️  Null per-band (top 5):")
        for band, pct in null_cols.head(5).items():
            print(f"       {band:<30s}: {pct:.1f}%")

    return df


# ──────────────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────────────

tif_files = sorted(glob.glob(os.path.join(GEOTIFF_DIR, 'features_*.tif')))
if not tif_files:
    raise FileNotFoundError(
        f"Không tìm thấy features_*.tif trong '{GEOTIFF_DIR}'\n"
        f"  → Kiểm tra lại GEOTIFF_DIR hoặc download TIF từ Google Drive."
    )

print(f"Tìm thấy {len(tif_files)} file TIF | Output: {OUTPUT_CSV}\n")

all_chunks = []
for tif_path in tqdm(tif_files, desc='Đọc TIF'):
    print(f"\n  📂 {os.path.basename(tif_path)}")
    df_chunk = process_tif(tif_path)
    if df_chunk.empty:
        continue
    all_chunks.append(df_chunk)
    print(f"    → {len(df_chunk):,} pixels | record_date: {df_chunk['record_date'].iloc[0]}")

if not all_chunks:
    raise RuntimeError("Không có dữ liệu hợp lệ từ bất kỳ file TIF nào!")

print(f"\nGhép {len(all_chunks)} tỉnh...")
df_final = pd.concat(all_chunks, ignore_index=True)

# ── Tóm tắt chất lượng dữ liệu ───────────────────────────────────────────
print(f"\n{'─'*50}")
print(f"TỔNG KẾT CHẤT LƯỢNG DỮ LIỆU")
print(f"{'─'*50}")
print(f"Tổng số pixels : {len(df_final):,}")
print(f"Số tỉnh        : {df_final['province'].nunique()}")
print(f"Ngày bản ghi   : {df_final['record_date'].unique().tolist()}")

null_summary = df_final[FEATURE_NAMES].isna().mean() * 100
null_nonzero = null_summary[null_summary > 0].sort_values(ascending=False)
if not null_nonzero.empty:
    print(f"\nBands có null (sau fallback):")
    for band, pct in null_nonzero.items():
        bar = '█' * int(pct / 5)
        print(f"  {band:<30s}: {pct:5.1f}% {bar}")
    print("\n  → Những band này sẽ cần imputation trước khi predict.")
    print("  → Gợi ý: KNNImputer hoặc fillna(median) cho soil_moisture.")
else:
    print("\n✅ Không có null — dữ liệu hoàn chỉnh!")

# ── Export ────────────────────────────────────────────────────────────────
df_final.to_csv(OUTPUT_CSV, index=False)
print(f"\n✅ Đã xuất: {OUTPUT_CSV}")
print(f"   {len(df_final):,} rows × {len(df_final.columns)} columns")
print(f"   File size: {os.path.getsize(OUTPUT_CSV)/1024/1024:.1f} MB")
print(f"\nCác cột: {list(df_final.columns)}")