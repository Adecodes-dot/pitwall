// Replace the bad Shanghai model in the user's database with the one rebuilt from today's captures, plus its reference lap.
// Run only while Pit Wall is closed.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const real = new DatabaseSync(path.join(process.env.LOCALAPPDATA, 'PitWall', 'pitwall.db'));
const src = process.argv[2];
real.exec(`create table if not exists refs (track_id text primary key, time_ms integer not null, lap_number integer, length integer not null, ch blob not null, saved_at text not null);`);
real.exec(`attach database '${src.replace(/'/g, "''")}' as w`);
const before = real.prepare("select id, round(length) as len from tracks where id = 'f1:shanghai'").all();
real.exec("delete from tracks where id = 'f1:shanghai'; delete from refs where track_id = 'f1:shanghai';");
real.exec("insert into tracks select * from w.tracks where id = 'f1:shanghai'; insert into refs select * from w.refs where track_id = 'f1:shanghai';");
console.log('before', JSON.stringify(before), 'after', JSON.stringify(real.prepare("select id, round(length) as len from tracks").all()), JSON.stringify(real.prepare('select track_id, time_ms, length from refs').all()));
real.exec('detach database w'); real.close();
