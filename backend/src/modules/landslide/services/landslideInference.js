'use strict'

/**
 * ============================================================
 * landslideInference.js — Core AI Inference Service (ML v7)
 * ============================================================
 * Chạy mô hình ONNX dự báo Sạt lở đất trực tiếp trên Node.js
 * mà không cần Python server trung gian.
 *
 * Kiến trúc Singleton: model và metadata chỉ được load 1 lần
 * khi `initLandslideModel()` được gọi lúc server bootstrap.
 * Mọi request sau đó dùng lại session đã sẵn sàng trong RAM.
 * ============================================================
 */

const ort  = require('onnxruntime-node')
const fs   = require('fs')
const path = require('path')

// ── Đường dẫn Model & Metadata (tuyệt đối, tính từ CWD của server) ──────────
const MODEL_DIR      = path.join(__dirname, '..', 'models')
const MODEL_PATH     = path.join(MODEL_DIR, 'landslide_model.onnx')
const METADATA_PATH  = path.join(MODEL_DIR, 'landslide_metadata.json')

// ── Singleton state ────────────────────────────────────────────
/** @type {ort.InferenceSession | null} */
let session          = null
/** @type {string[]}  Tên 16 feature theo đúng thứ tự model expect */
let feature_names    = []
/** @type {Record<string, number>} Giá trị median dùng khi impute null/NaN (optional) */
let median_values    = {}
/** @type {number}  Ngưỡng probability phân loại nhị phân */
let optimal_threshold = 0.5
/** @type {string}  Tên input node của ONNX graph (lấy từ metadata.input.name) */
let onnx_input_name  = 'float_input'

// ── Mapping ngưỡng rủi ro ────────────────────────────────────────────────────
const RISK_LEVELS = {
  SAFE:    { label: 'SAFE',    vi: 'An toàn',      min: 0,    max: 0.35 },
  WARNING: { label: 'WARNING', vi: 'Cảnh báo',     min: 0.35, max: 0.65 },
  DANGER:  { label: 'DANGER',  vi: 'Nguy hiểm',    min: 0.65, max: 1.01 },
}

/**
 * Phân loại rủi ro dựa vào xác suất.
 * WARNING band được định nghĩa quanh optimal_threshold ±15%.
 *
 * @param {number} probability
 * @returns {'SAFE' | 'WARNING' | 'DANGER'}
 */
