from __future__ import annotations

import json
from collections import defaultdict
from difflib import SequenceMatcher


def build_from_json(payload: str) -> str:
    request = json.loads(payload)
    genomes = parse_fasta_files(request["files"])
    result = build_sequence_pvg(genomes, reference_name=request.get("reference"))
    return json.dumps(result)


def parse_fasta_files(files: list[dict[str, str]]) -> list[dict[str, str]]:
    genomes: list[dict[str, str]] = []
    for file_info in files:
        name = file_info["name"].rsplit(".", 1)[0]
        sequence_parts: list[str] = []
        for line in file_info["content"].splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith(">"):
                continue
            sequence_parts.append(line)
        sequence = clean_dna("".join(sequence_parts))
        if not sequence:
            raise ValueError(f"No FASTA sequence found in {file_info['name']}")
        genomes.append({"name": name, "sequence": sequence})
    if len(genomes) < 2:
        raise ValueError("Upload at least two FASTA genomes.")
    return genomes


def clean_dna(sequence: str) -> str:
    allowed = set("ACGTN")
    cleaned = sequence.upper().replace("U", "T")
    return "".join(base if base in allowed else "N" for base in cleaned)


def build_sequence_pvg(
    genomes: list[dict[str, str]],
    reference_name: str | None = None,
) -> dict[str, object]:
    reference = choose_reference(genomes, reference_name)
    others = [genome for genome in genomes if genome["name"] != reference["name"]]
    alignments = [alignment_events(reference["sequence"], genome["sequence"]) for genome in others]
    columns = combined_columns(reference, others, alignments)
    blocks, paths = columns_to_blocks(columns)
    assign_coordinates(paths, blocks)
    edges = build_edges(paths)
    return {
        "reference": reference["name"],
        "genomes": [{"name": genome["name"], "length": len(genome["sequence"])} for genome in genomes],
        "blocks": list(blocks.values()),
        "paths": list(paths.values()),
        "edges": edges,
        "gfa": write_gfa(blocks, paths, edges),
        "blocks_tsv": write_blocks_tsv(blocks),
        "paths_tsv": write_paths_tsv(paths),
        "summary_tsv": write_summary_tsv(blocks, len(genomes)),
    }


def choose_reference(genomes: list[dict[str, str]], reference_name: str | None) -> dict[str, str]:
    if reference_name is None:
        return max(genomes, key=lambda genome: len(genome["sequence"]))
    for genome in genomes:
        if genome["name"] == reference_name:
            return genome
    available = ", ".join(genome["name"] for genome in genomes)
    raise ValueError(f"Reference {reference_name!r} not found. Available genomes: {available}")


def alignment_events(reference: str, query: str) -> tuple[dict[int, str], dict[int, list[str]]]:
    matcher = SequenceMatcher(None, reference, query, autojunk=False)
    ref_bases: dict[int, str] = {}
    insertions: dict[int, list[str]] = defaultdict(list)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset, ref_index in enumerate(range(i1, i2)):
                ref_bases[ref_index + 1] = query[j1 + offset]
        elif tag == "delete":
            for ref_index in range(i1, i2):
                ref_bases[ref_index + 1] = "-"
        elif tag == "insert":
            insertions[i1].extend(query[j1:j2])
        elif tag == "replace":
            ref_span = i2 - i1
            query_span = j2 - j1
            paired = min(ref_span, query_span)
            for offset in range(paired):
                ref_bases[i1 + offset + 1] = query[j1 + offset]
            for ref_index in range(i1 + paired, i2):
                ref_bases[ref_index + 1] = "-"
            if query_span > paired:
                insertions[i1 + paired].extend(query[j1 + paired : j2])
    return ref_bases, insertions


def combined_columns(
    reference: dict[str, str],
    others: list[dict[str, str]],
    alignments: list[tuple[dict[int, str], dict[int, list[str]]]],
) -> list[dict[str, str]]:
    columns: list[dict[str, str]] = []
    all_genomes = [reference, *others]
    ref_sequence = reference["sequence"]
    for boundary in range(0, len(ref_sequence) + 1):
        max_insertion = max((len(insertions.get(boundary, [])) for _, insertions in alignments), default=0)
        for offset in range(max_insertion):
            column = {genome["name"]: "-" for genome in all_genomes}
            for genome, (_, insertions) in zip(others, alignments):
                inserted = insertions.get(boundary, [])
                if offset < len(inserted):
                    column[genome["name"]] = inserted[offset]
            columns.append(column)

        if boundary == len(ref_sequence):
            continue

        ref_pos = boundary + 1
        column = {reference["name"]: ref_sequence[boundary]}
        for genome, (ref_bases, _) in zip(others, alignments):
            column[genome["name"]] = ref_bases.get(ref_pos, "-")
        columns.append(column)
    return columns


