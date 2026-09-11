# Phase 3 — Document handling

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
