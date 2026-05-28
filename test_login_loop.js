const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Navigate to login
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });

  // Wait for React to mount
  await page.waitForSelector('input[type="password"]');

  // Type wrong password
  await page.type('input[type="password"]', 'wrongpassword');

  // Intercept console messages
  page.on('console', msg => {
    console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  // Click login button
  const buttons = await page.$$('button');
  await buttons[0].click();

  // Wait a bit
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