def columns_to_blocks(columns: list[dict[str, str]]) -> tuple[dict[str, dict[str, object]], dict[str, dict[str, object]]]:
    genome_names = list(columns[0].keys()) if columns else []
    paths = {name: {"genome": name, "blocks": [], "coordinates": {}} for name in genome_names}
    blocks: dict[str, dict[str, object]] = {}
    active_runs: dict[tuple[str, ...], list[str]] = {}

    for column in columns:
        column_groups: dict[str, list[str]] = defaultdict(list)
        for genome_name, base in column.items():
            if base != "-":
                column_groups[base].append(genome_name)

        next_runs: dict[tuple[str, ...], list[str]] = {}
        for base, support in column_groups.items():
            support_key = tuple(support)
            if support_key in active_runs:
                next_runs[support_key] = active_runs.pop(support_key)
            else:
                next_runs[support_key] = []
            next_runs[support_key].append(base)

        for support_key, sequence_parts in active_runs.items():
            flush_run(sequence_parts, support_key, blocks, paths)
        active_runs = next_runs

    for support_key, sequence_parts in active_runs.items():
        flush_run(sequence_parts, support_key, blocks, paths)
    return blocks, paths


def flush_run(
    sequence_parts: list[str],
    support: tuple[str, ...],
    blocks: dict[str, dict[str, object]],
    paths: dict[str, dict[str, object]],
) -> None:
    if not sequence_parts:
        return
    sequence = "".join(sequence_parts)
    block_id = f"SB_{len(blocks) + 1:05d}"
    blocks[block_id] = {
        "id": block_id,
        "sequence": sequence,
        "length": len(sequence),
        "genomes": list(support),
    }
    for genome_name in support:
        paths[genome_name]["blocks"].append(block_id)


def assign_coordinates(paths: dict[str, dict[str, object]], blocks: dict[str, dict[str, object]]) -> None:
    for path in paths.values():
        cursor = 1
        coordinates: dict[str, dict[str, int]] = {}
        for block_id in path["blocks"]:
            length = int(blocks[block_id]["length"])
            coordinates[block_id] = {"start": cursor, "end": cursor + length - 1}
            cursor += length
        path["coordinates"] = coordinates


def build_edges(paths: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    edge_map: dict[tuple[str, str], dict[str, object]] = {}
    for path in paths.values():
        genome = str(path["genome"])
        blocks = list(path["blocks"])
        for source, target in zip(blocks, blocks[1:]):
            key = (source, target)
            edge = edge_map.setdefault(key, {"source": source, "target": target, "weight": 0, "genomes": []})
            edge["weight"] = int(edge["weight"]) + 1
            edge["genomes"].append(genome)
    return list(edge_map.values())


def write_gfa(blocks: dict[str, dict[str, object]], paths: dict[str, dict[str, object]], edges: list[dict[str, object]]) -> str:
    lines = ["H\tVN:Z:1.0"]
    for block in blocks.values():
        genomes = ",".join(block["genomes"])
        lines.append(f"S\t{block['id']}\t{block['sequence']}\tLN:i:{block['length']}\tGN:Z:{genomes}")
    for edge in edges:
        lines.append(f"L\t{edge['source']}\t+\t{edge['target']}\t+\t0M\tRC:i:{edge['weight']}")
    for path in paths.values():
        segments = ",".join(f"{block_id}+" for block_id in path["blocks"])
        lines.append(f"P\t{path['genome']}\t{segments}\t*")
    return "\n".join(lines) + "\n"


def write_blocks_tsv(blocks: dict[str, dict[str, object]]) -> str:
    lines = ["block\tbp_length\tgenome_count\tgenomes\tsequence"]
    for block in blocks.values():
        lines.append(
            f"{block['id']}\t{block['length']}\t{len(block['genomes'])}\t"
            f"{','.join(block['genomes'])}\t{block['sequence']}"
        )
    return "\n".join(lines) + "\n"


def write_paths_tsv(paths: dict[str, dict[str, object]]) -> str:
    lines = ["genome\tposition\tblock\tstart\tend"]
    for path in paths.values():
        for index, block_id in enumerate(path["blocks"], start=1):
            coords = path["coordinates"][block_id]
            lines.append(f"{path['genome']}\t{index}\t{block_id}\t{coords['start']}\t{coords['end']}")
    return "\n".join(lines) + "\n"


def write_summary_tsv(blocks: dict[str, dict[str, object]], genome_count: int) -> str:
    core = sum(1 for block in blocks.values() if len(block["genomes"]) == genome_count)
    lines = [
        "metric\tvalue",
        f"blocks\t{len(blocks)}",
        f"core_blocks\t{core}",
        f"accessory_or_variant_blocks\t{len(blocks) - core}",
    ]
    return "\n".join(lines) + "\n"

