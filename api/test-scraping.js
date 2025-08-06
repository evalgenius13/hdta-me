module.exports = async function handler(req, res) {
  try {
    const testUrl = 'https://www.newsweek.com/va-major-change-healthcare-benefits-abortion-2109500';
    const scrapingUrl = `https://app.scrapingbee.com/api/v1/?api_key=WFOD09LZ19LHCAPMFFHT6PGQRKG7HW490K64BUBPNKXEZLLR6RY531F0BGP6GN6PWM0YZ0SAA9QPOD1G&url=${encodeURIComponent(testUrl)}`;
    
    const response = await fetch(scrapingUrl);
    const html = await response.text();
    
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(html);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
