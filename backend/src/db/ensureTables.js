'use strict'

/**
 * ensureTables.js – Tự động kiểm tra và tạo các bảng thiếu khi khởi động
 * ─────────────────────────────────────────────────────────────────────────
 * Chạy trước khi Cronjobs bắt đầu, đảm bảo các bảng cần thiết tồn tại.
 * Nếu bảng đã có → bỏ qua (dùng IF NOT EXISTS).
 */

const { sequelize } = require('./sequelize')

async function ensureTables() {
  console.log('[EnsureTables] Kiểm tra và tạo bảng thiếu nếu cần...')

  try {
    // ── 1. Enum risk_level ──────────────────────────────────────────────────
    try {
      await sequelize.query(`CREATE TYPE risk_level AS ENUM ('safe', 'medium', 'high', 'severe');`)
    } catch (_) {
      // Enum đã tồn tại → bỏ qua
    }

    // ── 2. flood_predictions ────────────────────────────────────────────────
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS flood_predictions (
        prediction_id   BIGSERIAL     PRIMARY KEY,
        node_id         BIGINT        NOT NULL,
        time            TIMESTAMPTZ   NOT NULL,
        flood_depth_cm  DECIMAL(6,2)  NOT NULL,
        target          INT           NOT NULL DEFAULT 0,
        risk_level      TEXT          NOT NULL DEFAULT 'safe',
        explanation     TEXT,
        date_only       DATE,
        month           INT,
        hour            INT,
        rainy_season_flag BOOLEAN,
        location_name   VARCHAR(512)
      );
    `)

    // ── 3. Unique constraint cho ON CONFLICT upsert ─────────────────────────
    try {
      await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_floodpred_node_time
          ON flood_predictions (node_id, time);
      `)
    } catch (_) {
      // Index đã tồn tại → bỏ qua
    }

    // ── 3.5. Bảng weather_measurements ──────────────────────────────────────
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS weather_measurements (
        measurement_id BIGSERIAL PRIMARY KEY,
        node_id BIGINT NOT NULL,
        time TIMESTAMPTZ NOT NULL,
        temp DECIMAL(5,2), rhum DECIMAL(5,2), prcp DECIMAL(6,2),
        prcp_3h DECIMAL(6,2), prcp_6h DECIMAL(6,2), prcp_12h DECIMAL(6,2), prcp_24h DECIMAL(6,2),
        wspd DECIMAL(5,2), wdir DECIMAL(5,2), pres DECIMAL(6,2),
        clouds INT, date_only DATE, visibility_km DECIMAL(6,2), feels_like_c DECIMAL(5,2),
        month INT, hour INT, rainy_season_flag BOOLEAN,
        pressure_change_24h DECIMAL(6,2), max_prcp_3h DECIMAL(6,2), max_prcp_6h DECIMAL(6,2), max_prcp_12h DECIMAL(6,2),
        location_name VARCHAR(512)
      );
    `)
    try {
      await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_node_time
          ON weather_measurements (node_id, time);
      `)
    } catch (_) {}

    // ── 4. Performance indexes ──────────────────────────────────────────────
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_floodpred_date_only ON flood_predictions (date_only);`,
      `CREATE INDEX IF NOT EXISTS idx_floodpred_month     ON flood_predictions (month);`,
      `CREATE INDEX IF NOT EXISTS idx_floodpred_risk      ON flood_predictions (risk_level);`,
      `CREATE INDEX IF NOT EXISTS idx_flood_predictions_node_time ON flood_predictions (node_id, time DESC);`,
    ]
    for (const sql of indexes) {
      try { await sequelize.query(sql) } catch (_) { /* index đã tồn tại */ }
    }

    // ── 5. Enum enum_users_role (cho bảng users) ────────────────────────────
    try {
      await sequelize.query(`CREATE TYPE enum_users_role AS ENUM ('admin', 'expert', 'user');`)
    } catch (_) {}

    // ── 6. Bảng users ───────────────────────────────────────────────────────
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id       BIGSERIAL PRIMARY KEY,
        username      VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        email         VARCHAR(255) NOT NULL UNIQUE,
        full_name     VARCHAR(255) NOT NULL,
        avatar_url    VARCHAR(255),
        role          enum_users_role NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    console.log('[EnsureTables] ✅ Bảng flood_predictions và users đã sẵn sàng.')
  } catch (err) {
    console.error('[EnsureTables] ❌ Lỗi khi tạo bảng:', err.message)
    // Không throw → server vẫn chạy, chỉ cron sẽ lỗi (dễ debug hơn crash toàn bộ)
  }
}

module.exports = { ensureTables }
