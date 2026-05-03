# 🌊 Logic Tính Toán Cảnh Báo Nguy Cơ Ngập (Flood Risk Warning)

## 📋 Tổng Quan

Hệ thống dự báo ngập lụt sử dụng **CatBoost Model** để dự đoán độ sâu ngập, sau đó chuyển đổi thành các mức cảnh báo khác nhau. Quy trình có 3 bước chính:

1. **Dự đoán độ sâu ngập** (flood_depth_cm) từ AI Model
2. **Phân loại mức độ rủi ro** (safe, medium, high, severe)
3. **Hiển thị cảnh báo** cho người dùng

---

## 🔄 Luồng Xử Lý (Processing Pipeline)

### **Bước 1: Thu Thập Features (30 thông số)**

**Vị trí code:** `backend/src/services/PredictionService.js` & `backend/src/routes/floodPredictionRoutes.js`

AI model yêu cầu **30 features** được chia thành các nhóm:

#### 📍 **Thời Tiết Hiện Tại** (từ OpenWeatherMap)
- `prcp`: Lượng mưa hiện tại (mm)
- `temp`: Nhiệt độ (°C)
- `rhum`: Độ ẩm tương đối (%)
- `wspd`: Tốc độ gió (m/s)
- `pres`: Áp suất khí quyển (hPa)

#### ☔ **Lượng Mưa Tích Lũy** (ước tính từ dữ liệu hiện tại)
```
prcp_3h  = prcp × 2.5  (tích lũy 3 giờ)
prcp_6h  = prcp × 4    (tích lũy 6 giờ)
prcp_12h = prcp × 6    (tích lũy 12 giờ)
prcp_24h = prcp × 8    (tích lũy 24 giờ)
```

#### 🏗️ **Đặc Điểm Địa Lý Địa Điểm** (tĩnh, lấy từ GridNode)
- `elevation`: Độ cao (m)
- `slope`: Độ dốc (%)
- `impervious_ratio`: Tỷ lệ bề mặt không thấm nước (0-1)
- `dist_to_drain_km`: Khoảng cách tới cống thoát nước (km)
- `dist_to_river_km`: Khoảng cách tới sông (km)
- `dist_to_pump_km`: Khoảng cách tới trạm bơm (km)
- `dist_to_main_road_km`: Khoảng cách tới đường chính (km)
- `dist_to_park_km`: Khoảng cách tới công viên (km)

#### ⏰ **Đặc Trưng Thời Gian**
```javascript
hour        // Giờ trong ngày (0-23)
dayofweek   // Thứ trong tuần (0=Thứ 2, 6=CN)
month       // Tháng (1-12)
dayofyear   // Ngày trong năm (1-366)

// Encoding chu kỳ (sin/cos) - giúp model nhận ra tính chu kỳ
hour_sin    = sin(2π × hour / 24)
hour_cos    = cos(2π × hour / 24)
month_sin   = sin(2π × month / 12)
month_cos   = cos(2π × month / 12)

// Cờ mùa mưa
rainy_season_flag = 1 (tháng 5-10) hoặc 0
```

---

### **Bước 2: Gọi AI Service (CatBoost)**

**Vị trí code:** `ai_service/main.py`

```python
# Endpoint: POST /api/predict
# Input: 30 features
# Output: 
# {
#   "flood_depth_cm": float (độ sâu ngập dự đoán, cm),
#   "risk_level": string (safe|medium|high|severe)
# }

def depth_to_risk(depth_cm: float) -> str:
    """Chuyển đổi độ sâu → mức rủi ro"""
    if depth_cm < 5:
        return "safe"      # An toàn
    if depth_cm < 20:
        return "medium"    # Nguy cơ thấp
    if depth_cm < 50:
        return "high"      # Nguy cơ cao
    return "severe"        # Rất nguy hiểm
```

