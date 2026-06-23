const state = {
  pyodide: null,
  files: [],
  result: null,
  isBuilding: false,
};

const els = {
  status: document.querySelector("#runtime-status"),
  fileInput: document.querySelector("#file-input"),
  fileList: document.querySelector("#file-list"),
  reference: document.querySelector("#reference-select"),
  build: document.querySelector("#build-button"),
  microviridae: document.querySelector("#microviridae-button"),
  summary: document.querySelector("#summary"),
  downloads: document.querySelector("#downloads"),
  matrix: document.querySelector("#matrix"),
  graph: document.querySelector("#graph"),
  viewer: document.querySelector("#viewer-shell"),
  detailsEmpty: document.querySelector(".details-empty"),
  detailsContent: document.querySelector(".details-content"),
  copy: document.querySelector("#copy-sequence"),
  detail: {
    block: document.querySelector("#detail-block"),
    type: document.querySelector("#detail-type"),
    length: document.querySelector("#detail-length"),
    support: document.querySelector("#detail-support"),
    genomes: document.querySelector("#detail-genomes"),
    coordinates: document.querySelector("#detail-coordinates"),
    sequence: document.querySelector("#detail-sequence"),
  },
};

window.addEventListener("DOMContentLoaded", () => {
  bootPyodide();
  els.fileInput.addEventListener("change", readUploadedFiles);
  els.microviridae.addEventListener("click", loadMicroviridaeFiles);
  els.build.addEventListener("click", buildGraph);
  els.downloads.addEventListener("click", handleDownload);
  els.copy.addEventListener("click", copySequence);
});

async function bootPyodide() {
  try {
    state.pyodide = await loadPyodide();
    const core = await fetch("pvg_core.py").then((response) => response.text());
    await state.pyodide.runPythonAsync(core);
    els.status.textContent = "Ready";
    updateBuildState();
  } catch (error) {
    els.status.textContent = "Pyodide failed to load";
    console.error(error);
  }
}

async function readUploadedFiles(event) {
  const files = [...event.target.files];
  state.files = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      content: await file.text(),
    })),
  );
  renderFileList();
  updateReferenceOptions();
  updateBuildState();
}

async function loadMicroviridaeFiles() {
  const names = ["KX513870.1.fasta", "KX513872.1.fasta", "KX513874.1.fasta"];
  await loadExampleFiles(names, "KX513870.1");
}

async function loadExampleFiles(names, preferredReference) {
  state.files = await Promise.all(
    names.map(async (name) => ({
      name,
      content: await fetch(`examples/${name}`).then((response) => response.text()),
    })),
  );
  renderFileList();
  updateReferenceOptions(preferredReference);
  updateBuildState();
}

function renderFileList() {
  els.fileList.innerHTML = "";
  state.files.forEach((file) => {
    const pill = document.createElement("span");
    pill.className = "file-pill";
    pill.textContent = file.name;
    els.fileList.appendChild(pill);
  });
}

function genomeName(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}

function updateReferenceOptions(preferred) {
  els.reference.innerHTML = "";
  state.files.forEach((file) => {
    const option = document.createElement("option");
    option.value = genomeName(file.name);
    option.textContent = option.value;
    if (preferred && preferred === option.value) option.selected = true;
    els.reference.appendChild(option);
  });
}

function updateBuildState() {
  els.build.disabled = !state.pyodide || state.files.length < 2;
}

