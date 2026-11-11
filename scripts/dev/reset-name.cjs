const { DatabaseSync } = require('node:sqlite');
const p = require('path').join(process.env.LOCALAPPDATA, 'PitWall', 'pitwall.db');
const db = new DatabaseSync(p);
const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
console.log(tables.join(','));
const t = tables.find((n) => /setting/i.test(n));
console.log(db.prepare(`select * from ${t} where key in ('engineerName','wakeAliases')`).all());
db.prepare(`delete from ${t} where key in ('engineerName','wakeAliases')`).run();
console.log('after', db.prepare(`select * from ${t} where key in ('engineerName','wakeAliases')`).all());
