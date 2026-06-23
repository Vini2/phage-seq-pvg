# phage-seq-pvg: Sequence-Level Pangenome Variation Graphs for Bacteriophages

`phage-seq-pvg` a browser-only web app for building sequence-level pangenome variation graphs from multiple phage genomes.

It runs entirely in the browser with [Pyodide](https://pyodide.org/). There is no backend, no upload server, and no command-line tool. FASTA files stay in the user's browser session.

## Workflow

1. Open the web page.
2. Upload two or more FASTA genomes.
3. Pick a reference genome.
4. Click **Build graph**.
5. Inspect the scrollable sequence-block view.
6. Click any shared or variable block to view:
   - block ID
   - length
   - shared/variable type
   - genome support
   - per-genome start/end coordinates
   - full nucleotide sequence
7. Download GFA, blocks TSV, paths TSV, or summary TSV.

## How The PVG Is Built

The app builds a reference-anchored sequence pangenome graph:

1. Each FASTA upload is parsed as one genome sequence.
2. The selected reference anchors the graph.
3. Each other genome is aligned to the reference in the browser.
4. Shared alignment runs become shared sequence-block nodes.
5. SNPs, indels, and accessory sequence become variable sequence-block nodes.
6. Each genome becomes a path through those blocks.

Coordinates shown in the details panel are 1-based inclusive positions within each genome.

## Development

The app is static. Edit `index.html`, `styles.css`, `app.js`, and `pvg_core.py`.

Because Pyodide is loaded from a CDN and the app fetches `pvg_core.py`, serve the folder with a tiny static server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```
