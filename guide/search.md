# Search

The **Search** page finds events in one table by words and field values,
newest first, without writing SQL. Choose a table, type a search, and pick a
time range. The page shows how many events match, a bar chart of matches over
time, the table's fields, and the events.

The table, search and time range are kept in the page's URL, so a link opens
the same search and the back button returns to the previous one.

## The search language

| Search | Matches |
|---|---|
| `login` | events with `login` in any field, ignoring case |
| `"not found"` | the phrase, in any field |
| `wp-*.php` | `*` is a wildcard |
| `status=500` | a field equal to a value; text fields ignore case |
| `host=git*` | a field matching a wildcard |
| `status!=200` | a field not equal to a value |
| `status>=500` | `>`, `>=`, `<`, `<=` compare numbers, dates and times |
| `host=*` | the field has a value; `host!=*` means it has none |
| `login status=500` | both terms; a space means `AND` |
| `status=404 OR status=500` | either term |
| `NOT method=GET` | the term does not match, including events with no `method` |
| `(status=404 OR status=500) host=git*` | brackets group terms; `AND` binds before `OR` |

`AND`, `OR` and `NOT` are keywords only in capitals. Put a value in quotes when
it has spaces or brackets: `user_agent="Mozilla/5.0 (X11)"`, and use `\"` for a
quote inside it. Field names are the table's column names, ignoring case.

A search that cannot run says why: an unclosed quote or bracket, a field the
table does not have, or a value that cannot match, such as `status=abc` on a
number column.

## Event time

The page picks the column that holds each event's time:

1. the first `TIMESTAMP` column;
2. else a numeric, text or date column named `ts`, `timestamp`, `@timestamp`,
   `time`, `event_time`, `datetime` or `created_at`, in that order;
3. else the first `DATE` column.

Numbers are read as epoch seconds, or as milliseconds when they are above
10<sup>11</sup>. Text is read as a number first, then as a timestamp. A table
with no such column has no time range and no chart.

The ranges are the last 15 minutes, hour, 4 hours, 24 hours, 7 days and 30
days, and all time. The default is the last 24 hours. When nothing matches in
the range, the page gives the time of the latest match and a link to search all
time.

## Narrowing a search

- **The chart.** Hover a bar to see its count. Click a bar, or drag across
  several, to search that span.
- **Fields.** Open a field to see its 10 most common values among the matches,
  how many distinct values it has, and the share of events it appears in.
  Click a value to add `field=value` to the search, or its minus button to
  add `NOT field=value`.
- **Events.** Each event shows its time and every field as `name=value`, with
  the search's words highlighted. Open one to see its fields one per line,
  each with buttons to add or exclude its value.

Results come 50 at a time; the arrows by the count show newer and older
events.

## Speed

A search reads the table's Parquet files through DuckDB, like any query, and
has no index of words. A time range is also checked on the raw time column,
which DuckDB applies while it reads, so it skips the other columns of rows
outside the range. A search on fields is therefore fast, and a search for a
word over a short range is fast. A word over all time reads every field of
every row, so it takes longer as the table grows.

Search needs the `viewer` role on the pipeline, like the Data page.
