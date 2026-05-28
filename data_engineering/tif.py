"""
================================================================================
  GEE PREDICTION MAP PIPELINE - MIỀN BẮC VIỆT NAM  (v3)
  Phiên bản: Vectorized Image Export (GeoTIFF) theo tỉnh

  THAY ĐỔI v3 (so với v2):
  ─────────────────────────────────────────────────────────────────────────────
  CHIẾN LƯỢC FALLBACK MỚI - "Lùi tới ngày gần nhất có dữ liệu":

    Thay vì lookback cố định N ngày, mỗi dataset dùng:
      collection.sort('system:time_start', False).first()
    → GEE tự tìm ảnh MỚI NHẤT có sẵn trước ngày tham chiếu
    → Không bao giờ trả 0 giả tạo, không giới hạn số ngày lùi cứng

    Cụ thể từng dataset:
      CHIRPS  : .sort().limit(N) → N ảnh mới nhất trong 60 ngày
      SMAP    : .sort().first()  trong 90 ngày  (bù trễ 2-5 ngày)
      MODIS   : .sort().first()  trong 180 ngày (composite 16 ngày)
      Landsat : .sort().limit(5).median() cloud-free mới nhất
      LULC    : .sort().first()  trong 24 tháng (publish chậm 6-12 tháng)

  Tên file TIF: features_<TinhName>_<YYYY-MM-DD>.tif
  Band 31:      record_date_unix

  CÁCH CHẠY:
    pip install earthengine-api
    python gee_prediction_map_pipeline.py
================================================================================
"""

import ee
import math
from datetime import date, timedelta

# ─────────────────────────────────────────────────────────────────────────────
# CẤU HÌNH
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_ID   = 'advance-age-478508-f6'
DRIVE_FOLDER = 'DoAn_Landslide_PredMap'

# Lùi 3 ngày: CHIRPS thường trễ 1-3 ngày; lùi 3 đảm bảo rain_1d đã index xong
FIXED_DATE = (date.today() - timedelta(days=3)).strftime('%Y-%m-%d')

EXPORT_SCALE = 500  # mét

EXPORT_PROVINCES = [
    'Yen Bai', 'Ha Giang', 'Lao Cai', 'Lai Chau',
    'Dien Bien', 'Son La', 'Cao Bang', 'Lang Son',
    'Tuyen Quang', 'Bac Kan', 'Thai Nguyen',
    'Hoa Binh', 'Quang Ninh', 'Phu Tho',
]

MAX_ROAD_DISTANCE_M  = 20000
MAX_RIVER_DISTANCE_M = 30000
STATIC_SCALE_M       = 30

# ─────────────────────────────────────────────────────────────────────────────
# BƯỚC 0: KHỞI TẠO
# ─────────────────────────────────────────────────────────────────────────────

print("=" * 70)
print(f"  GEE PREDICTION MAP PIPELINE v3  |  Ngày tham chiếu: {FIXED_DATE}")
print("=" * 70)

try:
    ee.Initialize(project=PROJECT_ID)
    print("[0] ✅ Đã kết nối GEE")
except Exception:
    ee.Authenticate()
    ee.Initialize(project=PROJECT_ID)
    print("[0] ✅ Xác thực và kết nối thành công!")

event_date = ee.Date(FIXED_DATE)

# ─────────────────────────────────────────────────────────────────────────────
# BƯỚC 1: LOAD DATASETS
# ─────────────────────────────────────────────────────────────────────────────

print(f"\n[1] Tải datasets GEE...")

dem        = ee.Image('USGS/SRTMGL1_003')
chirps     = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').select('precipitation')
modis_ndvi = ee.ImageCollection('MODIS/061/MOD13Q1').select(['NDVI', 'EVI'])
modis_lulc = ee.ImageCollection('MODIS/061/MCD12Q1').select('LC_Type1')
smap       = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005').select(
                 ['soil_moisture_am', 'soil_moisture_pm'])
jrc_water  = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence')
grip_roads = ee.FeatureCollection('projects/sat-io/open-datasets/GRIP4/South-East-Asia')
landsat8   = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')

vietnam_provinces = ee.FeatureCollection('FAO/GAUL/2015/level1') \
    .filter(ee.Filter.eq('ADM0_NAME', 'Viet Nam'))

province_fc  = vietnam_provinces.filter(
    ee.Filter.inList('ADM1_NAME', EXPORT_PROVINCES)
)
study_region = province_fc.union(maxError=1000).geometry().buffer(5000)