async function buildGraph() {
  if (!state.pyodide || state.files.length < 2 || state.isBuilding) return;
  state.isBuilding = true;
  const startedAt = performance.now();
  els.status.textContent = "Building graph...";
  els.status.classList.add("is-busy");
  els.build.setAttribute("aria-disabled", "true");
  els.build.classList.add("is-loading");
  els.build.querySelector(".button-label").textContent = "Building...";
  try {
    await paintBusyState();
    const payload = JSON.stringify({
      files: state.files,
      reference: els.reference.value || null,
    });
    state.pyodide.globals.set("input_json", payload);
    const resultJson = state.pyodide.runPython("build_from_json(input_json)");
    state.result = JSON.parse(resultJson);
    renderResult(state.result);
    els.status.textContent = "Graph ready";
  } catch (error) {
    els.status.textContent = "Build failed";
    alert(error.message || String(error));
    console.error(error);
  } finally {
    await waitForMinimumBusyTime(startedAt, 650);
    state.isBuilding = false;
    els.status.classList.remove("is-busy");
    els.build.classList.remove("is-loading");
    els.build.removeAttribute("aria-disabled");
    els.build.querySelector(".button-label").textContent = "Build graph";
    updateBuildState();
  }
}

function renderResult(result) {
  renderSummary(result);
  renderDownloads();
  renderMatrix(result);
  renderGraph(result);
  els.viewer.hidden = false;
}

function renderSummary(result) {
  els.summary.hidden = false;
  els.summary.innerHTML = "";
  [
    `${result.genomes.length} genomes`,
    `${result.blocks.length} sequence blocks`,
    `${result.edges.length} graph edges`,
    `reference: ${result.reference}`,
  ].forEach((text) => {
    const item = document.createElement("span");
    item.textContent = text;
    els.summary.appendChild(item);
  });
}

function renderDownloads() {
  els.downloads.hidden = false;
}

function renderMatrix(result) {
  const blockOrder = result.blocks.map((block) => block.id);
  const blockById = Object.fromEntries(result.blocks.map((block) => [block.id, block]));
  const pathByGenome = Object.fromEntries(result.paths.map((path) => [path.genome, path]));
  const template = blockOrder.map((blockId) => {
    const length = blockById[blockId].length;
    return `max(80px, calc(${length} * var(--base-width) + var(--cell-pad)))`;
  }).join(" ");

  els.matrix.innerHTML = "";
  const corner = div("corner", "Genome");
  els.matrix.appendChild(corner);

  const axis = div("axis");
  axis.style.gridTemplateColumns = template;
  blockOrder.forEach((blockId) => {
    const block = blockById[blockId];
    const button = blockButton("axis-block", block, result, pathByGenome);
    button.title = `${block.id} | ${block.length} bp`;
    button.innerHTML = `<span>${escapeHtml(shortBlockLabel(block.id))}</span><small>${block.length} bp</small>`;
    axis.appendChild(button);
  });
  els.matrix.appendChild(axis);

  result.paths.forEach((path) => {
    els.matrix.appendChild(div("genome-name", path.genome));
    const row = div("sequence-row");
    row.dataset.genome = path.genome;
    row.style.gridTemplateColumns = template;
    const pathBlocks = new Set(path.blocks);
    blockOrder.forEach((blockId) => {
      const block = blockById[blockId];
      if (pathBlocks.has(blockId)) {
        const button = blockButton("seq-block", block, result, pathByGenome);
        button.title = `${block.id} | ${block.length} bp`;
        button.innerHTML = `<code>${escapeHtml(block.sequence)}</code>`;
        row.appendChild(button);
      } else {
        const missing = div("seq-block missing");
        missing.title = `${block.id} absent in ${path.genome}`;
        missing.innerHTML = "<code>--</code>";
        row.appendChild(missing);
      }
    });
    els.matrix.appendChild(row);
  });
}

