# Tài liệu Đặc tả Cơ sở Dữ liệu (Database Schema)

Tài liệu này mô tả chi tiết toàn bộ cấu trúc cơ sở dữ liệu của hệ thống, bao gồm các bảng, trường dữ liệu, khóa chính, khóa ngoại và các mối quan hệ.

## Mục lục
- [Bảng: `actual_flood_reports`](#actual-flood-reports)
- [Bảng: `flood_predictions`](#flood-predictions)
- [Bảng: `grid_nodes`](#grid-nodes)
- [Bảng: `landslide_grid_nodes`](#landslide-grid-nodes)
- [Bảng: `landslide_predictions`](#landslide-predictions)
- [View: `mv_global_flood_avg`](#mv-global-flood-avg)
- [View: `mv_global_risk_trend`](#mv-global-risk-trend)
- [View: `mv_latest_flood_predictions`](#mv-latest-flood-predictions)
- [Bảng: `system_logs`](#system-logs)
- [Bảng: `users`](#users)
- [Bảng: `weather_measurements`](#weather-measurements)
- [Bảng: `weather_stations`](#weather-stations)

---

## Chi tiết cấu trúc

### Bảng: `actual_flood_reports`

**Khóa chính (Primary Key):** `report_id`

**Khóa ngoại (Foreign Keys) & Mối quan hệ:**
- Trường `user_id` -> tham chiếu tới bảng `users` (trường `user_id`).
- Trường `node_id` -> tham chiếu tới bảng `grid_nodes` (trường `node_id`).

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **report_id 🔑** | `bigint` | ✅ | `unique_rowid()` |
| 2 | **user_id 🔗** | `bigint` |  | `` |
| 3 | **reported_at** | `timestamp with time zone` | ✅ | `now()` |
| 4 | **latitude** | `numeric` |  | `` |
| 5 | **longitude** | `numeric` |  | `` |
| 6 | **geom** | `geometry(point,4326)` |  | `` |
| 7 | **flood_depth_cm** | `numeric` |  | `` |
| 8 | **description** | `text` |  | `` |
| 9 | **image_url** | `text` |  | `` |
| 10 | **verified** | `boolean` |  | `false` |
| 11 | **node_id 🔗** | `bigint` |  | `` |

---

### Bảng: `flood_predictions`

**Khóa chính (Primary Key):** `prediction_id`

**Khóa ngoại (Foreign Keys) & Mối quan hệ:**
- Trường `node_id` -> tham chiếu tới bảng `grid_nodes` (trường `node_id`).

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **prediction_id 🔑** | `bigint` | ✅ | `unique_rowid()` |
| 2 | **node_id 🔗** | `bigint` | ✅ | `` |
| 3 | **time** | `timestamp with time zone` | ✅ | `` |
| 4 | **flood_depth_cm** | `numeric` |  | `` |
| 5 | **target** | `smallint` |  | `` |
| 6 | **risk_level** | `character varying` |  | `` |
| 7 | **explanation** | `text` |  | `` |
| 8 | **date_only** | `date` |  | `` |
| 9 | **month** | `smallint` |  | `` |
| 10 | **hour** | `smallint` |  | `` |
| 11 | **rainy_season_flag** | `boolean` |  | `` |

---

### Bảng: `grid_nodes`

**Khóa chính (Primary Key):** `node_id`

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **node_id 🔑** | `bigint` | ✅ | `` |
| 2 | **latitude** | `numeric` | ✅ | `` |
| 3 | **longitude** | `numeric` | ✅ | `` |
| 4 | **elevation** | `numeric` |  | `` |
| 5 | **slope** | `numeric` |  | `` |
| 6 | **impervious_ratio** | `numeric` |  | `` |
| 7 | **geom** | `geometry(point,4326)` | ✅ | `` |
| 8 | **dist_to_drain_km** | `numeric` |  | `` |
| 9 | **dist_to_river_km** | `numeric` |  | `` |
| 10 | **dist_to_pump_km** | `numeric` |  | `` |
| 11 | **dist_to_main_road_km** | `numeric` |  | `` |
| 12 | **dist_to_park_km** | `numeric` |  | `` |
| 13 | **district_name** | `character varying` |  | `` |
| 14 | **location_name** | `character varying` |  | `` |
| 15 | **grid_id** | `character varying` |  | `` |
| 16 | **weather_station_id** | `bigint` |  | `` |
| 17 | **st1_id** | `double precision` |  | `` |
| 18 | **st1_weight** | `double precision` |  | `` |
| 19 | **st2_id** | `double precision` |  | `` |
| 20 | **st2_weight** | `double precision` |  | `` |
| 21 | **st3_id** | `double precision` |  | `` |
| 22 | **st3_weight** | `double precision` |  | `` |
| 23 | **is_out_of_bounds** | `boolean` | ✅ | `false` |

---

### Bảng: `landslide_grid_nodes`

**Khóa chính (Primary Key):** `node_id`

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **node_id 🔑** | `uuid` | ✅ | `gen_random_uuid()` |
| 2 | **province** | `character varying` |  | `` |
| 3 | **lat** | `double precision` | ✅ | `` |
| 4 | **lon** | `double precision` | ✅ | `` |
| 5 | **elevation** | `double precision` |  | `` |
| 6 | **slope** | `double precision` |  | `` |
| 7 | **aspect** | `double precision` |  | `` |
| 8 | **hillshade** | `double precision` |  | `` |
| 9 | **curvature_plan** | `double precision` |  | `` |
| 10 | **curvature_profile** | `double precision` |  | `` |
| 11 | **tpi** | `double precision` |  | `` |
| 12 | **tri** | `double precision` |  | `` |
| 13 | **roughness** | `double precision` |  | `` |
| 14 | **twi** | `double precision` |  | `` |
| 15 | **dist_to_river_m** | `double precision` |  | `` |
| 16 | **dist_to_road_m** | `double precision` |  | `` |
| 17 | **ndvi** | `double precision` |  | `` |
| 18 | **evi** | `double precision` |  | `` |
| 19 | **ndwi** | `double precision` |  | `` |
| 20 | **bsi** | `double precision` |  | `` |
| 21 | **lulc_class** | `character varying` |  | `` |
| 22 | **location_name** | `character varying` |  | `` |

---

### Bảng: `landslide_predictions`

**Khóa chính (Primary Key):** `id`

**Khóa ngoại (Foreign Keys) & Mối quan hệ:**
- Trường `node_id` -> tham chiếu tới bảng `landslide_grid_nodes` (trường `node_id`).

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **id 🔑** | `uuid` | ✅ | `gen_random_uuid()` |
| 2 | **node_id 🔗** | `uuid` |  | `` |
| 3 | **prediction_time** | `timestamp without time zone` | ✅ | `` |
| 4 | **rain_1d_accum** | `double precision` |  | `` |
| 5 | **rain_3d_accum** | `double precision` |  | `` |
| 6 | **rain_7d_accum** | `double precision` |  | `` |
| 7 | **rain_14d_accum** | `double precision` |  | `` |
| 8 | **rain_30d_accum** | `double precision` |  | `` |
| 9 | **max_rain_1d_in_7d** | `double precision` |  | `` |
| 10 | **max_rain_1d_in_3d** | `double precision` |  | `` |
| 11 | **api_7d** | `double precision` |  | `` |
| 12 | **api_14d** | `double precision` |  | `` |
| 13 | **soil_moisture_1d** | `double precision` |  | `` |
| 14 | **soil_moisture_7d** | `double precision` |  | `` |
| 15 | **slope_x_deforestation** | `double precision` |  | `` |
| 16 | **twi_x_rain7d** | `double precision` |  | `` |
| 17 | **rain_intensity_ratio** | `double precision` |  | `` |
| 18 | **prob_landslide** | `double precision` |  | `` |
| 19 | **risk_level** | `character varying` |  | `` |

---

### View: `mv_global_flood_avg`

**Khóa chính (Primary Key):** `rowid`

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **time** | `timestamp with time zone` |  | `` |
| 2 | **date_only** | `date` |  | `` |
| 3 | **hour** | `smallint` |  | `` |
| 4 | **avg_depth_cm** | `numeric` |  | `` |
| 5 | **node_count** | `bigint` |  | `` |
| 6 | **rowid 🔑** | `bigint` | ✅ | `unique_rowid()` |

---

### View: `mv_global_risk_trend`

**Khóa chính (Primary Key):** `rowid`

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **time** | `timestamp with time zone` |  | `` |
| 2 | **date_only** | `date` |  | `` |
| 3 | **hour** | `smallint` |  | `` |
| 4 | **risk_level** | `character varying` |  | `` |
| 5 | **node_count** | `bigint` |  | `` |
| 6 | **rowid 🔑** | `bigint` | ✅ | `unique_rowid()` |

---

### View: `mv_latest_flood_predictions`

**Khóa chính (Primary Key):** `rowid`

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **prediction_id** | `bigint` |  | `` |
| 2 | **node_id** | `bigint` |  | `` |
| 3 | **time** | `timestamp with time zone` |  | `` |
| 4 | **flood_depth_cm** | `numeric` |  | `` |
| 5 | **risk_level** | `character varying` |  | `` |
| 6 | **explanation** | `text` |  | `` |
| 7 | **date_only** | `date` |  | `` |
| 8 | **month** | `smallint` |  | `` |
| 9 | **hour** | `smallint` |  | `` |
| 10 | **rainy_season_flag** | `boolean` |  | `` |
| 11 | **rowid 🔑** | `bigint` | ✅ | `unique_rowid()` |

---

### Bảng: `system_logs`

**Khóa chính (Primary Key):** `log_id`

**Khóa ngoại (Foreign Keys) & Mối quan hệ:**
- Trường `admin_id` -> tham chiếu tới bảng `users` (trường `user_id`).

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **log_id 🔑** | `bigint` | ✅ | `unique_rowid()` |
| 2 | **admin_id 🔗** | `bigint` |  | `` |
| 3 | **event_type** | `character varying` |  | `` |
| 4 | **event_source** | `character varying` |  | `` |
| 5 | **message** | `text` |  | `` |
| 6 | **timestamp** | `timestamp with time zone` | ✅ | `now()` |

---

### Bảng: `users`

**Khóa chính (Primary Key):** `user_id`

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **user_id 🔑** | `bigint` | ✅ | `unique_rowid()` |
| 2 | **username** | `character varying` | ✅ | `` |
| 3 | **email** | `character varying` | ✅ | `` |
| 4 | **full_name** | `character varying` |  | `` |
| 5 | **password_hash** | `text` | ✅ | `` |
| 6 | **role** | `character varying` | ✅ | `'user'` |
| 7 | **created_at** | `timestamp with time zone` | ✅ | `now()` |
| 8 | **avatar_url** | `character varying` |  | `` |

---

### Bảng: `weather_measurements`

**Khóa chính (Primary Key):** `measurement_id`

**Khóa ngoại (Foreign Keys) & Mối quan hệ:**
- Trường `node_id` -> tham chiếu tới bảng `grid_nodes` (trường `node_id`).

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **measurement_id 🔑** | `bigint` | ✅ | `unique_rowid()` |
| 2 | **node_id 🔗** | `bigint` | ✅ | `` |
| 3 | **time** | `timestamp with time zone` | ✅ | `` |
| 4 | **date_only** | `date` |  | `` |
| 5 | **month** | `smallint` |  | `` |
| 6 | **hour** | `smallint` |  | `` |
| 7 | **rainy_season_flag** | `boolean` |  | `` |
| 8 | **temp** | `numeric` |  | `` |
| 9 | **rhum** | `numeric` |  | `` |
| 10 | **clouds** | `numeric` |  | `` |
| 11 | **prcp** | `numeric` |  | `` |
| 12 | **prcp_3h** | `numeric` |  | `` |
| 13 | **prcp_6h** | `numeric` |  | `` |
| 14 | **prcp_12h** | `numeric` |  | `` |
| 15 | **prcp_24h** | `numeric` |  | `` |
| 16 | **wspd** | `numeric` |  | `` |
| 17 | **wdir** | `numeric` |  | `` |
| 18 | **pres** | `numeric` |  | `` |
| 19 | **pressure_change_24h** | `numeric` |  | `` |
| 20 | **max_prcp_3h** | `numeric` |  | `` |
| 21 | **max_prcp_6h** | `numeric` |  | `` |
| 22 | **max_prcp_12h** | `numeric` |  | `` |
| 23 | **visibility_km** | `numeric` |  | `` |
| 24 | **feels_like_c** | `numeric` |  | `` |

---

### Bảng: `weather_stations`

**Khóa chính (Primary Key):** `id`

**Danh sách các trường (Columns):**

| STT | Tên trường (Column) | Kiểu dữ liệu (Data Type) | Bắt buộc (Not Null) | Giá trị mặc định (Default) |
|---|---|---|:---:|---|
| 1 | **id 🔑** | `bigint` | ✅ | `unique_rowid()` |
| 2 | **name** | `character varying` | ✅ | `` |
| 3 | **latitude** | `numeric` | ✅ | `` |
| 4 | **longitude** | `numeric` | ✅ | `` |
| 5 | **node_count** | `bigint` | ✅ | `0` |
| 6 | **grid_row** | `bigint` |  | `` |
| 7 | **grid_col** | `bigint` |  | `` |
| 8 | **location_name** | `character varying` |  | `` |

---

## Sơ đồ Mối quan hệ giữa các Bảng (Relationships Summary)

Dưới đây là tóm tắt các mối quan hệ (Joins) giữa các bảng dựa trên khóa ngoại:

- **`actual_flood_reports`** liên kết với **`grid_nodes`** thông qua: `actual_flood_reports.node_id = grid_nodes.node_id`
- **`actual_flood_reports`** liên kết với **`users`** thông qua: `actual_flood_reports.user_id = users.user_id`
- **`flood_predictions`** liên kết với **`grid_nodes`** thông qua: `flood_predictions.node_id = grid_nodes.node_id`
- **`landslide_predictions`** liên kết với **`landslide_grid_nodes`** thông qua: `landslide_predictions.node_id = landslide_grid_nodes.node_id`
- **`system_logs`** liên kết với **`users`** thông qua: `system_logs.admin_id = users.user_id`
- **`weather_measurements`** liên kết với **`grid_nodes`** thông qua: `weather_measurements.node_id = grid_nodes.node_id`


*Ghi chú: Các view bắt đầu bằng `mv_` là Materialized Views dùng để tối ưu hóa truy xuất dữ liệu phân tích thống kê.*
