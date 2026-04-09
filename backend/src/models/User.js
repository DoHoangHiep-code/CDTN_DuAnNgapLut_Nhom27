const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      user_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      username: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      full_name: { type: DataTypes.STRING(255), allowNull: false },
      avatar_url: { type: DataTypes.STRING(255), allowNull: true },
      role: { type: DataTypes.ENUM('admin', 'expert', 'user'), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'users',
      timestamps: false,
      underscored: true,
    },
  )

  return User
}

