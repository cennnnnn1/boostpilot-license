const fs = require('fs');
const html = fs.readFileSync('state/offer_form.html', 'utf8');

const i = html.indexOf('Delivery time:');
console.log('=== DESDE DELIVERY TIME ===');
console.log(html.slice(i, i + 3000).replace(/\s+/g, ' '));