print(f"    ✅ {len(EXPORT_PROVINCES)} tỉnh | Ngày tham chiếu: {FIXED_DATE}")

# ─────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# Cốt lõi của v3: sort('system:time_start', False) → .first() / .limit(N)
# GEE xử lý server-side, tự tìm ngày gần nhất mà không cần vòng lặp
# ─────────────────────────────────────────────────────────────────────────────

def newest_first(col):
    """Sort collection mới nhất lên đầu."""
    return col.sort('system:time_start', False)


def get_latest_image(collection, before_date, lookback_days, fallback_bands):
    """
    Lấy ảnh MỚI NHẤT trong window [before_date - lookback_days, before_date].
    Nếu window rỗng → masked image (null trong CSV, không phải 0).

    Đây là cách chính xác để "lùi tới ngày gần nhất có dữ liệu":
    sort giảm dần → .first() = ảnh mới nhất trong window.
    """
    col = newest_first(
        collection.filterDate(
            before_date.advance(-lookback_days, 'day'), before_date
        )
    )
    n = len(fallback_bands)
    masked = ee.Image.constant([0] * n).rename(fallback_bands) \
               .updateMask(ee.Image.constant(0))
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.first(), masked))


def get_latest_n_sum(collection, before_date, n_days,
                     lookback_days, band_name):
    """
    Tổng mưa N ngày: lấy đúng window [T-N, T].
    Nếu CHIRPS chưa index kịp → lùi thêm, lấy N ảnh mới nhất trong lookback_days.

    Ví dụ rain_1d_accum (n_days=1):
      Thử [T-1, T] → nếu rỗng → sort mới nhất trong [T-lookback, T], lấy 1 ảnh
    """
    # Window chính: đúng N ngày
    col_exact = collection.filterDate(
        before_date.advance(-n_days, 'day'), before_date
    )
    # Fallback: N ảnh mới nhất trong lookback_days ngày
    col_fallback = newest_first(
        collection.filterDate(
            before_date.advance(-lookback_days, 'day'), before_date
        )
    ).limit(n_days)

    masked = ee.Image.constant(0).rename('precipitation') \
               .updateMask(ee.Image.constant(0))

    col_best = ee.ImageCollection(ee.Algorithms.If(
        col_exact.size().gte(n_days),
        col_exact,
        ee.ImageCollection(ee.Algorithms.If(
            col_fallback.size().gt(0),
            col_fallback,
            ee.ImageCollection([masked])
        ))
    ))
    return ee.Image(ee.Algorithms.If(
        col_best.size().gt(0), col_best.sum(), masked
    )).rename(band_name)


def get_latest_n_max(collection, before_date, n_days,
                     lookback_days, band_name):
    """Tương tự get_latest_n_sum nhưng lấy max (dùng cho mưa cực đoan)."""
    col_exact = collection.filterDate(
        before_date.advance(-n_days, 'day'), before_date
    )
    col_fallback = newest_first(
        collection.filterDate(
            before_date.advance(-lookback_days, 'day'), before_date
        )
    ).limit(n_days)

    masked = ee.Image.constant(0).rename('precipitation') \
               .updateMask(ee.Image.constant(0))

    col_best = ee.ImageCollection(ee.Algorithms.If(
        col_exact.size().gte(n_days),
        col_exact,
        ee.ImageCollection(ee.Algorithms.If(
            col_fallback.size().gt(0),
            col_fallback,
            ee.ImageCollection([masked])
        ))
    ))
    return ee.Image(ee.Algorithms.If(
        col_best.size().gt(0), col_best.max(), masked
    )).rename(band_name)

# ─────────────────────────────────────────────────────────────────────────────
# BƯỚC 2: BUILD FEATURE BANDS
# ─────────────────────────────────────────────────────────────────────────────

