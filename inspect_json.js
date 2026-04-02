const fs = require('fs');

const data = fs.readFileSync('c:\\workspace\\sts2-card-art-editor\\lastest_260402.cardartpack.json', 'utf8');
const parsed = JSON.parse(data.substring(0, 1000000).lastIndexOf('}') + 1 ? data.substring(0, data.indexOf('[')) : '{}');
console.log('JSON start:', data.substring(0, 1000));