function classifyRisk(probability) {
  const low  = Math.max(0,    optimal_threshold - 0.15)
  const high = Math.min(1.01, optimal_threshold + 0.15)

  if (probability >= high)      return 'DANGER'
  if (probability >= low)       return 'WARNING'
  return 'SAFE'
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. KHỞI TẠO (gọi 1 lần khi server start)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load ONNX session và metadata vào bộ nhớ.
 * Phải `await` trước khi xử lý bất kỳ request nào.
 *
 * @returns {Promise<void>}
 */
async function initLandslideModel() {
  // ── Kiểm tra file tồn tại ──────────────────────────────────────────────────
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error(
      `[LandslideInference] Không tìm thấy model: ${MODEL_PATH}\n` +
      `  → Copy file landslide_model.onnx vào thư mục src/modules/landslide/models/`
    )
  }
  if (!fs.existsSync(METADATA_PATH)) {
    throw new Error(
      `[LandslideInference] Không tìm thấy metadata: ${METADATA_PATH}\n` +
      `  → Copy file landslide_metadata.json vào thư mục src/modules/landslide/models/`
    )
  }

  // ── Parse metadata ───────────────────────────────────────────
  const raw = fs.readFileSync(METADATA_PATH, 'utf-8')
  const meta = JSON.parse(raw)

  // Hỗ trợ cả 2 cấu trúc JSON:
  //   Cấu trúc mới (ML v7): meta.input.feature_names + meta.threshold.optimal
  //   Cấu trúc cũ:            meta.feature_names + meta.optimal_threshold
  feature_names     = meta?.input?.feature_names ?? meta?.feature_names ?? []
  optimal_threshold = meta?.threshold?.optimal   ?? meta?.optimal_threshold ?? 0.5
  median_values     = meta?.median_values        ?? {}
  onnx_input_name   = meta?.input?.name          ?? 'float_input'

  if (!Array.isArray(feature_names) || feature_names.length === 0) {
    throw new Error('[LandslideInference] metadata: feature_names bị thiếu hoặc rỗng.')
  }

  // ── Khởi tạo ONNX InferenceSession (tốn ~100-500ms lần đầu) ───────────
  session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'], // Node.js server dùng CPU, không cần GPU
    graphOptimizationLevel: 'all',
  })

  console.log(
    `[LandslideInference] ✅ Model loaded: ${feature_names.length} features | threshold=${optimal_threshold} | input='${onnx_input_name}'`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BƯỚC 1 — Tính đặc trưng tương tác (Interaction Features)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bổ sung các đặc trưng tương tác bắt buộc vào object raw feature trước khi
 * đưa vào pipeline. Hai biến này metadata ghi rõ là đã có sẵn trong ONNX
 * (baked-in via ColumnTransformer), nhưng ta vẫn tính để truyền đúng index.
 *
 * Theo metadata.interactions_baked:
 *   slope_x_api7d = slope (col 0) × api_7d (col 5)
 *   twi_x_soil    = twi   (col 1) × soil_moisture_1d (col 8)
 *
 * @param {Record<string, number | undefined | null>} rawFeatures — object feature thô
 * @returns {Record<string, number | undefined | null>}
 */
function addInteractionFeatures(rawFeatures) {
  // ML v7: các biến tương tác đã bạke trong ONNX.
  // Vẫn tính để giữ API ổn định với các caller.
  rawFeatures.slope_x_api7d = (rawFeatures.slope ?? 0) * (rawFeatures.api_7d ?? 0)
  rawFeatures.twi_x_soil    = (rawFeatures.twi   ?? 0) * (rawFeatures.soil_moisture_1d ?? 0)
  return rawFeatures
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. BƯỚC 2 — Lấp lỗ hổng dữ liệu (Median Imputation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Impute null/NaN bằng median hoặc 0 nếu median không có trong metadata.
 * ML v7 ONNX xử lý NaN nội bộ, nhưng ta vẫn impute để an toàn hơn.
 *
 * Lưu ý: nếu là thiếu trường hợp feature không có tên trong feature_names
 * thì dùng NaN (ONNX sẽ impute). Nếu feature tồn tại nhưng null thì dùng 0.
 *
 * @param {Record<string, number | undefined | null>} features
 * @returns {Record<string, number>}
 */
function applyImputer(features) {
  const result = {}
  
  // Danh sách các biến tĩnh địa lý không bao giờ = 0 tuyệt đối ở sườn đồi
  const geoFeatures = [
    'elevation', 'slope', 'aspect', 'hillshade', 'curvature_plan', 'curvature_profile', 
    'tpi', 'tri', 'roughness', 'twi', 'ndvi', 'evi', 'ndwi', 'bsi'
  ]

  for (const name of feature_names) {
    let val = features[name]
    
    // Invalid nếu là null/undefined/NaN HOẶC là biến geo và mang giá trị 0
    const isInvalid = val === undefined || val === null || (typeof val === 'number' && isNaN(val)) || (geoFeatures.includes(name) && val === 0)
    
    if (isInvalid) {
      const median = median_values[name]
      // Nếu có median → dùng median. Nếu không → NaN (ONNX bên trong xử lý)
      val = (median !== undefined && median !== null && !isNaN(median)) ? median : NaN
    }
    result[name] = Number(val)
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. BƯỚC 3 + 4 — Chạy Model & Phân loại kết quả
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pipeline hoàn chỉnh: nhận dữ liệu thô → trả kết quả dự báo.
 *
 * Luồng xử lý:
 *   rawFeatures
 *     → addInteractionFeatures()         [Bước 1: thêm slope_x_api7d, twi_x_soil]
 *     → applyImputer()                   [Bước 2: fill null/NaN bằng median]
 *     → Float32Array → ONNX Tensor       [Bước 3: ép kiểu, tensor hóa]
 *     → session.run()                    [Bước 3: inference]
 *     → classifyRisk()                   [Bước 4: phân loại nguy cơ]
 *
 * @param {Record<string, number | undefined | null>} rawFeatures
 * @returns {Promise<{
 *   is_landslide: boolean,
 *   probability: number,
 *   risk_level: 'SAFE' | 'WARNING' | 'DANGER',
 *   risk_level_vi: string,
 *   threshold_used: number,
 *   features_used: Record<string, number>
 * }>}
 */
async function predictLandslide(rawFeatures) {
  if (!session) {
    throw new Error(
      '[LandslideInference] Model chưa được khởi tạo. ' +
      'Gọi await initLandslideModel() khi server bootstrap.'
    )
  }

  // Bước 1: Tính interaction features
  const featuresWithInteraction = addInteractionFeatures({ ...rawFeatures })

  // Bước 2: Impute null/NaN
  const cleanFeatures = applyImputer(featuresWithInteraction)

  // Bước 3: Ánh xạ object → Float32Array theo đúng thứ tự feature_names
  const inputArray = new Float32Array(feature_names.map((name) => cleanFeatures[name]))

  // Tạo ONNX Tensor: shape [1, n_features] — 1 sample, n cột
  const n = feature_names.length
  const tensor = new ort.Tensor('float32', inputArray, [1, n])

  // Dùng tên input node từ metadata (tránh hardcode 'float_input')
  // Session.inputNames là source of truth thực sự
  const inputName = onnx_input_name || session.inputNames[0]
  const feeds = { [inputName]: tensor }

  // Gọi inference
  const results = await session.run(feeds)

  // Đọc xác suất từ output
  // ONNX sklearn thường xuất 2 outputs: "label" và "probabilities"
  // Ta cần output xác suất class=1
  let probability = 0.5

  const outputNames = session.outputNames
  // Tìm output chứa probability (thường tên "probabilities" hoặc "output_probability")
  const probOutputName = outputNames.find((n) =>
    n.toLowerCase().includes('prob')
  ) || outputNames[outputNames.length - 1]

  const probOutput = results[probOutputName]
  if (probOutput && probOutput.data) {
    const data = probOutput.data
    // Shape [1, 2] → data = [prob_class0, prob_class1]
    // Shape [1]    → data = [prob_class1]
    if (data.length >= 2) {
      probability = Number(data[1]) // xác suất của class 1 (sạt lở)
    } else {
      probability = Number(data[0])
    }
  }

  // Bước 4: Phân loại
  const risk_level    = classifyRisk(probability)
  const is_landslide  = probability >= optimal_threshold
  const riskMeta      = Object.values(RISK_LEVELS).find((r) => r.label === risk_level)

  return {
    is_landslide,
    probability: Math.round(probability * 10000) / 10000, // 4 chữ số thập phân
    risk_level,
    risk_level_vi: riskMeta?.vi ?? risk_level,
    threshold_used: optimal_threshold,
    features_used: cleanFeatures,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. HEALTH CHECK — Kiểm tra trạng thái model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trả về thông tin trạng thái của inference engine.
 * Dùng cho endpoint /health hoặc debug.
 *
 * @returns {{ loaded: boolean, feature_count: number, threshold: number, model_path: string }}
 */
function getModelStatus() {
  return {
    loaded:        session !== null,
    feature_count: feature_names.length,
    threshold:     optimal_threshold,
    model_path:    MODEL_PATH,
    metadata_path: METADATA_PATH,
  }
}

module.exports = {
  initLandslideModel,
  predictLandslide,
  addInteractionFeatures,
  applyImputer,
  getModelStatus,
}