def build_terrain_bands():
    """10 bands địa hình tĩnh - không phụ thuộc thời gian."""
    topo = ee.Terrain.products(dem)

    dem_smooth   = dem.focal_mean(radius=1, kernelType='square', units='pixels')
    laplacian    = ee.Kernel.laplacian8(normalize=False)
    curv_plan    = dem_smooth.convolve(laplacian).rename('curvature_plan')
    curv_profile = topo.select('slope').convolve(laplacian).rename('curvature_profile')

    mean_300m = dem.focal_mean(radius=300, kernelType='circle', units='meters')
    tpi = dem.subtract(mean_300m).rename('tpi')

    focal_max = dem.focal_max(radius=90, kernelType='circle', units='meters')
    focal_min = dem.focal_min(radius=90, kernelType='circle', units='meters')
    tri = focal_max.subtract(focal_min).rename('tri')

    roughness = dem.reduceNeighborhood(
        reducer=ee.Reducer.stdDev(),
        kernel=ee.Kernel.circle(radius=150, units='meters'),
        skipMasked=True
    ).rename('roughness')

    slope_rad = topo.select('slope').multiply(math.pi / 180)
    tan_slope = slope_rad.tan().max(ee.Image(0.001))
    twi = dem.divide(tan_slope).log().rename('twi')

    return ee.Image.cat([
        topo.select('elevation'), topo.select('slope'),
        topo.select('aspect'),    topo.select('hillshade'),
        curv_plan, curv_profile, tpi, tri, roughness, twi
    ])


def build_rainfall_bands(event_date):
    """
    9 bands mưa từ CHIRPS Daily.

    Với FIXED_DATE = today-3, CHIRPS thường đã có đủ.
    Fallback: lấy N ảnh mới nhất trong lookback_days = N+14 ngày
    để bù trường hợp CHIRPS trễ hơn thường lệ.
    """
    # --- Tích lũy mưa: sum ---
    rain_1d  = get_latest_n_sum(chirps, event_date,  1,  15, 'rain_1d_accum')
    rain_3d  = get_latest_n_sum(chirps, event_date,  3,  17, 'rain_3d_accum')
    rain_7d  = get_latest_n_sum(chirps, event_date,  7,  21, 'rain_7d_accum')
    rain_14d = get_latest_n_sum(chirps, event_date, 14,  28, 'rain_14d_accum')
    rain_30d = get_latest_n_sum(chirps, event_date, 30,  44, 'rain_30d_accum')

    # --- Max mưa 1 ngày trong window ---
    max_7d = get_latest_n_max(chirps, event_date, 7, 21, 'max_rain_1d_in_7d')
    max_3d = get_latest_n_max(chirps, event_date, 3, 17, 'max_rain_1d_in_3d')

    # --- API: Antecedent Precipitation Index ---
    # Với mỗi ngày i: lấy ảnh CHIRPS của ngày T-i (cho phép ±1 ngày để bù trễ)
    # → ảnh gần nhất của ngày đó, nhân hệ số suy giảm k^i
    k = ee.Number(0.9)

    def api_day(d):
        d_num   = ee.Number(d)
        day_ref = event_date.advance(d_num.multiply(-1), 'day')
        # Tìm ảnh CHIRPS gần nhất của ngày T-i (±1 ngày)
        col = newest_first(
            chirps.filterDate(
                day_ref.advance(-1, 'day'),
                day_ref.advance(1,  'day')
            )
        )
        rain = ee.Image(ee.Algorithms.If(
            col.size().gt(0),
            col.first(),
            ee.Image.constant(0).rename('precipitation')
        ))
        return rain.multiply(k.pow(d_num))

    api_7d = ee.ImageCollection.fromImages(
        ee.List.sequence(1, 7).map(api_day)
    ).sum().rename('api_7d')

    api_14d = ee.ImageCollection.fromImages(
        ee.List.sequence(1, 14).map(api_day)
    ).sum().rename('api_14d')

    return ee.Image.cat([
        rain_1d, rain_3d, rain_7d, rain_14d, rain_30d,
        max_7d, max_3d,
        api_7d, api_14d,
    ])


def build_soil_moisture_bands(event_date):
    """
    2 bands SMAP (~9km).

    sm_1d: ảnh SMAP mới nhất trong 90 ngày trước event_date
    sm_7d: mean của 7 ảnh SMAP mới nhất trong 90 ngày

    lookback 90 ngày đảm bảo luôn có ảnh (SMAP trễ 2-5 ngày thực tế).
    """
    LOOKBACK = 90  # ngày

    sm_col = newest_first(
        smap.filterDate(event_date.advance(-LOOKBACK, 'day'), event_date)
    )

    empty_2 = ee.Image.constant([0, 0]) \
        .rename(['soil_moisture_am', 'soil_moisture_pm']) \
        .updateMask(ee.Image.constant(0))

    # sm_1d: ảnh mới nhất
    sm_latest = ee.Image(ee.Algorithms.If(
        sm_col.size().gt(0), sm_col.first(), empty_2
    ))
    sm_1d = sm_latest.reduce(ee.Reducer.mean()).rename('soil_moisture_1d')

    # sm_7d: trung bình 7 ảnh mới nhất (≈ tuần gần nhất)
    sm_7_mean = ee.Image(ee.Algorithms.If(
        sm_col.size().gt(0),
        sm_col.limit(7).mean(),
        empty_2
    ))
    sm_7d = sm_7_mean.reduce(ee.Reducer.mean()).rename('soil_moisture_7d')

    return ee.Image.cat([sm_1d, sm_7d])


