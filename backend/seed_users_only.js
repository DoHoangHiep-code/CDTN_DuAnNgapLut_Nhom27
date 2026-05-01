const bcrypt = require('bcryptjs')
const { sequelize } = require('./src/db/sequelize')
const { User } = require('./src/models')

async function seedUsersOnly() {
  try {
    await sequelize.authenticate()
    console.log('DB connected.')

    const adminHash = await bcrypt.hash('Admin@123', 10)
    const expertHash = await bcrypt.hash('Expert@123', 10)
    const userHash = await bcrypt.hash('User@123', 10)

    const users = await User.bulkCreate(
      [
        {
          username: 'admin',
          password_hash: adminHash,
          email: 'admin@fps.local',
          full_name: 'Admin User',
          avatar_url: null,
          role: 'admin',
        },
        {
          username: 'expert',
          password_hash: expertHash,
          email: 'expert@fps.local',
          full_name: 'Flood Expert',
          avatar_url: null,
          role: 'expert',
        },
        {
          username: 'user',
          password_hash: userHash,
          email: 'user@fps.local',
          full_name: 'Standard User',
          avatar_url: null,
          role: 'user',
        },
      ],
      { updateOnDuplicate: ['password_hash', 'email', 'full_name', 'role'], returning: true },
    )
    console.log('Seeded users successfully!', users.length)
  } catch (err) {
    console.error('Error seeding users:', err)
  } finally {
    process.exit()
  }
}

seedUsersOnly()
