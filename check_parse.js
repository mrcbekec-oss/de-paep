const fs = require('fs');
const vm = require('vm');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
try {
  new vm.Script(src, { filename: 'game.js' });
  console.log('parse ok');
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
