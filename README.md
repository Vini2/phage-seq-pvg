# phage-seq-pvg: Sequence-Level Pangenome Variation Graphs for Bacteriophages

`phage-seq-pvg` a browser-only web app for building sequence-level [pangenome variation graphs (PVGs)](https://doi.org/10.1093/bioinformatics/btac743) from multiple bacteriophage genomes.

It runs entirely in the browser with [Pyodide](https://pyodide.org/). There is no backend, no upload server, and no command-line tool. FASTA files stay in the user's browser session.

## Web App

🌐 Live demo: [vini2.github.io/phage-seq-pvg/](https://vini2.github.io/phage-seq-pvg/)

No installation needed! Python not required. Node.js not required. You only need a modern browser such as Chrome, Firefox, Safari or Edge.

## Workflow

1. Open the web page.
2. Upload two or more FASTA genomes.
3. Pick a reference genome.
4. Click **Build graph**.
5. Inspect the scrollable sequence-block view and pangenome view.
6. Click any shared or variable block to view:
   - block ID
   - length
   - shared/variable type
   - genome support
   - per-genome start/end coordinates
   - full nucleotide sequence
7. Download GFA, blocks TSV, paths TSV, or summary TSV.

## How The PVG Is Built

The app builds a reference-anchored sequence pangenome graph as follows.

1. Read uploaded FASTA genomes
   - Each uploaded FASTA is treated as one genome sequence.
2. Choose a reference
   - The user-selected reference anchors the graph.
3. Align every other genome to the reference
   - The app uses Python’s `difflib.SequenceMatcher`. It finds matching sequence runs between each query genome and the reference, then classifies differences as substitutions, insertions, or deletions.
4. Build alignment columns
   - The app lifts all pairwise reference-query comparisons into one shared coordinate system.
5. Collapse identical supported runs into blocks
   - Consecutive columns with the same base and the same genome support become one sequence block.
6. Create graph paths
   - Each genome is represented as an ordered path through those blocks.
7. Visualise the graph
   - Shared blocks are green, variable blocks are yellow, missing blocks are grey. Clicking a block shows length, support, coordinates, and sequence.

Coordinates shown in the details panel are 1-based inclusive positions within each genome.

## Development

The app is static. Edit `index.html`, `styles.css`, `app.js`, and `pvg_core.py`.

Because Pyodide is loaded from a CDN and the app fetches `pvg_core.py`, serve the folder with a tiny static server:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Limitations

This is a lightweight browser implementation for small related phage genomes. It is not equivalent to full pangenome graph builders like [PGGB](https://github.com/pangenome/pggb), [Minigraph-Cactus](https://github.com/ComparativeGenomicsToolkit/cactus), [vg](https://github.com/vgteam/vg), or [minigraph](https://github.com/lh3/minigraph), which use more sophisticated whole-genome alignment and graph normalization.


# Acknowledgement

Codex (OpenAI) was used as a development aid during front-end implementation for UI design iteration, component structuring, styling suggestions, and debugging support. All generated code and recommendations were reviewed, modified as needed, and validated by the project authors before integration.
