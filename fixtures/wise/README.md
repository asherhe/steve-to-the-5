# WISE contract and retained example

`openapi.json` is the WISE service's shared route schema. `responses/blink.json` is
a **synthetic** two-visit example for interface review; it is not live verification.

`real-wise0855/example.json` identifies a retained **real** W2 comparison, fetched
on 2026-11-15. Its immutable manifest and all referenced blobs are in `evidence/`.
These include six original WISE/NEOWISE FITS cutouts, two unWISE input-index metadata
tables, the combined frames and their PNGs. Hash-only filenames are binary in Git.
Do not normalize or edit these files; changed evidence needs a new identity.

The comparison is available through the default WISE service by ID and by its exact
field in W2 blink mode. Other bands, fields, timeline mode and explicit refreshes
never substitute this example. The viewer labels its replay as saved real evidence.
It is not a confirmed identification of WISE 0855 or a motion measurement.

From the repository root, `services/archive/.venv/Scripts/python.exe -m
scripts.reproduce_wise_example` reprocesses retained inputs offline and checks the
dates, grid and pixels. Use `.venv/bin/python` on Unix. Exact saved replay and
current-code reprocessing have different IDs and guarantees; see
[verification](../../docs/verification/blink-latency.md).

Metadata credit: [unWISE](https://unwise.me/), Lang (2014), Meisner, Lang & Schlegel
(2017a,b). Original images: WISE/NEOWISE, NASA/IPAC IRSA. The manifest preserves the
full WISE/NEOWISE acknowledgement, source URLs, observation times and limitations.
