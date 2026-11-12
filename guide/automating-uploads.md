# Automating uploads

To keep a pipeline up to date without uploading by hand, run a small job on a
schedule that writes the new data since its last run to a file, uploads it to
the source prefix, and starts a run. With [incremental runs](/reference/pipeline-config#incremental-runs),
each run then reads only that new file.

## Starting the run

Pick one of these:

- **Upload events.** With [auto-runs](./webhooks) set up, the upload itself
  starts a run, five seconds after the last file of a batch. Runs show
  `webhook` on the **Jobs** page.
- **The web API.** Call `POST /api/p/<slug>/jobs` after the upload, with the
  worker token as a bearer token (see [automation and CI](./authentication#automation-and-ci)).
  Runs show `manual`. Use this when the lake has no notification rule, or when
  you want the job's own log to say the run was accepted (`202`).

```sh
curl -s -X POST -H "Authorization: Bearer $KARET_WORKER_TOKEN" \
  -o /dev/null -w '%{http_code}\n' \
  https://karet.example/api/p/<slug>/jobs
```

If both are set up, each upload starts two runs. The second finds no new
files and writes nothing, so this costs time but not correctness.

## Rules for the files

- **Name files so they sort by time**, with fixed-width numbers:
  `access_1794449450_1794450001.csv` or `2026-11-12T0310.csv`. When the table
  has `dedup_keys`, a new file that sorts before one already read makes the
  next run a full run.
- **Upload each batch as a new file. Never replace or delete one** that a run
  has read; that also makes the next run a full run.
- **Every file needs the source's header row and columns**, in the source's
  `format`.
- **Save your position only after the upload succeeds.** A failed run then
  retries the same data. Sending a row twice is safe when the table has
  `dedup_keys` that identify a row; skipping one is not.
- **Fewer, larger files are cheaper.** Every run lists the whole source
  prefix, so its listing time grows with the number of files. Every 10 minutes
  is about 144 files a day; if you do not need data that fresh, upload hourly.

## Reading a log file

For a log that a program appends to, read from the byte offset where the last
run stopped rather than by time. Keep only whole lines: the program may be
partway through writing the last one. Save the file's inode with the offset,
so that when the log is rotated (renamed and replaced) you notice and finish
the old file before starting the new one.

Avoid `docker logs --since` for this. It scans the container's whole log on
every call, so it gets slower each day, and the log is deleted when the
container is recreated. Have the program write its log to a file on a volume
instead; most servers can also rotate it themselves.

## Example

A cron job that ships new lines of a JSON-lines log, where the source
container has `"format": "ndjson"` and `path_prefix` `pipelines/<slug>/events/`.
It assumes the log is rotated by renaming it to `events.log.1`.

```python
#!/usr/bin/env python3
import json, os, subprocess, time

LOG = "/var/log/app/events.log"
ROTATED = LOG + ".1"
STATE = os.path.expanduser("~/.karet-ship.json")
PREFIX = "s3://karet-lake/pipelines/<slug>/events/"
RUN_URL = "https://karet.example/api/p/<slug>/jobs"

def read_lines(path, offset):
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read()
    end = data.rfind(b"\n") + 1  # whole lines only
    return data[:end], offset + end

state = json.load(open(STATE)) if os.path.exists(STATE) else {"inode": None, "offset": 0}
now = int(time.time())
inode = os.stat(LOG).st_ino
chunks = []
if state["inode"] not in (None, inode):
    # The log was rotated since the last run: finish the old file first.
    if os.path.exists(ROTATED) and os.stat(ROTATED).st_ino == state["inode"]:
        chunks.append(read_lines(ROTATED, state["offset"])[0])
    state["offset"] = 0
data, offset = read_lines(LOG, state["offset"])
chunks.append(data)
body = b"".join(chunks)

if body:
    tmp = f"/tmp/events_{now}.ndjson"
    open(tmp, "wb").write(body)
    subprocess.run(["aws", "s3", "cp", tmp, f"{PREFIX}events_{now}.ndjson"], check=True)
    os.unlink(tmp)
    subprocess.run(["curl", "-sf", "-X", "POST", "-o", "/dev/null",
                    "-H", f"Authorization: Bearer {os.environ['KARET_WORKER_TOKEN']}", RUN_URL],
                   check=True)

json.dump({"inode": inode, "offset": offset}, open(STATE + ".tmp", "w"))
os.replace(STATE + ".tmp", STATE)
```

Run it every 10 minutes:

```cron
*/10 * * * * KARET_WORKER_TOKEN=... AWS_ENDPOINT_URL=http://localhost:9000 /usr/local/bin/karet-ship >> /var/log/karet-ship.log 2>&1
```

If the data is not in the shape the source expects, convert it before the
upload, or upload it as it is and use a mapping's expressions and `where`
filter to shape it.

## Checking it works

- The **Jobs** page shows one run per upload. Open a run: **Files processed**
  should be 1. A run that processed every file in the prefix was a full run;
  the rules above say what causes one.
- The table's row count in the **Data** page's table list grows by the rows you
  shipped, less any duplicates the dedup keys removed.
