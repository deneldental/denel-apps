const puppeteer = require('puppeteer')

;(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })
    console.log('Puppeteer launched successfully!')
    await browser.close()
  } catch (error) {
    console.error('Puppeteer failed to launch:', error)
  }
})()
