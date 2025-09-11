const mod = require('youtube-dl-exec');
console.log('export-type', typeof mod);
console.log('has-raw', mod && Object.prototype.hasOwnProperty.call(mod, 'raw'));
console.log('raw-type', mod && typeof mod.raw);
console.log('keys', mod && Object.keys(mod));
