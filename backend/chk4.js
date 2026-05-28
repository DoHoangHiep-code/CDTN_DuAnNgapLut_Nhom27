const http = require('http');
http.get('http://localhost:3002/api/v1/weather/forecast24h?lat=21.0285&lng=105.8542', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log(d);
  });
});
