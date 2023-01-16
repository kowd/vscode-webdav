let fs = require('fs/promises');

// Bundling ignores these native node modules, this brings them back:
fs.cp('./node_modules/node-expose-sspi/lib/arch', './out/arch', {
    recursive: true
});