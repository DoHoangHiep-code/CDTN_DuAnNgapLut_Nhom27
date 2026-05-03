const axios = require('axios')

async function explainWithAI(features) {
  const url = `${process.env.AI_SERVICE_URL}/api/explain`

  const res = await axios.post(url, features)

  return res.data
}

module.exports = {
  explainWithAI,
}