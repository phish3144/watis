import sqlite3InitModule from './sqlite/index.mjs'
const out = {}
try {
  const sqlite3 = await sqlite3InitModule()
  out.version = sqlite3.version.libVersion
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'watis-probe' })
  const db = new pool.OpfsSAHPoolDb('/probe.sqlite')
  db.exec(
    "CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, at INTEGER); CREATE VIRTUAL TABLE IF NOT EXISTS f USING fts5(x, tokenize='unicode61 remove_diacritics 2')",
  )
  db.exec({ sql: 'INSERT INTO t(at) VALUES (?)', bind: [Date.now()] })
  db.exec({ sql: 'INSERT INTO f(x) VALUES (?)', bind: ['Grüße aus München'] })
  out.rows = db.selectValue('SELECT count(*) FROM t')
  out.fts = db.selectValue("SELECT count(*) FROM f WHERE f MATCH 'munchen'")
  out.journal = db.selectValue('PRAGMA journal_mode')
  out.files = pool.getFileNames()
  db.close()
} catch (e) {
  out.error = String(e)
}
postMessage(out)
