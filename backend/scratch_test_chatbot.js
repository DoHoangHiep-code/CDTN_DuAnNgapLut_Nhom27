/**
 * scratch_test_chatbot.js
 * Chạy test in-process cho chatbot ask router để xác thực nhận diện intent và format dữ liệu.
 */
require('dotenv').config()

const { unifiedChatbotRouter } = require('./src/routes/unifiedChatbotRoutes.js')

// Hàm helper để giả lập req, res và gọi route handler
function mockAsk(message, domain = null) {
    return new Promise((resolve) => {
        const req = {
            body: { message, domain }
        }
        const res = {
            status: function(code) {
                this.statusCode = code
                return this
            },
            json: function(data) {
                resolve({ statusCode: this.statusCode || 200, data })
            }
        }
        
        // Tìm handler của POST /chatbot/ask
        const layer = unifiedChatbotRouter.stack.find(l => l.route && l.route.path === '/chatbot/ask' && l.route.methods.post)
        if (!layer) {
            resolve({ error: 'Route /chatbot/ask not found' })
            return
        }
        
        // Gọi handler
        const handler = layer.route.stack[0].handle
        handler(req, res).catch(err => {
            resolve({ error: err.message })
        })
    })
}

async function runTests() {
    const testCases = [
        { name: 'Top 10 ngập lụt', query: 'Hãy liệt kê top 10 các điểm có khả năng ngập lụt cao nhất', domain: 'flood' },
        { name: 'Ngập lụt 3 giờ tới', query: 'Xem những vùng có khả năng ngập lụt trong 3 giờ tới', domain: 'flood' },
        { name: 'Sạt lở 6 giờ tới', query: 'Xem những vùng có khả năng sạt lở trong 6 giờ tới', domain: 'landslide' },
        { name: 'Ngập lụt Triều Khúc 3 giờ tới', query: 'Triều Khúc ngập lụt thế nào trong 3 giờ tới', domain: 'flood' },
        { name: 'Sạt lở Sơn La trong 1,2,3,6h', query: 'Dự báo sạt lở ở Sơn La trong 1,2,3,6 giờ tới', domain: 'landslide' }
    ]

    console.log('🤖 Bắt đầu chạy test in-process cho Chatbot...\n')
    for (const tc of testCases) {
        console.log(`========================================`)
        console.log(`🧪 Testcase: ${tc.name}`)
        console.log(`💬 Câu hỏi: "${tc.query}"`)
        console.log(`========================================`)
        
        const result = await mockAsk(tc.query, tc.domain)
        if (result.error) {
            console.error(`❌ Lỗi thực thi:`, result.error)
        } else {
            console.log(`HTTP Status: ${result.statusCode}`)
            console.log(`Intent nhận diện: ${result.data.intent}`)
            console.log(`Khu vực trích xuất: ${result.data.area || 'Không có'}`)
            console.log(`Trả lời của Bot:\n`)
            console.log(result.data.reply)
            console.log(`Expert Nodes:`, JSON.stringify(result.data.expertNodes))
        }
        console.log('\n')
    }
    
    process.exit(0)
}

runTests().catch(err => {
    console.error('Lỗi kiểm thử:', err)
    process.exit(1)
})
