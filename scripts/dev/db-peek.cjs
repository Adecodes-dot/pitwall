const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(require('path').join(process.env.LOCALAPPDATA, 'PitWall', 'pitwall.db'), { readOnly: true });
console.log(db.prepare('select id, game, name, round(length) as len, updated_at from tracks').all());
console.log(db.prepare('select id, track_id, started_at, best_ms, laps from sessions order by id desc limit 12').all());
console.log(db.prepare('select session, number, time_ms, valid, track_id from laps order by session desc limit 15').all());
