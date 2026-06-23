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
  sample: document.querySelector("#sample-button"),
  summary: document.querySelector("#summary"),
  downloads: document.querySelector("#downloads"),
  matrix: document.querySelector("#matrix"),
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
  els.sample.addEventListener("click", loadSampleFiles);
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

async function loadSampleFiles() {
  const names = ["phage_a.fasta", "phage_b.fasta", "phage_c.fasta"];
  state.files = await Promise.all(
    names.map(async (name) => ({
      name,
      content: await fetch(`examples/${name}`).then((response) => response.text()),
    })),
  );
  renderFileList();
  updateReferenceOptions("phage_a");
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