**Model CatBoost:**
- Đã được huấn luyện trên dữ liệu lịch sử với nhãn từ báo cáo người dùng
- Trả về giá trị liên tục (không phải binary) → **Độ sâu ngập dự đoán (cm)**
- **Không cần normalize/scale** - CatBoost tự xử lý

---

### 🧮 **Chi Tiết: Logic Tính Toán flood_depth_cm**

#### **Công Thức Vật Lý Cơ Sở** (Training Data)
**Vị trí:** `ai/retrain_model.py` (dòng 56-71)

Model được huấn luyện với công thức dựa trên vật lý ngập lụt:

$$\text{depth}\_\text{cm} = \begin{align}
&\text{prcp}\_\text{24h} \times 0.12\\
&+ \text{prcp}\_\text{6h} \times 0.08\\
&+ \text{prcp} \times 0.15\\
&+ \text{impervious\_ratio} \times 20\\
&- \text{elevation} \times 0.8\\
&- \text{dist\_drain} \times 3\\
&- \text{dist\_river} \times 1.5\\
&+ \text{rainy\_flag} \times 5\\
&- \text{slope} \times 0.5\\
&+ \text{noise (N(0, 2))}\\
&\text{clip}(0, \infty)
\end{align}$$

**Giải thích hệ số:**

| Biến | Hệ số | Ý Nghĩa | 
|------|-------|---------|
| **prcp_24h** | +0.12 | Lượng mưa tích lũy 24h là yếu tố chính → độ sâu ngập |
| **prcp_6h** | +0.08 | Mưa tích lũy 6h có tác động thứ yếu |
| **prcp** (1h) | +0.15 | Mưa hiện tại có tác động ngay lập tức (cao nhất) |
| **impervious_ratio** | +20 | Diện tích không thấm nước cao → ngập sâu hơn (rất quan trọng!) |
| **elevation** | -0.8 | Nơi cao hơn → ngập ít hơn (hiệu chỉnh độ cao) |
| **dist_drain** | -3 | Gần cống thoát nước → ngập ít hơn (tác động mạnh) |
| **dist_river** | -1.5 | Gần sông → ngập có thể ít hơn (khác sông, khác cống) |
| **rainy_flag** | +5 | Mùa mưa (tháng 5-10) → độ sâu ngập tự động tăng |
| **slope** | -0.5 | Độ dốc cao → nước chảy nhanh, ngập ít hơn |
| **noise** | N(0,2) | Độ lệch chuẩn = 2cm (biến động thực tế) |

#### **Cách Model Học Pattern**

**Model Type:** `CatBoostRegressor`
- **Iterati ons:** 800 lần
- **Depth:** 6 (độ sâu cây quyết định)
- **Learning Rate:** 0.05 (tốc độ học)
- **Loss Function:** RMSE (Root Mean Squared Error)

```python
# Training set: 8000 mẫu dữ liệu
# Validation set: 1400 mẫu
# Test metric: MAE ≈ 2-3 cm (sai số trung bình)
```

CatBoost:
1. **Tự động phát hiện** tương tác giữa các features (ví dụ: `prcp_24h` × `impervious_ratio`)
2. **Tối ưu** tree ensemble để giảm thiểu lỗi RMSE
3. **Không cần** feature normalization (CatBoost tự xử lý)

#### **Post-Processing (Sau Khi Model Dự Đoán)**

**Vị trí:** `ai_service/main.py` (dòng 157)

```python
# Model.predict() trả về giá trị raw (có thể âm)
raw_depth = model.predict(features)[0]  # Ví dụ: -0.5 hoặc 25.3

# 1. Đảm bảo không âm (vật lý: độ sâu không thể âm)
flood_depth_cm = max(0.0, float(raw_depth))

# 2. Làm tròn đến 2 chữ số thập phân (độ chính xác)
flood_depth_cm = round(flood_depth_cm, 2)

# Kết quả: 0.00, 12.34, 25.80, v.v. (cm)
```

#### **Tầm Giá Trị Dự Kiến**

Dựa trên huấn luyện với 8000 mẫu:

```
Min:     0.0 cm      (Khi không mưa, độ cao cao, xa cống)
Max:   ~100 cm       (Mưa dữ dội 80+ mm, diện tích không thấm 95%, độ cao thấp)
Mean:  ~15-20 cm     (Giá trị trung bình thường gặp)
Std:   ~12 cm        (Độ phân tán)

Phân bố:
- <5 cm:   ~40% mẫu (an toàn)
- 5-20 cm: ~35% mẫu (nguy cơ thấp-vừa)
- 20-50 cm:~20% mẫu (nguy cơ cao)
- >50 cm:  ~5% mẫu (rất nguy hiểm)
```

#### **Ví Dụ Tính Toán Cụ Thể**

**Scenario 1: Không mưa, trời khô**
```
Input features:
- prcp: 0 mm
- prcp_24h: 0 mm
- humidity: 65%
- elevation: 10 m (cao)
- impervious_ratio: 0.6
- dist_drain: 0.5 km

Model predict: raw = -2.0 cm
Post-process: max(0, -2.0) = 0.0 cm
Risk level: "safe"
Binary label: 0 (An toàn)
```

**Scenario 2: Mưa vừa, vùng đô thị**
```
Input features:
- prcp: 25 mm
- prcp_24h: 80 mm (ước tính)
- humidity: 85%
- elevation: 5 m (thấp)
- impervious_ratio: 0.85 (đô thị)
- dist_drain: 0.2 km (gần)

Model predict: raw = 18.5 cm
Post-process: max(0, 18.5) = 18.5 cm
Risk level: "medium" (5-20 cm)
Binary label: 1 (Cảnh báo)
```

**Scenario 3: Mưa dữ dội, vùng trũng**
```
Input features:
- prcp: 45 mm
- prcp_24h: 150 mm (ước tính)
- humidity: 92%
- elevation: 2 m (rất thấp)
- impervious_ratio: 0.9 (khu đô thị kín)
- dist_drain: 1.5 km (xa)

Model predict: raw = 62.3 cm
Post-process: max(0, 62.3) = 62.3 cm
Risk level: "severe" (≥50 cm)
Binary label: 1 (Cảnh báo)
```

#### **Độ Chính Xác & Hạn Chế**

**Độ chính xác:**
- MAE (Mean Absolute Error) ≈ 2-3 cm trên test set
- Có thể sai lệch ±2-3 cm từ thực tế

**Hạn chế:**
- ❌ Model được huấn luyện trên dữ liệu **sinh tổng hợp** (không phải dữ liệu lịch sử thực tế)
- ❌ Không tính đến: tắc nước sông, lịch sử ngập lụt cá nhân tại từng node
- ❌ Không tính đến: độ bão hòa mặt đất, mực nước ngầm
- ⚠️ Sử dụng cho **tham khảo**, không phải tuyệt đối

---

### **Bước 3: Chuyển Đổi Thành Cảnh Báo (Label Mapping)**

**Vị trí code:** `backend/src/utils/labelMapping.js`

#### 🎯 **Risk Level** (4 mức)
```javascript
safe    (✅ Xanh)    → depth_cm < 5      // An toàn
medium  (🟡 Vàng)    → 5 ≤ depth_cm < 20  // Nguy cơ thấp
high    (🟠 Cam)     → 20 ≤ depth_cm < 50 // Nguy cơ cao  
severe  (🔴 Đỏ)      → depth_cm ≥ 50      // Rất nguy hiểm
```

#### 📌 **Binary Label** (cho Frontend)
```javascript
const FLOOD_BINARY_THRESHOLD_CM = 5; // Ngưỡng phân loại (cm)

// Công thức:
label = (depth_cm >= 5) ? 1 : 0

// Hiển thị:
label = 0  → "An toàn"
label = 1  → "Cảnh báo nguy cơ ngập"
```

---

### **Bước 4: Logic Override "No-Rain" (Điều Chỉnh Thực Tế)**

**Vị trí code:** `backend/src/routes/floodPredictionRoutes.js` (dòng ~95-115)