function renderGraph(result) {
  const blockOrder = result.blocks.map((block) => block.id);
  const blockById = Object.fromEntries(result.blocks.map((block) => [block.id, block]));
  const pathByGenome = Object.fromEntries(result.paths.map((path) => [path.genome, path]));
  const graphPaths = orderGraphPaths(result.paths);
  const genomeNames = graphPaths.map((path) => path.genome);
  const genomeIndex = Object.fromEntries(genomeNames.map((genome, index) => [genome, index]));
  const laneGap = 74;
  const topPad = 72;
  const bottomPad = 52;
  const leftPad = 178;
  const rightPad = 58;
  const nodeHeight = 48;
  const columnGap = 70;
  const centerY = topPad + ((genomeNames.length - 1) * laneGap) / 2;
  const laneY = (genome) => topPad + genomeIndex[genome] * laneGap;
  const graphHeight = topPad + (genomeNames.length - 1) * laneGap + bottomPad;
  const graphHeightLimit = graphHeight - bottomPad / 2;

  let cursorX = leftPad;
  const layout = {};
  blockOrder.forEach((blockId) => {
    const block = blockById[blockId];
    const width = clamp(block.length * 7 + 58, 92, 360);
    const isShared = block.genomes.length === result.genomes.length;
    const y = graphNodeY(block, result.genomes.length, genomeNames, laneY, centerY, laneGap, nodeHeight, graphHeightLimit);
    layout[blockId] = {
      x: cursorX,
      y,
      width,
      height: nodeHeight,
      isShared,
    };
    cursorX += width + columnGap;
  });

  const graphWidth = Math.max(cursorX - columnGap + rightPad, 760);
  els.graph.innerHTML = "";
  els.graph.style.setProperty("--graph-width", `${graphWidth}px`);
  els.graph.style.setProperty("--graph-height", `${graphHeight}px`);

  const canvas = div("graph-canvas");
  canvas.style.width = `${graphWidth}px`;
  canvas.style.height = `${graphHeight}px`;
  canvas.appendChild(renderGraphSvg(graphPaths, blockById, layout, genomeNames, laneY, graphWidth, graphHeight, leftPad));

  genomeNames.forEach((genome, index) => {
    const label = div("graph-lane-label", genome);
    label.style.top = `${laneY(genome)}px`;
    label.style.setProperty("--lane-color", genomeColor(index));
    canvas.appendChild(label);
  });

  blockOrder.forEach((blockId) => {
    const block = blockById[blockId];
    const box = layout[blockId];
    const button = blockButton("graph-node", block, result, pathByGenome);
    button.title = `${block.id} | ${block.length} bp | ${block.genomes.join(", ")}`;
    button.style.setProperty("--support-count", String(block.genomes.length || 1));
    button.style.left = `${box.x}px`;
    button.style.top = `${box.y - box.height / 2}px`;
    button.style.width = `${box.width}px`;
    button.style.height = `${box.height}px`;
    button.innerHTML = graphNodeMarkup(block, result.genomes.length, genomeNames);
    canvas.appendChild(button);
  });

  els.graph.appendChild(canvas);
}

function renderGraphSvg(graphPaths, blockById, layout, genomeNames, laneY, graphWidth, graphHeight, leftPad) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graph-svg");
  svg.setAttribute("viewBox", `0 0 ${graphWidth} ${graphHeight}`);
  svg.setAttribute("width", graphWidth);
  svg.setAttribute("height", graphHeight);
  svg.setAttribute("aria-hidden", "true");

  genomeNames.forEach((genome, index) => {
    const y = laneY(genome);
    const rail = svgElement("line", {
      class: "graph-lane-rail",
      x1: leftPad - 18,
      y1: y,
      x2: graphWidth - 32,
      y2: y,
    });
    svg.appendChild(rail);

  });

  const edgeCounts = {};
  graphPaths.forEach((path) => {
    path.blocks.slice(0, -1).forEach((sourceId, index) => {
      const key = edgeKey(sourceId, path.blocks[index + 1]);
      edgeCounts[key] = (edgeCounts[key] || 0) + 1;
    });
  });

  const edgePositions = {};
  graphPaths.forEach((path) => {
    const color = genomeColor(genomeNames.indexOf(path.genome));
    path.blocks.slice(0, -1).forEach((sourceId, index) => {
      const targetId = path.blocks[index + 1];
      const key = edgeKey(sourceId, targetId);
      const position = edgePositions[key] || 0;
      const total = edgeCounts[key] || 1;
      const offset = (position - (total - 1) / 2) * 7;
      edgePositions[key] = position + 1;
      const source = layout[sourceId];
      const target = layout[targetId];
      const sourceBlock = blockById[sourceId];
      const targetBlock = blockById[targetId];
      const x1 = source.x + source.width;
      const y1 = edgeEndpointY(path.genome, sourceBlock, source, genomeNames) + offset;
      const x2 = target.x;
      const y2 = edgeEndpointY(path.genome, targetBlock, target, genomeNames) + offset;
      const edge = svgElement("path", {
        class: "graph-edge",
        d: graphEdgePath(x1, y1, x2, y2, laneY(path.genome)),
        stroke: color,
      });
      svg.appendChild(edge);
    });
  });

  return svg;
}

