'use strict'

/**
 * floodCache.js – Shared In-Memory Cache Singleton
 * ─────────────────────────────────────────────────────────────────────────────
 * Module này export một object DÙNG CHUNG (singleton) giữa:
 *   - floodPredictionCron.js  → GHI dữ liệu vào cache sau mỗi lần chạy
 *   - unifiedChatbotRoutes.js → ĐỌC dữ liệu từ cache để trả lời nhanh
 *
 * ⚠️  QUY TẮC BẮT BUỘC: LUÔN GHI ĐÈ BẰNG PHÉP GÁN (=), KHÔNG DÙNG .push()
 *
 *  ✅ ĐÚNG:  floodCache.worstAreas = newData      ← ghi đè toàn bộ mảng
 *  ❌ SAI:   floodCache.worstAreas.push(...items)  ← Memory Leak! Dữ liệu cũ
 *                                                     không được GC thu hồi
 *
 * Lý do: Module được require() một lần duy nhất (Node.js module cache).
 * Nếu CronJob chạy mỗi 10 phút và .push() vào mảng, sau 1 ngày sẽ có 144 lần
 * push × N items = bộ nhớ phình to không kiểm soát → OOM crash.
 *
 * TTL logic: Chatbot đọc lastUpdated để biết cache có "tươi" không.
 * Nếu lastUpdated === null hoặc > STALE_THRESHOLD → fallback query DB trực tiếp.
 */

// Ngưỡng cache được coi là "cũ" (ms) — mặc định 20 phút
// CronJob chạy mỗi 10 phút, nên 20 phút là buffer an toàn
const STALE_THRESHOLD_MS = 20 * 60 * 1000

const floodCache = {
    /** Top 5 khu vực nguy cơ cao nhất (HIGH/SEVERE) – cập nhật bởi CronJob */
    worstAreas: [],

    /** Top 10 điểm đo có nguy cơ cao nhất tại thời điểm Cron chạy */
    currentStatus: [],

    /** Tổng hợp số lượng node theo từng risk_level trong 96 giờ tới */
    forecastSummary: [],

    /** Timestamp (Date object) lần Cron cập nhật gần nhất. null = chưa có data. */
    lastUpdated: null,

    /**
     * Kiểm tra cache còn "tươi" không.
     * @returns {boolean}
     */
    isStale() {
        if (!this.lastUpdated) return true
        return (Date.now() - this.lastUpdated.getTime()) > STALE_THRESHOLD_MS
    },

    /**
     * CronJob gọi hàm này để cập nhật toàn bộ cache một lần.
     * Dùng phép gán = thay vì .push() để tránh Memory Leak.
     *
     * @param {{ worstAreas: any[], currentStatus: any[], forecastSummary: any[] }} payload
     */
    update(payload) {
        // Ghi đè hoàn toàn – KHÔNG .push()
        this.worstAreas     = Array.isArray(payload.worstAreas)     ? payload.worstAreas     : []
        this.currentStatus  = Array.isArray(payload.currentStatus)  ? payload.currentStatus  : []
        this.forecastSummary = Array.isArray(payload.forecastSummary) ? payload.forecastSummary : []
        this.lastUpdated    = new Date()
        console.log(
            `[FloodCache] ✅ Cache đã cập nhật lúc ${this.lastUpdated.toISOString()} ` +
            `– worstAreas:${this.worstAreas.length}, currentStatus:${this.currentStatus.length}, ` +
            `forecastSummary:${this.forecastSummary.length}`
        )
    },
}

module.exports = floodCache
