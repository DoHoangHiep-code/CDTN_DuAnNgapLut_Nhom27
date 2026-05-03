# Cronjob Prediction Upsert Strategy

## 📋 Overview

Cronjob mỗi 6 tiếng chạy một lần (0h, 6h, 12h, 18h ICT) để dự báo ngập lụt cho toàn bộ grid nodes. Trước đây, nó **ghi đè toàn bộ** dữ liệu cũ mỗi lần chạy, làm mất các dự báo dài hạn có giá trị. 

Bây giờ, bạn có thể **chọn strategy** để điều khiển cách upsert predictions:

## 🎯 Available Strategies

### 1. **`UPDATE_RECENT_ONLY`** (Mặc định + Khuyên dùng)

**Mô tả:**
- UPDATE predictions trong window 6-12 tiếng tới
- INSERT predictions > 12 tiếng
- SKIP predictions quá khứ

**Tại sao?**
- ✅ Giữ nguyên dự báo dài hạn (> 12 tiếng)
- ✅ Cập nhật gần-hạn (6-12 tiếng) khi dữ liệu thời tiết mới xuất hiện
- ✅ Tránh invalid past predictions

**Khi nào dùng?**
- Hầu hết các trường hợp normal operation
- Khi bạn muốn cân bằng giữa cập nhật gần-hạn và bảo vệ dự báo dài hạn

**Ví dụ Timeline:**
```
Now = 2026-05-05 06:00 UTC
├─ 00:00-05:00 (Quá khứ) → SKIP
├─ 12:00-18:00 (6-12h tới) → UPDATE (nếu có dữ liệu mới)
├─ 18:00-23:59 (12h+) → INSERT ONLY (bảo vệ từ cronjob trước)
└─ Ngày mai + → INSERT ONLY
```

### 2. **`INSERT_ONLY`**

**Mô tả:**
- Chỉ INSERT records mới
- KHÔNG UPDATE bất kỳ record cũ nào
- Tương đương với `ignoreDuplicates: true` cho toàn bộ

**Tại sao?**
- Bảo vệ 100% dữ liệu cũ
- Dữ liệu mới từ cronjob không bao giờ ghi đè

**Khi nào dùng?**
- Khi bạn muốn giữ nguyên tất cả dự báo cũ
- Để test/debug (không thay đổi dữ liệu hiện tại)
- Recovery scenario: khi bạn vô tình chạy cronjob sai

**Hạn chế:**
- Dữ liệu thời tiết mới từ OWM không được phản ánh trong predictions gần-hạn
- Predictions có thể trở cũ nếu thời tiết thay đổi đáng kể

### 3. **`FULL_UPDATE`** (Hành vi cũ)

**Mô tả:**
- UPDATE toàn bộ records (nếu duplicate)
- Ghi đè 100% dữ liệu cũ

**Tại sao tránh?**
- ❌ Mất các dự báo có giá trị từ cronjob trước
- ❌ Chỉ hữu ích khi bạn muốn làm mới toàn bộ (rare)

**Khi nào dùng?**
- Một lần khi bạn muốn purge và rebuild toàn bộ dataset

---

## 🔧 Cách Config

### A. Environment Variable (Khuyên dùng)

**File: `.env`**
```bash
# Mặc định: UPDATE_RECENT_ONLY
PREDICTION_UPSERT_STRATEGY=UPDATE_RECENT_ONLY

# Hoặc các lựa chọn khác:
# PREDICTION_UPSERT_STRATEGY=INSERT_ONLY
# PREDICTION_UPSERT_STRATEGY=FULL_UPDATE
```

**Restart Backend:**
```bash
npm start
# hoặc
pm2 restart app
```

### B. Docker Compose

**File: `docker-compose.yml`**
```yaml
services:
  backend:
    environment:
      - PREDICTION_UPSERT_STRATEGY=UPDATE_RECENT_ONLY
      - AI_SERVICE_URL=http://ai-service:8000
```

### C. Code (Direct - Không khuyên dùng cho production)

File: `src/services/weatherCron.js` tại line ~60:
```javascript
const PREDICTION_UPSERT_STRATEGY = process.env.PREDICTION_UPSERT_STRATEGY || 'UPDATE_RECENT_ONLY'
```

---

## 📊 Behavior Comparison

| Scenario | UPDATE_RECENT_ONLY | INSERT_ONLY | FULL_UPDATE |
|----------|-------------------|------------|------------|
| Past predictions (< now) | ⏭️ Skip | ➖ Ignore | ⚠️ Update |
| Recent (6-12h) | ✏️ Update | ➖ Ignore | ✏️ Update |
| Future (> 12h) | ➕ Insert | ➖ Ignore | ✏️ Update |
| Old data preserved? | ✅ Mostly | ✅ 100% | ❌ No |
| Recent updates? | ✅ Yes | ❌ No | ✅ Yes |

