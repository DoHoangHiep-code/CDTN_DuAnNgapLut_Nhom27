'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Extensions
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis;')
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS timescaledb;')

    // Enums
    await queryInterface.sequelize.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN CREATE TYPE user_role AS ENUM ('admin','expert','user'); END IF; END $$;",
    )
    await queryInterface.sequelize.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level') THEN CREATE TYPE risk_level AS ENUM ('safe','medium','high','severe'); END IF; END $$;",
    )
    await queryInterface.sequelize.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reported_level') THEN CREATE TYPE reported_level AS ENUM ('Khô ráo','<20cm','>50cm'); END IF; END $$;",
    )

    // users
    await queryInterface.createTable('users', {
      user_id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      username: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      full_name: { type: Sequelize.STRING(255), allowNull: false },
      avatar_url: { type: Sequelize.STRING(255), allowNull: true },
      role: { type: 'user_role', allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    })

    // grid_nodes (spatial)
    await queryInterface.createTable('grid_nodes', {
      node_id: { type: Sequelize.BIGINT, primaryKey: true, allowNull: false },
      latitude: { type: Sequelize.DECIMAL(9, 6), allowNull: false },
      longitude: { type: Sequelize.DECIMAL(9, 6), allowNull: false },
      elevation: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
      slope: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
      impervious_ratio: { type: Sequelize.DECIMAL(4, 3), allowNull: false },
      geom: { type: Sequelize.GEOMETRY('POINT', 4326), allowNull: false },
    })
    await queryInterface.addIndex('grid_nodes', {
      fields: ['geom'],
      using: 'gist',
      name: 'idx_grid_nodes_geom_gist',
    })

    // weather_measurements (timeseries)
    await queryInterface.createTable('weather_measurements', {
      measurement_id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      node_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'grid_nodes', key: 'node_id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      time: { type: Sequelize.DATE, allowNull: false },
      temp: { type: Sequelize.DECIMAL, allowNull: true },
      rhum: { type: Sequelize.DECIMAL, allowNull: true },
      prcp: { type: Sequelize.DECIMAL, allowNull: true },
      prcp_3h: { type: Sequelize.DECIMAL, allowNull: true },
      prcp_24h: { type: Sequelize.DECIMAL, allowNull: true },
      wspd: { type: Sequelize.DECIMAL, allowNull: true },
    })
    await queryInterface.addIndex('weather_measurements', { fields: ['node_id', 'time'], name: 'idx_weather_node_time' })

    // flood_predictions (timeseries)
    await queryInterface.createTable('flood_predictions', {
      prediction_id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      node_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'grid_nodes', key: 'node_id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      time: { type: Sequelize.DATE, allowNull: false },
      flood_depth_cm: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
      risk_level: { type: 'risk_level', allowNull: false },
    })
    await queryInterface.addIndex('flood_predictions', { fields: ['node_id', 'time'], name: 'idx_floodpred_node_time' })

    // actual_flood_reports (spatial)
    await queryInterface.createTable('actual_flood_reports', {
      report_id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'user_id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      latitude: { type: Sequelize.DECIMAL(9, 6), allowNull: false },
      longitude: { type: Sequelize.DECIMAL(9, 6), allowNull: false },
      geom: { type: Sequelize.GEOMETRY('POINT', 4326), allowNull: false },
      reported_level: { type: 'reported_level', allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    })
    await queryInterface.addIndex('actual_flood_reports', {
      fields: ['geom'],
      using: 'gist',
      name: 'idx_actual_flood_reports_geom_gist',
    })

    // system_logs
    await queryInterface.createTable('system_logs', {
      log_id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      admin_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'user_id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      event_type: { type: Sequelize.STRING(100), allowNull: false },
      event_source: { type: Sequelize.STRING(255), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      timestamp: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('system_logs')
    await queryInterface.dropTable('actual_flood_reports')
    await queryInterface.dropTable('flood_predictions')
    await queryInterface.dropTable('weather_measurements')
    await queryInterface.dropTable('grid_nodes')
    await queryInterface.dropTable('users')

    await queryInterface.sequelize.query("DROP TYPE IF EXISTS reported_level;")
    await queryInterface.sequelize.query("DROP TYPE IF EXISTS risk_level;")
    await queryInterface.sequelize.query("DROP TYPE IF EXISTS user_role;")
  },
}