```javascript
// Vấn đề: CatBoost dự đoán dựa vào đặc điểm địa lý (impervious_ratio cao, 
// elevation thấp ở Hà Nội) → có thể dự đoán depth > ngưỡng dù không có mưa

// Giải pháp: Nếu đáp ứng 3 điều kiện → BUỘC label = 0 (An toàn)
if (
  weatherData !== null                    // ✅ Có dữ liệu OWM thực tế
  && prcp === 0                           // ✅ KHÔNG có mưa hiện tại
  && humidity < 90                        // ✅ Độ ẩm < 90% (chỉ báo khô ráo)
) {
  label = 0;          // Buộc an toàn
  floodDepthCm = 0;   // Đặt depth = 0
  warningText = 'An toàn';
  console.log(`Override: AI raw depth=${aiRawDepth}cm, nhưng OWM xác nhận không mưa → An toàn`);
}
```

**Lý do:**
- Hà Nội thường có độ ẩm 80-90% khi khô ráo
- Nếu `prcp=0` & `humidity<90` = điều kiện khô ráo thực sự
- An toàn hơn việc báo "có ngập" khi không có mưa

---

## 🔗 Các Endpoint Chính

### **1. Dự Báo Real-Time (Realtime Prediction)**
```
GET /api/v1/flood-prediction/by-location?lat=21.02&lon=105.83
```

**Luồng:**
1. Lấy thời tiết từ OWM
2. Build features (30 thông số)
3. Gọi AI service
4. Áp dụng logic override "no-rain"
5. Trả kết quả

**Response:**
```json
{
  "success": true,
  "data": {
    "label": 1,                     // 0=An toàn, 1=Cảnh báo
    "warningText": "Cảnh báo nguy cơ ngập",
    "floodDepthCm": 15.5,           // Độ sâu dự đoán
    "weather": {
      "rain1h": 12,
      "humidity": 85,
      "clouds": 80,
      "temp": 28,
      "description": "Mưa vừa"
    },
    "usingLiveWeather": true        // Có dữ liệu thời tiết thực tế
  }
}
```

### **2. Dự Báo Từ Database (Pre-calculated)**
```
GET /api/v1/forecasts/latest?lat=21.02&lon=105.83
```

**Ưu điểm:**
- Dùng kết quả đã được Cronjob tính sẵn (nhanh hơn)
- Lấy từ bảng `flood_predictions` → có field `explanation`
- Không gọi AI real-time

---