---

## 🚀 Time Windows (UPDATE_RECENT_ONLY)

**Calculation (UTC + milliseconds):**
```javascript
const now = new Date()
const recentWindowStart = new Date(now.getTime() + 6 * 3600 * 1000)  // +6 hours
const recentWindowEnd = new Date(now.getTime() + 12 * 3600 * 1000)   // +12 hours

// Classification:
if (recTime < now) → SKIP (past)
else if (recTime >= recentWindowStart && recTime <= recentWindowEnd) → UPDATE
else → INSERT (future beyond 12h)
```

---

## 📝 Logs

**Khởi động:**
```
[WeatherCron] 📋 Config:
  • Upsert Strategy : UPDATE_RECENT_ONLY
  • Node Batch Size : 50
  • AI Timeout      : 10000ms
[WeatherCron] ✅ Đã đăng ký cron schedule: mỗi 6 tiếng...
```

**Mỗi lần chạy:**
```
[WeatherCron] Cron trigger tự động...
...
[WeatherCron] 🏁 Hoàn thành sau 45.2s
  API nguồn          : OpenWeatherMap /data/2.5/forecast
  Trạm fetch OK      : 8/8
  Nodes xử lý        : 7,852
  flood_predictions  : 312,080 bản ghi
  weather_measurements: 320 bản ghi
  Upsert Strategy    : UPDATE_RECENT_ONLY
```

---

## 🔍 Validation Queries

**Kiểm tra strategy được sử dụng:**
```bash
# Check logs (nếu backend vừa start)
npm start | grep "Upsert Strategy"
```

**Kiểm tra dữ liệu trong database:**
```sql
-- Xem predictions có ghi đè không
SELECT 
  COUNT(*) as total_predictions,
  MIN(time) as oldest_prediction,
  MAX(time) as newest_prediction,
  COUNT(DISTINCT node_id) as unique_nodes
FROM flood_predictions;

-- Xem distribution theo thời gian
SELECT 
  DATE_TRUNC('day', time) as day,
  COUNT(*) as count
FROM flood_predictions
ORDER BY day DESC
LIMIT 10;
```

---

## 💡 Recommendations

### Normal Operation
```bash
PREDICTION_UPSERT_STRATEGY=UPDATE_RECENT_ONLY
```
✅ Balanced approach, recommended

### Data Integrity Testing
```bash
PREDICTION_UPSERT_STRATEGY=INSERT_ONLY
```
✅ Nghiên cứu impact của new weather data mà không xóa cũ

### One-time Rebuild
```bash
# Xóa old data trước
npm run clear-predictions

# Chạy cronjob
PREDICTION_UPSERT_STRATEGY=FULL_UPDATE npm start

# Sau khi chạy xong, restore:
PREDICTION_UPSERT_STRATEGY=UPDATE_RECENT_ONLY npm start
```

---

## 🐛 Troubleshooting

**Q: Làm sao để biết cronjob chạy thành công?**
A: Kiểm tra logs:
```bash
tail -f logs/backend.log | grep "[WeatherCron]"
```

**Q: Làm sao để trigger cronjob ngay bây giờ?**
A: Gọi manual trigger endpoint:
```bash
curl -X GET http://localhost:3001/api/v1/cron/trigger
```

**Q: Có thể thay đổi strategy mà không restart server không?**
A: Không, bạn phải restart backend. Strategy được đọc từ env khi server khởi động.

**Q: Làm sao để biết predictions bị ghi đè hay không?**
A: Lấy predictions trước và sau cronjob:
```bash
# Trước
curl "http://localhost:3001/api/v1/flood-prediction/bbox?minLat=20.8&maxLat=21.1&minLng=105.7&maxLng=106.1" > before.json

# Chạy cronjob
curl -X GET http://localhost:3001/api/v1/cron/trigger

# Sau
curl "http://localhost:3001/api/v1/flood-prediction/bbox?minLat=20.8&maxLat=21.1&minLng=105.7&maxLng=106.1" > after.json

# So sánh
diff before.json after.json
```

---

## 📚 Related Files

- [weatherCron.js](../src/services/weatherCron.js) - Main cronjob service
- [PREDICTION_SYNC.md](./PREDICTION_SYNC.md) - Gap detection & filling
- [.env.example](../.env.example) - Environment variables template