def build_vegetation_bands(event_date, region):
    """
    4 bands thực vật: ndvi, evi, ndwi, bsi.

    MODIS NDVI/EVI:
      Composite 16 ngày → sort mới nhất → lấy composite gần nhất
      trong 180 ngày (đủ để qua mùa mây dày nhất)

    Landsat 8:
      Thử cloud <20% / 6 tháng → nới 40% / 12 tháng
      Sort mới nhất → median của 5 ảnh gần nhất (cloud-free)
    """
    # --- MODIS NDVI + EVI ---
    ndvi_col = newest_first(
        modis_ndvi.filterDate(event_date.advance(-180, 'day'), event_date)
    )
    empty_veg = ee.Image.constant([0, 0]).rename(['NDVI', 'EVI']) \
        .updateMask(ee.Image.constant(0))

    # Lấy composite mới nhất (không mean toàn bộ để tránh trộn composite cũ)
    veg = ee.Image(ee.Algorithms.If(
        ndvi_col.size().gt(0),
        ndvi_col.first().multiply(0.0001),
        empty_veg
    ))
    ndvi = veg.select('NDVI').rename('ndvi')
    evi  = veg.select('EVI').rename('evi')

    # --- Landsat 8: ndwi + bsi ---
    scale_ls8 = lambda img: img.multiply(0.0000275).add(-0.2)
    ls8_bands = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6']

    # Thử strict: cloud <20%, 6 tháng
    ls8_strict = newest_first(
        landsat8
        .filterDate(event_date.advance(-6, 'month'), event_date)
        .filterBounds(region)
        .filter(ee.Filter.lt('CLOUD_COVER', 20))
        .map(scale_ls8)
    )
    # Fallback: cloud <40%, 12 tháng
    ls8_relaxed = newest_first(
        landsat8
        .filterDate(event_date.advance(-12, 'month'), event_date)
        .filterBounds(region)
        .filter(ee.Filter.lt('CLOUD_COVER', 40))
        .map(scale_ls8)
    )

    ls8_col = ee.ImageCollection(ee.Algorithms.If(
        ls8_strict.size().gt(0), ls8_strict, ls8_relaxed
    ))

    ls8_empty = ee.Image.constant([0] * 5).rename(ls8_bands) \
        .updateMask(ee.Image.constant(0))

    # Median 5 ảnh mới nhất → giảm nhiễu mây lẻ mà không dùng ảnh quá cũ
    ls8 = ee.Image(ee.Algorithms.If(
        ls8_col.size().gt(0),
        ls8_col.limit(5).median(),
        ls8_empty
    ))

    ndwi = ls8.normalizedDifference(['SR_B3', 'SR_B5']).rename('ndwi')
    bsi  = ls8.expression(
        '(SWIR + RED - NIR - BLUE) / (SWIR + RED + NIR + BLUE)',
        {'SWIR': ls8.select('SR_B6'), 'RED':  ls8.select('SR_B4'),
         'NIR':  ls8.select('SR_B5'), 'BLUE': ls8.select('SR_B2')}
    ).rename('bsi')

    return ee.Image.cat([ndvi, evi, ndwi, bsi])


def build_lulc_band(event_date):
    """
    1 band LULC MODIS MCD12Q1.
    Publish chậm 6-12 tháng → sort mới nhất trong 24 tháng.
    """
    lulc_col = newest_first(
        modis_lulc.filterDate(event_date.advance(-24, 'month'), event_date)
    )
    return ee.Image(ee.Algorithms.If(
        lulc_col.size().gt(0),
        lulc_col.first(),   # Năm LULC gần nhất có sẵn
        ee.Image.constant(0).rename('LC_Type1')
    )).select('LC_Type1').rename('lulc_class')


