const fs = require('fs');
const buf = Buffer.alloc(5000);
const fd = fs.openSync('c:\\workspace\\sts2-card-art-editor\\lastest_260402.cardartpack.json', 'r');
fs.readSync(fd, buf, 0, 5000, 0);
console.log(buf.toString('utf8'));
fs.closeSync(fd);
