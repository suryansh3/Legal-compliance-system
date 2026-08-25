#!/usr/bin/env python3
"""Sync the D1 database migrated via `wrangler d1 migrations apply --local`
into every other miniflare D1 object so `wrangler pages dev` sees the same data.
(wrangler keys the local D1 durable object differently between the two commands.)
Run after: npm run db:migrate:local && npm run db:seed
"""
import glob, os, sqlite3, sys

base = os.path.join(os.path.dirname(__file__), '..', '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
base = os.path.abspath(base)
if not os.path.isdir(base):
    sys.exit('No local D1 state found; run npm run db:migrate:local first')

dbs = [p for p in glob.glob(os.path.join(base, '*.sqlite')) if not p.endswith('metadata.sqlite')]
src = None
for p in dbs:
    con = sqlite3.connect(p)
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    con.close()
    if 'users' in tables:
        src = p
        break
if not src:
    sys.exit('No migrated database (with users table) found')

for p in dbs:
    if p == src:
        continue
    for ext in ('-shm', '-wal'):
        try: os.remove(p + ext)
        except FileNotFoundError: pass
    s = sqlite3.connect(src)
    d = sqlite3.connect(p)
    s.backup(d)
    d.close(); s.close()
    print(f'synced -> {os.path.basename(p)}')
print('done')