function orderGraphPaths(paths) {
  const groups = [];
  const groupsBySignature = new Map();
  paths.forEach((path) => {
    const signature = path.blocks.join("|");
    if (!groupsBySignature.has(signature)) {
      const group = { signature, paths: [] };
      groupsBySignature.set(signature, group);
      groups.push(group);
    }
    groupsBySignature.get(signature).paths.push(path);
  });
  return groups.flatMap((group) => group.paths);
}

function edgeKey(sourceId, targetId) {
  return `${sourceId}->${targetId}`;
}

function graphNodeY(block, genomeCount, genomeNames, laneY, centerY, laneGap, nodeHeight, graphHeightLimit) {
  if (block.genomes.length === genomeCount) return centerY;

  const supportedY = block.genomes.map((genome) => laneY(genome));
  let y = supportedY.reduce((total, value) => total + value, 0) / supportedY.length;
  const supported = new Set(block.genomes);
  const crossesUnsupportedLane = genomeNames.some((genome) => {
    if (supported.has(genome)) return false;
    return Math.abs(laneY(genome) - y) < nodeHeight / 2 + 8;
  });

  if (!crossesUnsupportedLane) return y;

  const sortedIndexes = block.genomes
    .map((genome) => genomeNames.indexOf(genome))
    .sort((a, b) => a - b);
  const gaps = sortedIndexes.slice(0, -1)
    .map((index, gapIndex) => [index, sortedIndexes[gapIndex + 1]])
    .filter(([start, end]) => end - start > 1);

  if (gaps.length) {
    const minY = Math.min(...supportedY);
    const maxY = Math.max(...supportedY);
    const below = maxY + laneGap / 2;
    const above = minY - laneGap / 2;
    y = below + nodeHeight / 2 <= graphHeightLimit ? below : above;
  } else {
    const direction = y <= centerY ? -1 : 1;
    y += direction * Math.min(26, laneGap / 3);
  }
  return y;
}

function edgeEndpointY(genome, block, box, genomeNames) {
  const supportedGenomes = block.genomes
    .slice()
    .sort((a, b) => genomeNames.indexOf(a) - genomeNames.indexOf(b));
  const index = Math.max(0, supportedGenomes.indexOf(genome));
  const slotGap = Math.min(14, box.height / Math.max(3, supportedGenomes.length + 1));
  return box.y + (index - (supportedGenomes.length - 1) / 2) * slotGap;
}

