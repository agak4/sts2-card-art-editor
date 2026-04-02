const fs = require('fs');
const data = fs.readFileSync('c:\\workspace\\sts2-card-art-editor\\lastest_260402.cardartpack.json', 'utf8');
const obj = JSON.parse(data);
console.log('Format:', obj.format);
console.log('Version:', obj.version);
console.log('Count:', obj.count);
console.log('Overrides is array?', Array.isArray(obj.overrides));
if (Array.isArray(obj.overrides)) {
    console.log('First override source_path:', obj.overrides[0].source_path);
} else {
    console.log('Overrides keys:', Object.keys(obj.overrides).slice(0, 5));
}
