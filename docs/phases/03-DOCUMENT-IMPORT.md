# Phase 4 — Document handling

> **Section B is built; section A landed with phase 1.** The DOCX pipeline,
> tables, and the import report all ship in phase 4. Images do not — see "What
> phase 4 built" at the end, which also records the two places this
> implementation departed from the plan below and why.

There are two upload paths in this application and they have opposite security postures.
Keeping them separate is the whole design.

| | Dossier PDFs | Article DOCX |
|---|---|---|
| Who | Applicants | Members and above |
| Read by | Senior members only | Eventually the public |
| Rendered? | **Never** | Yes, as article content |
| Risk | Confidentiality of the person | Injection into a public page |

## A. Dossier PDFs — private, never rendered

- Validate the leading bytes (`%PDF-`), not `file.type`, which the client controls.
- Cap at 5 MB (current limit is right) and reject encrypted PDFs.
- Store in private object storage under a random UUID key; never build a key from the
  uploaded filename.
- Serve only through short-lived signed URLs, minted per request for an authorised senior
  member, with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- **Never preview a dossier PDF in an in-browser JS viewer.** PDFs can carry active
  content. If a preview is wanted, render to images server-side in a sandboxed worker.
- Encrypt, log every download, delete on the retention schedule. See `../SECURITY.md`.

## B. DOCX article import — the public path

Use **mammoth**, which converts `.docx` to semantic HTML by mapping Word *styles*
("Heading 1") to real tags and deliberately discarding visual styling. That is exactly the
right behaviour for us, because the target is structured article content, not a pixel copy.

### Pipeline

1. **Accept** — members and above only, rate-limited, 10 MB cap.
2. **Verify the container** — a `.docx` is a ZIP: check for `PK\x03\x04`, then confirm
   `[Content_Types].xml` and a `word/` entry exist. Reject anything else.
3. **Zip-bomb defence** — before extracting, cap the total uncompressed size, the entry
   count, and the compression ratio. A 2 MB upload that expands to 8 GB is a trivial
   denial-of-service otherwise.
4. **Convert in isolation** — run mammoth in a worker or short-lived process with memory
   and wall-clock limits. Keep mammoth's default of refusing to fetch files referenced
   outside the document.
5. **Handle images properly** — use mammoth's `convertImage` hook to pull each image out,
   validate it really is an image, re-encode it (which strips EXIF, including GPS), upload
   it to storage, and rewrite the `src`. **Do not inline base64**: it bloats the article,
   the database row, and every page load — directly against our 100 KB budget.
6. **Sanitise. This step is not optional.** Mammoth's own documentation is explicit that it
   performs *no* sanitisation, and that source documents can contain `javascript:` links
   which become executable if the output is embedded without cleaning. Run the HTML through
   a server-side allowlist sanitiser: permitted tags and attributes only, `javascript:` and
   `data:` URLs stripped, image `src` limited to https or our own storage paths.
7. **Parse into ProseMirror JSON** with TipTap's `generateJSON` against our exact schema.
   This is the second safety net: any node our schema does not define is discarded, so the
   stored document is by construction something our editor can represent and our renderer
   can render.
8. **Land it as a draft, never as a submission.** Open it in the editor with an import
   report — "kept 12 headings, 3 tables, 5 images; dropped 2 text boxes, 1 equation" — so
   the author fixes it before submitting. An import that silently loses a table and goes
   straight to review will burn a reviewer's time and the author's trust.

### What survives, and what does not

| Survives | Does not |
|---|---|
| Headings, paragraphs | Text boxes, SmartArt |
| Bold, italic, underline | Equations |
| Lists, nested lists | Tracked changes, comments |
| Tables | Multi-column layouts |
| Images | Headers, footers, page numbers |
| Hyperlinks, footnotes (mostly) | Fonts, colours, spacing |

This matches the stated scope — text, tables and images — but say it in the UI next to the
upload button. The mismatch between "I uploaded my Word file" and "where did my formatting
go" is the most predictable complaint this feature will generate, and one sentence prevents
most of it.

### Language

An import targets exactly one `(article_id, lang)` variant. Ask which language the file is
in; do not guess. A member importing the same piece in French and Creole performs two
imports against the same `article_id`.

### Export (later)

Members will eventually ask to get their work back out. Rendering stored ProseMirror JSON
to `.docx` is straightforward but it is not v1 work — note it and move on.


---

## What phase 4 built

`src/lib/docx.ts` is the pipeline and `src/lib/html-to-prosemirror.ts` is the
conversion. Between them they follow the eight steps above, with two deliberate
departures.

### Departure 1 — the sanitiser and the parser are one pass

Steps 6 and 7 above are "sanitise the HTML, then parse it into ProseMirror
JSON". This does both at once, and the result is stronger than doing them in
sequence.

`htmlToDocument` never copies a tag through. Every node is *rebuilt* from the
allowlist in `prosemirror.ts`, so an element with no entry in its tables cannot
produce anything, whatever it contains. A sanitiser has to enumerate what is
dangerous; this enumerates what is allowed. The step is not skipped — it is the
whole module, and `html-to-prosemirror.test.ts` holds it to the properties that
matter: a `javascript:` link becomes plain text, a `<script>` disappears with
its contents, an `onclick` attribute has no path by which it could survive.

Doing it this way also avoided TipTap's `generateJSON`, which would have meant
running the editor and a DOM implementation on the server to re-derive an
allowlist we already own.

### Departure 2 — images are dropped, and tables are not

The table above says both survive. Tables do, and needed four layers: nodes in
the schema, the renderer, the TipTap table extension in the editor, and the
import mapping. A budget line against a year is the one Word structure that
genuinely cannot be rewritten as prose.

**Images are counted and named in the report, not imported.** Mammoth's default
is to inline each one as a base64 `data:` URI, which would bloat the stored row
and every page load of the published article — directly against the first-load
budget — and there is nowhere to put them instead: D11 wants managed object
storage and it does not exist yet. Half-doing it now would also skip the part
that actually matters for a reader on metered data, which is AVIF/WebP with
`srcset` and lazy loading, not simply having an `<img>`.

So images arrive with the storage pipeline, as their own piece of work, and
until then an author is told plainly that their three images were not taken.

### The order of the checks

Worth stating because it is the part that would be easy to reorder harmlessly
and wrongly:

1. `file.size` before the body is read, so an oversized upload never becomes
   memory.
2. `PK\x03\x04`, because the MIME type is set by the client.
3. The **central directory**, which states every entry's compressed and
   uncompressed size — read before anything is decompressed. The entry count,
   the total, and the per-entry ratio are all checked there. A 2 MB upload that
   expands to 8 GB is a denial of service that costs the attacker nothing, and
   finding that out by decompressing it is the bug.
4. `[Content_Types].xml` and a `word/` entry, which is what makes a ZIP a Word
   file rather than a renamed archive.
5. Only then mammoth, under a wall-clock timeout.

### Still open

**A worker or sandboxed process.** Step 4 of the plan asks for the conversion to
run with memory and wall-clock limits in isolation. There is a timeout, and the
archive limits cap what one request can cost, but it still runs in the request
handler. That is the remaining piece, and it belongs with the same deployment
work as object storage.

**Export.** Still not v1, as the plan says.