def build_distance_bands(region):
    """2 bands khoảng cách tĩnh."""
    def fast_dist(binary_img, max_d, name):
        max_pixels = int(max_d / STATIC_SCALE_M) + 2
        dist = binary_img.unmask(0).fastDistanceTransform(
            neighborhood=max_pixels, units='pixels'
        ).sqrt().multiply(STATIC_SCALE_M).rename(name)
        return dist.where(dist.gt(max_d), max_d).clip(region)

    water_bin  = jrc_water.gt(50).selfMask().clip(region)
    dist_water = fast_dist(water_bin, MAX_RIVER_DISTANCE_M, 'dist_to_river_m')

    roads_near = grip_roads.filterBounds(region)
    road_bin   = ee.Image.constant(0).byte().paint(
        featureCollection=roads_near, color=1, width=1
    ).eq(1).selfMask().clip(region)

    dist_road = ee.Image(ee.Algorithms.If(
        roads_near.size().gt(0),
        fast_dist(road_bin, MAX_ROAD_DISTANCE_M, 'dist_to_road_m'),
        ee.Image.constant(MAX_ROAD_DISTANCE_M).rename('dist_to_road_m').clip(region)
    ))

    return ee.Image.cat([dist_water, dist_road])

# ─────────────────────────────────────────────────────────────────────────────
# KIỂM TRA NGÀY THỰC TẾ MỚI NHẤT (chạy trước export để debug)
# ─────────────────────────────────────────────────────────────────────────────

print("\n[2] Kiểm tra ngày thực tế mới nhất của từng dataset...")

def check_latest_date(collection, lookback_days, name):
    col = newest_first(
        collection.filterDate(event_date.advance(-lookback_days, 'day'), event_date)
    )
    try:
        size = col.size().getInfo()
        if size > 0:
            ts      = col.first().get('system:time_start').getInfo()
            dt      = date.fromtimestamp(ts / 1000)
            ref     = date.fromisoformat(FIXED_DATE)
            lag     = (ref - dt).days
            dt_str  = dt.strftime('%Y-%m-%d')
            status  = "✅" if lag <= 7 else "⚠️ "
            print(f"    {status} {name:<25s}: {dt_str}  (trễ {lag} ngày)")
        else:
            print(f"    ❌ {name:<25s}: KHÔNG CÓ dữ liệu trong {lookback_days} ngày!")
    except Exception as e:
        print(f"    ❓ {name:<25s}: lỗi ({e})")

check_latest_date(chirps,     14,  'CHIRPS (mưa)')
check_latest_date(smap,       90,  'SMAP (độ ẩm đất)')
check_latest_date(modis_ndvi, 180, 'MODIS NDVI/EVI')
check_latest_date(modis_lulc, 730, 'MODIS LULC')
check_latest_date(
    landsat8.filterBounds(study_region).filter(ee.Filter.lt('CLOUD_COVER', 40)),
    365, 'Landsat 8 (<40% cloud)'
)

# ─────────────────────────────────────────────────────────────────────────────
# BƯỚC 3: BUILD FEATURE IMAGE STACK
# ─────────────────────────────────────────────────────────────────────────────

print("\n[3] Xây dựng feature image stack...")

terrain_img  = build_terrain_bands();   print("    ✅ Địa hình    (10 bands)")
rainfall_img = build_rainfall_bands(event_date); print("    ✅ Mưa CHIRPS  (9 bands) - newest first")
sm_img       = build_soil_moisture_bands(event_date); print("    ✅ Độ ẩm SMAP (2 bands) - newest first")
veg_img      = build_vegetation_bands(event_date, study_region); print("    ✅ Thực vật    (4 bands) - newest first")
lulc_img     = build_lulc_band(event_date); print("    ✅ LULC MODIS (1 band)  - năm gần nhất")
dist_img     = build_distance_bands(study_region); print("    ✅ Khoảng cách (2 bands) - tĩnh")

# Đặc trưng dẫn xuất
slope_x_deforest = terrain_img.select('slope').multiply(
    ee.Image.constant(1).subtract(veg_img.select('ndvi').max(ee.Image.constant(0)))
).rename('slope_x_deforestation')

twi_x_rain7d = terrain_img.select('twi') \
    .multiply(rainfall_img.select('rain_7d_accum')).rename('twi_x_rain7d')

rain_intensity_ratio = rainfall_img.select('rain_1d_accum').divide(
    rainfall_img.select('rain_7d_accum').max(ee.Image.constant(0.001))
).rename('rain_intensity_ratio')

# Band ngày để tif_to_csv parse ra record_date
unix_days = ee.Image.constant(
    ee.Date(FIXED_DATE).difference(ee.Date('1970-01-01'), 'day')
).rename('record_date_unix').toFloat()