## 📊 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenWeatherMap API                        │
│ (Lấy: rain1h, temp, humidity, pressure, windSpeed, clouds)  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│         Build 30 Features (floodPredictionRoutes.js)          │
│ - Thời tiết: 5 features                                      │
│ - Mưa tích lũy: 8 features (tính từ rain1h)                 │
│ - Địa lý: 8 features (từ GridNode DB)                       │
│ - Thời gian: 9 features (hour, month, sin/cos, ...)         │
└─────────────────┬──────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│      CatBoost AI Model (ai_service/main.py)                  │
│  INPUT: 30 features array                                    │
│  OUTPUT: {                                                   │
│    "flood_depth_cm": float,    ← Độ sâu ngập dự đoán       │
│    "risk_level": string        ← safe|medium|high|severe    │
│  }                                                           │
└─────────────────┬──────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│    Label Mapping (labelMapping.js)                           │
│  1. depth_cm → risk_level (4 mức)                           │
│  2. depth_cm → binary label (0 hoặc 1)                      │
│  3. label → warning text (tiếng Việt)                       │
└─────────────────┬──────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│     No-Rain Override (floodPredictionRoutes.js)              │
│  IF (rain=0 && humidity<90%) THEN label=0 (An toàn)        │
└─────────────────┬──────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│             Return to Frontend                               │
│  {                                                           │
│    label, warningText, floodDepthCm,                         │
│    weather, usingLiveWeather, fetchedAt                      │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔧 Tham Số Quan Trọng

| Tham Số | Giá Trị | Ý Nghĩa | Vị Trí |
|---------|--------|---------|--------|
| `FLOOD_BINARY_THRESHOLD_CM` | 5 cm | Ngưỡng phân loại "có ngập" | `labelMapping.js` |
| `NO_RAIN_HUMIDITY_THRESHOLD` | 90 % | Độ ẩm tối đa khi xem là "không mưa" | `floodPredictionRoutes.js` |
| `AI_SERVICE_URL` | `http://localhost:8000` | URL của AI service | `PredictionService.js` |
| `AI_TIMEOUT_MS` | 5000 ms | Timeout khi gọi AI | `PredictionService.js` |
| `rainyMonths` | [5,6,7,8,9,10] | Tháng mùa mưa (Hà Nội) | `floodPredictionRoutes.js` |

---

## 📁 File Chính

| File | Mục Đích |
|------|---------|
| `ai_service/main.py` | CatBoost AI Model, endpoints predict & predict/batch |
| `backend/src/utils/labelMapping.js` | Chuyển đổi depth → risk_level → warning text |
| `backend/src/services/PredictionService.js` | Gọi AI service, lưu kết quả vào DB |
| `backend/src/routes/floodPredictionRoutes.js` | Endpoints dự báo real-time & batch |
| `backend/src/models/FloodPrediction.js` | Model Sequelize lưu flood_predictions |
| `flood-prediction-frontend/.../FloodWarningCard.tsx` | Component hiển thị cảnh báo |

---

## ⚙️ Cách Cấu Hình

### **Thay Đổi Ngưỡng Binary**
```javascript
// File: backend/src/utils/labelMapping.js
const FLOOD_BINARY_THRESHOLD_CM = 5; // Thay số này

// Ví dụ: Nếu muốn depth > 10cm mới báo "cảnh báo"
const FLOOD_BINARY_THRESHOLD_CM = 10;
```

### **Thay Đổi Ngưỡng No-Rain Override**
```javascript
// File: backend/src/routes/floodPredictionRoutes.js
const NO_RAIN_HUMIDITY_THRESHOLD = 90; // Thay số này

// Ví dụ: Nếu muốn humidity < 85% mới override
const NO_RAIN_HUMIDITY_THRESHOLD = 85;
```

### **Thay Đổi Tháng Mùa Mưa**
```javascript
// File: backend/src/routes/floodPredictionRoutes.js
const rainyMonths = [5, 6, 7, 8, 9, 10]; // Thay danh sách tháng
```

---

## 🐛 Troubleshooting

### **Vấn đề: AI dự đoán độ sâu cao dù không có mưa**
- ✅ **Giải pháp:** Kiểm tra logic no-rain override có hoạt động? (Check console logs)
- ✅ **Kiểm tra:** `humidity < NO_RAIN_HUMIDITY_THRESHOLD`?

### **Vấn đề: Cảnh báo không match với thực tế**
- ✅ **Kiểm tra:** Features được build đúng không? (Kiểm tra elevation, slope, impervious_ratio)
- ✅ **Kiểm tra:** Model CatBoost file có bị corrupt không? (Check `ai/catboost_flood_model_final_full_data.cbm`)

### **Vấn đề: AI service không chạy**
- ✅ **Kiểm tra:** `cd ai_service && python main.py` (hoặc `uvicorn main:app`)
- ✅ **Kiểm tra:** GET `http://localhost:8000/health` có trả `{"status": "ok"}`?

---

## 📝 Ghi Chú

- **Model CatBoost** là Regressor (dự đoán giá trị liên tục), **KHÔNG phải Classifier**
- **Feature engineering** rất quan trọng - 30 features được thiết kế dựa trên kinh nghiệm miền lụt
- **No-rain override** là heuristic thực tế để tránh cảnh báo dương tính giả khi không mưa
- **Risk level** (safe/medium/high/severe) dùng cho UI visualization, **binary label** dùng cho logic
