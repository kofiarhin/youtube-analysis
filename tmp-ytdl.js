const y = require('youtube-dl-exec');

y('https://www.youtube.com/@TraversyMedia/videos', {
  dumpSingleJson: true,
  flatPlaylist: true,
  playlistEnd: 5,
}).then((out) => {
  let len;
  let t = typeof out;
  try {
    len = t === 'string' ? out.length : JSON.stringify(out).length;
  } catch (e) {
    len = -1;
  }
  console.log('resolved:', t, 'len:', len);
  if (t === 'string') {
    try { const obj = JSON.parse(out); console.log('parsed-keys', Object.keys(obj)); } catch(e) { console.error('parse-error', e && e.message); }
  } else {
    console.log('keys', Object.keys(out || {}));
  }
}).catch((e) => {
  console.error('error:', e && e.message);
});