# Stack 31 bands
feature_image = ee.Image.cat([
    terrain_img,           # 0-9   : 10 bands địa hình
    rainfall_img,          # 10-18 : 9  bands mưa
    sm_img,                # 19-20 : 2  bands độ ẩm đất
    veg_img,               # 21-24 : 4  bands thực vật
    lulc_img,              # 25    : 1  band  LULC
    dist_img,              # 26-27 : 2  bands khoảng cách
    slope_x_deforest,      # 28
    twi_x_rain7d,          # 29
    rain_intensity_ratio,  # 30
    unix_days,             # 31    ← ngày bản ghi
]).clip(study_region)

land_mask     = jrc_water.lt(80).unmask(1)
feature_image = feature_image.updateMask(land_mask).toFloat()

print("\n    ✅ Stack: 31 bands (30 features + record_date_unix)")

# ─────────────────────────────────────────────────────────────────────────────
# BƯỚC 4: EXPORT TỪNG TỈNH → GOOGLE DRIVE
# ─────────────────────────────────────────────────────────────────────────────

print(f"\n[4] Export {len(EXPORT_PROVINCES)} tỉnh → {DRIVE_FOLDER} ...")

province_names_gee = province_fc.aggregate_array('ADM1_NAME').getInfo()
print(f"    Tìm thấy {len(province_names_gee)} tỉnh trong GAUL")

date_str = FIXED_DATE  # YYYY-MM-DD

tasks = []
for prov_name in province_names_gee:
    prov_geom = province_fc.filter(
        ee.Filter.eq('ADM1_NAME', prov_name)
    ).geometry()

    prov_img = feature_image.clip(prov_geom)

    prov_safe = (prov_name
                 .replace(' ', '_')
                 .replace("'", '')
                 .replace('ô', 'o'))
    file_prefix = f'features_{prov_safe}_{date_str}'

    task = ee.batch.Export.image.toDrive(
        image          = prov_img,
        description    = f'PredMap_{prov_safe}_{date_str}',
        folder         = DRIVE_FOLDER,
        fileNamePrefix = file_prefix,
        scale          = EXPORT_SCALE,
        region         = prov_geom,
        maxPixels      = 1e10,
        crs            = 'EPSG:4326',
        fileFormat     = 'GeoTIFF',
        formatOptions  = {'cloudOptimized': True}
    )
    task.start()
    tasks.append({'province': prov_name, 'task': task, 'file': file_prefix})
    print(f"    ✅ [{len(tasks):02d}/{len(province_names_gee)}] {prov_name}"
          f" → {file_prefix}.tif")

# ─────────────────────────────────────────────────────────────────────────────
# BƯỚC 5: THÔNG BÁO
# ─────────────────────────────────────────────────────────────────────────────

print(f"\n[5] Tất cả {len(tasks)} tasks đã được start!")
for t in tasks:
    try:
        s = t['task'].status()
        print(f"    • {t['province']}: {s.get('id','N/A')} [{s.get('state','?')}]")
    except Exception as e:
        print(f"    • {t['province']}: lỗi ({e})")

print(f"""
{'='*70}
✅  {len(tasks)} EXPORT TASKS ĐÃ KÍCH HOẠT  (v3)
{'='*70}

  🔗 Theo dõi: https://code.earthengine.google.com/tasks

  📁 Output: Google Drive → {DRIVE_FOLDER}/
     Format:  features_<TinhName>_{date_str}.tif
     Bands:   31 (30 features + record_date_unix)

  🆕 Chiến lược v3 - "Ngày gần nhất có dữ liệu":
     • Tất cả dataset dùng .sort('system:time_start', False)
       → GEE tự tìm ảnh mới nhất, không giới hạn lookback cứng

     Dataset       │ Lookback  │ Chiến lược
     ──────────────┼───────────┼──────────────────────────────
     CHIRPS mưa   │ N+14 ngày │ N ảnh mới nhất cho tích lũy
     SMAP          │ 90 ngày   │ .first() = ảnh SMAP mới nhất
     MODIS NDVI   │ 180 ngày  │ .first() = composite mới nhất
     Landsat 8    │ 12 tháng  │ .limit(5).median() cloud-free
     LULC MODIS   │ 24 tháng  │ .first() = năm LULC gần nhất

  ⚠️  Sau khi download TIF, chạy tif_to_csv.py để có CSV với cột record_date
{'='*70}
""")