function graphEdgePath(x1, y1, x2, y2, laneCenterY) {
  const distance = x2 - x1;
  if (distance < 210) {
    const bend = Math.max(36, Math.min(128, distance * 0.52));
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  const shoulder = Math.min(72, Math.max(42, distance * 0.18));
  const laneY = laneCenterY;
  return [
    `M ${x1} ${y1}`,
    `C ${x1 + shoulder * 0.45} ${y1}, ${x1 + shoulder * 0.55} ${laneY}, ${x1 + shoulder} ${laneY}`,
    `L ${x2 - shoulder} ${laneY}`,
    `C ${x2 - shoulder * 0.55} ${laneY}, ${x2 - shoulder * 0.45} ${y2}, ${x2} ${y2}`,
  ].join(" ");
}

function graphNodeMarkup(block, genomeCount, genomeNames) {
  const sequencePreview = block.sequence.length > 28 ? `${block.sequence.slice(0, 25)}...` : block.sequence;
  const support = block.genomes.length === genomeCount ? "core" : `${block.genomes.length}/${genomeCount}`;
  const supportColors = block.genomes.map((genome) => genomeColor(genomeNames.indexOf(genome)));
  return `
    <span class="node-port-rail" aria-hidden="true">${supportColors.map((color) => `<i style="background: ${escapeHtml(color)}"></i>`).join("")}</span>
    <span class="node-id">${escapeHtml(shortBlockLabel(block.id))}</span>
    <code>${escapeHtml(sequencePreview)}</code>
    <span class="node-meta">${block.length} bp | ${escapeHtml(support)}</span>
  `;
}

function svgElement(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function genomeColor(index) {
  const colors = ["#2563eb", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#475569"];
  return colors[index % colors.length];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function blockButton(baseClass, block, result, pathByGenome) {
  const support = block.genomes.length;
  const type = support === result.genomes.length ? "shared" : "variable";
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${baseClass} ${type === "shared" ? "shared" : "variant"}`;
  button.dataset.block = block.id;
  button.dataset.length = block.length;
  button.dataset.type = type;
  button.dataset.support = `${support}/${result.genomes.length}`;
  button.dataset.genomes = block.genomes.join(",");
  button.dataset.sequence = block.sequence;
  button.dataset.coordinates = block.genomes.map((genome) => {
    const coords = pathByGenome[genome].coordinates[block.id];
    return `${genome}:${coords.start}-${coords.end}`;
  }).join("; ");
  button.addEventListener("click", () => showDetails(button));
  return button;
}

function showDetails(button) {
  els.detail.block.textContent = button.dataset.block;
  els.detail.type.textContent = button.dataset.type === "shared" ? "Shared sequence block" : "Variable sequence block";
  els.detail.length.textContent = `${button.dataset.length} bp`;
  els.detail.support.textContent = button.dataset.support;
  els.detail.genomes.textContent = button.dataset.genomes || "none";
  els.detail.coordinates.innerHTML = "";
  (button.dataset.coordinates || "").split(";").map((item) => item.trim()).filter(Boolean).forEach((coordinate) => {
    const [genome, range] = coordinate.split(":");
    const item = document.createElement("li");
    item.innerHTML = `<strong>${escapeHtml(genome)}</strong><span>${escapeHtml(range)}</span>`;
    els.detail.coordinates.appendChild(item);
  });
  els.detail.sequence.value = button.dataset.sequence || "";
  els.detailsEmpty.hidden = true;
  els.detailsContent.hidden = false;
}

async function copySequence() {
  await navigator.clipboard.writeText(els.detail.sequence.value);
  els.copy.textContent = "Copied";
  setTimeout(() => {
    els.copy.textContent = "Copy sequence";
  }, 900);
}

function handleDownload(event) {
  const key = event.target?.dataset?.download;
  if (!key || !state.result) return;
  const extension = key === "gfa" ? "gfa" : "tsv";
  downloadText(`phage-seq-pvg.${extension}`, state.result[key]);
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function div(className, text = "") {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortBlockLabel(blockId) {
  const match = String(blockId).match(/^SB_0*(\d+)$/);
  return match ? match[1] : blockId;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function paintBusyState() {
  await nextFrame();
  await nextFrame();
  await delay(30);
}

function waitForMinimumBusyTime(startedAt, minimumMs) {
  const remaining = minimumMs - (performance.now() - startedAt);
  return remaining > 0 ? delay(remaining) : Promise.resolve();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
