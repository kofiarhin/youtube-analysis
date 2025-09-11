const ymod = require('youtube-dl-exec');
const yt = ymod.create({ stdio: ['ignore', 'pipe', 'pipe'] });

yt('https://www.youtube.com/@TraversyMedia/videos', {
  dumpSingleJson: true,
  flatPlaylist: true,
  playlistEnd: 5,
}).then((out) => {
  console.log('resolved-type', typeof out);
  if (typeof out === 'string') {
    try { const j = JSON.parse(out); console.log('keys', Object.keys(j)); }
    catch (e) { console.error('parse-err', e && e.message); }
  } else {
    console.log('keys', Object.keys(out || {}));
  }
}).catch((e) => {
  console.error('error', e && e.message);
});
