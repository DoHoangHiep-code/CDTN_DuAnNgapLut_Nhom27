const express = require('express')
const { verifyToken, isAdmin } = require('../common/middlewares/auth.middleware')
const { SystemLogController } = require('../controllers/SystemLogController')

const router = express.Router()
const controller = new SystemLogController()

// Endpoint for fetching system logs (Admin only)
router.get('/system-logs', verifyToken, isAdmin, controller.list)

module.exports = { systemLogRouter: router }
