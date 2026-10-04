# Hosting nib, and syncing to it

nib keeps your notes in a SQLite file on your own machine. That never changes, and
it is why the terminal UI is instant and works on a plane.

If you also want the same notes from other machines, or a copy that survives losing
this one, you can run a **hosted server**: the same `nib` binary, keeping notes in
Postgres, behind a name and password. Each machine keeps its own local file and
**syncs** with it.

```
 laptop ── nib (SQLite) ─┐
                         ├──  https://your-nib.onrender.com ──  Supabase Postgres
 desktop ─ nib (SQLite) ─┘            (nib serve)
                                           ▲
 phone / any browser ──────────────────────┘   the web UI, signed in
```

The local copy is the one you write to; the server is the meeting point and the
backup. Because every device holds everything, the server being asleep, down or
unreachable only means a sync is skipped. Nothing waits on it.

## What you need

- A free [Supabase](https://supabase.com) project, for the Postgres database.
- A free [Render](https://render.com) account, to run the server.
- This repository, on GitHub, which Render builds from.

## 1. The database

1. Create a Supabase project. Note the database password you choose.
2. Open **Project Settings → Database → Connection string**, choose the
   **Session pooler** tab and copy the URI. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`.

   Use the session pooler, not the "direct connection". The direct host is
   IPv6-only, and Render's free tier cannot reach it.
3. Put your password in place of `[YOUR-PASSWORD]`. If it contains characters such
   as `@`, `/`, `:` or `#`, percent-encode them (`@` is `%40`).

nib creates its own tables the first time the server starts, and switches on row
level security for them, so Supabase's public REST API cannot read your notes with
the project's anon key. Only the server, connecting with the database password,
can.

## 2. The server

1. In Render choose **New → Blueprint** and point it at your fork of this
   repository. It reads `render.yaml` and builds the `Dockerfile`.
2. When it asks for the three secrets, give it:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase URI from step 1 |
   | `NIB_USER` | a name for yourself |
   | `NIB_PASSWORD` | a long password, **at least 12 characters** |

3. When the deploy finishes, open the URL Render shows. Your browser asks for the
   name and password, then shows the web UI, working directly on Postgres.

The server refuses to start without all three, and refuses a short password: it is
on the public internet.

Without Render, the same container runs anywhere:

```bash
docker build -t nib .
docker run -p 8080:8080 -e DATABASE_URL=... -e NIB_USER=me -e NIB_PASSWORD=... nib
```

or without Docker, `./build.sh` and then `nib serve` with the same variables set.
`PORT` chooses the port, as hosts expect; `--addr` overrides it.

## 3. Each machine

```bash
nib login https://your-nib.onrender.com
```

It asks for the name and password, syncs once to prove they work, and only then
saves them to `remote.json` beside your database (mode `0600`). After that nib
syncs by itself:

- when it starts,
- every minute while it runs,
- once more when you quit.

`nib sync` does a single round and exits, and `nib --offline` skips syncing for one
run. `nib logout` forgets the login; your notes stay where they are.

The first time a machine meets the server it pulls before anything else, so a new
machine receives your notes instead of inventing a second welcome note.

Notes written before you ever logged in are sent up on the first sync. Nothing is
lost either way.

### The free tiers

- **Render** stops an idle free service after about fifteen minutes and starts it on
  the next request, which can take close to a minute. nib waits for it, so the first
  sync after a quiet spell is slow and the rest are not. Opening the hosted web UI
  after a quiet spell has the same delay.
- **Supabase** pauses a free project after about a week without activity. Your data
  is kept and you can restore the project from its dashboard. Any machine that
  syncs at least weekly keeps it awake.

## How it settles disagreements

Each note carries the time it last changed. When the same note was edited on two
machines while apart, **the later edit wins, whole**. There is no merging inside a
note: two edits to the same note made before either machine synced is the one
situation in which one of them is lost. Sync often (nib does) and it is rare.

This relies on your machines' clocks being roughly right. One that is hours off will
win or lose conflicts it should not.

- Deleting a note moves it to the trash everywhere. Restoring it restores it
  everywhere. The thirty-day trash applies on each side.
- Emptying the trash, or purging a note, destroys it everywhere. nib remembers that
  it did, so an old copy on a machine that was switched off cannot bring it back.
  A note *edited* after it was destroyed elsewhere counts as a newer write, and
  comes back.
- Pictures and files are named for the hash of their contents, so they never
  conflict. Sync copies the ones the notes use to whichever side lacks them. On the
  server they are stored in Postgres, so the free tier's 500 MB is shared between
  notes and files.

## Security notes

- The login is one name and password from the server's environment; there are no
  accounts to sign up for. Wrong guesses are slowed by a second each.
- It uses HTTP Basic over the HTTPS Render provides. The sync client refuses to send
  a password over plain `http://` to anything but this machine.
- Requests that change something and claim to come from another website are refused,
  so a page you visit cannot delete notes on your behalf.
- `remote.json` holds the password in plain text, readable by your user only, like
  an SSH key or a `.netrc`. Anyone with your account on that machine has it. To
  avoid storing it, leave the file out and set `NIB_REMOTE`, `NIB_USER` and
  `NIB_PASSWORD` in the environment instead.
- The server does not log note contents.

## Trying it locally

You can run the whole thing on one machine against any Postgres:

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/nib
export NIB_USER=me NIB_PASSWORD=a-long-enough-password
nib serve --addr 127.0.0.1:8080 &
nib login --user me http://localhost:8080
```

The tests can run against a Postgres of your choosing. Point `NIB_TEST_POSTGRES` at
an empty scratch database - **the tests empty its tables** - and run `go test ./...`.
Without it the Postgres cases are skipped and SQLite alone is tested.
