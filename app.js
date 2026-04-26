import { runSimulation } from './simulator.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const inputEl          = document.getElementById('instructions-input');
const errorMsgEl       = document.getElementById('error-message');
const stagesSelect     = document.getElementById('stages-select');
const fwdToggle        = document.getElementById('forwarding-toggle');

const btnRun           = document.getElementById('btn-run');
const btnStep          = document.getElementById('btn-step');
const btnReset         = document.getElementById('btn-reset');
const btnAddInstr      = document.getElementById('btn-add-instr');
const btnClearInstr    = document.getElementById('btn-clear-instr');
const instructionList  = document.getElementById('instruction-list');

const simulatorView      = document.getElementById('simulator-view');
const mainTableTitle     = document.getElementById('main-table-title');
const mainTableContainer = document.getElementById('main-table');
const eventLogContainer  = document.getElementById('event-log');
const statsBar           = document.getElementById('stats-bar');

// ── State ─────────────────────────────────────────────────────────────────────
let currentSimResult  = null;
let baselineStalls    = null;   // stall count without forwarding (for comparison)
let stepCycle  = 0;
let maxCycles  = 0;
let isStepMode = false;

const MAX_INSTRUCTIONS = 10;

// ── Instruction Builder ───────────────────────────────────────────────────────
function addInstructionRow(data = { op: 'ADD', r1: '', r2: '', r3: '' }) {
    if (instructionList.children.length >= MAX_INSTRUCTIONS) {
        showError(`Maximum of ${MAX_INSTRUCTIONS} instructions allowed.`);
        return;
    }

    const row = document.createElement('div');
    row.className = 'instruction-row';
    row.innerHTML = `
        <select class="instr-op">
            <option value="ADD"  ${data.op === 'ADD'  ? 'selected' : ''}>ADD</option>
            <option value="SUB"  ${data.op === 'SUB'  ? 'selected' : ''}>SUB</option>
            <option value="LW"   ${data.op === 'LW'   ? 'selected' : ''}>LW</option>
            <option value="SW"   ${data.op === 'SW'   ? 'selected' : ''}>SW</option>
        </select>
        <input type="text" class="instr-r1" placeholder="R1" value="${data.r1}">
        <input type="text" class="instr-r2" placeholder="R2" value="${data.r2}">
        <input type="text" class="instr-r3" placeholder="R3/0(R)" value="${data.r3}">
        <button class="btn-remove" title="Remove">×</button>
    `;

    row.querySelector('.btn-remove').addEventListener('click', () => {
        row.remove();
        syncToTextarea();
    });
    row.querySelectorAll('input, select').forEach(el => el.addEventListener('input', syncToTextarea));

    instructionList.appendChild(row);
    syncToTextarea();
}

function clearAllInstructions() {
    instructionList.innerHTML = '';
    inputEl.value = '';
    clearError();
}

function syncToTextarea() {
    const lines = [];
    instructionList.querySelectorAll('.instruction-row').forEach(row => {
        const op = row.querySelector('.instr-op').value;
        const r1 = row.querySelector('.instr-r1').value.trim();
        const r2 = row.querySelector('.instr-r2').value.trim();
        const r3 = row.querySelector('.instr-r3').value.trim();

        if (op === 'LW' || op === 'SW') {
            lines.push(`${op} ${r1}, ${r2}(${r3})`);
        } else {
            lines.push(`${op} ${r1}, ${r2}, ${r3}`);
        }
    });
    inputEl.value = lines.join('\n');
}

function syncFromTextarea() {
    const text = inputEl.value.trim();
    instructionList.innerHTML = '';
    if (!text) return;

    text.split('\n').forEach(line => {
        if (instructionList.children.length >= MAX_INSTRUCTIONS) return;
        const parts = line.replace(/,/g, ' ').replace(/\(/g, ' ').replace(/\)/g, ' ').split(/\s+/).filter(p => p);
        if (parts.length >= 2) {
            addInstructionRow({
                op: parts[0].toUpperCase(),
                r1: parts[1] || '',
                r2: parts[2] || '',
                r3: parts[3] || ''
            });
        }
    });
}

// ── Error helpers ─────────────────────────────────────────────────────────────
function clearError() {
    inputEl.classList.remove('error');
    errorMsgEl.classList.add('hidden');
    btnRun.disabled  = false;
    btnStep.disabled = false;
}

function showError(msg) {
    inputEl.classList.add('error');
    errorMsgEl.textContent = msg;
    errorMsgEl.classList.remove('hidden');
    btnRun.disabled  = true;
    btnStep.disabled = true;
    simulatorView.classList.add('hidden');
}

// ── Config ────────────────────────────────────────────────────────────────────
function getConfig() {
    return {
        stages: stagesSelect.value === '5-stage' ? 5 : 4,
        forwardingEnabled: fwdToggle.checked,
        branchStrategy: 'predict-not-taken'   // fixed; branch prediction UI removed
    };
}

// ── Run / Step / Reset ────────────────────────────────────────────────────────
function runFullSimulation() {
    const text = inputEl.value.trim();
    if (!text) { showError('Please enter at least one instruction.'); return; }

    try {
        const cfg = getConfig();
        currentSimResult = runSimulation(text, cfg);

        // compute baseline (no forwarding) so we can show stall savings
        if (cfg.forwardingEnabled) {
            const base = runSimulation(text, { ...cfg, forwardingEnabled: false });
            baselineStalls = base.stallCount;
        } else {
            baselineStalls = null;
        }

        isStepMode = false;
        maxCycles  = currentSimResult.totalCycles;
        stepCycle  = maxCycles;
        renderUI();
    } catch (e) {
        showError(e.message);
    }
}

function handleStep() {
    if (!isStepMode) {
        const text = inputEl.value.trim();
        if (!text) { showError('Please enter at least one instruction.'); return; }

        try {
            const cfg = getConfig();
            currentSimResult = runSimulation(text, cfg);

            if (cfg.forwardingEnabled) {
                const base = runSimulation(text, { ...cfg, forwardingEnabled: false });
                baselineStalls = base.stallCount;
            } else {
                baselineStalls = null;
            }

            isStepMode = true;
            maxCycles  = currentSimResult.totalCycles;
            stepCycle  = 1;
            setInputsDisabled(true);
        } catch (e) {
            showError(e.message);
            return;
        }
    } else {
        stepCycle++;
    }

    btnStep.textContent = stepCycle >= maxCycles ? 'Done' : `Next (${stepCycle}/${maxCycles})`;
    if (stepCycle >= maxCycles) btnStep.disabled = true;

    renderUI(true);
}

function handleReset() {
    currentSimResult = null;
    isStepMode = false;
    stepCycle  = 0;
    maxCycles  = 0;

    simulatorView.classList.add('hidden');
    clearError();
    setInputsDisabled(false);
    btnStep.textContent = 'Step';
}

function setInputsDisabled(disabled) {
    [btnRun, inputEl, stagesSelect, fwdToggle,
     btnAddInstr, btnClearInstr].forEach(el => el.disabled = disabled);
    instructionList.querySelectorAll('input, select, button').forEach(el => el.disabled = disabled);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderUI(stepByStep = false) {
    simulatorView.classList.remove('hidden');

    const limitCycle = stepByStep ? stepCycle : null;
    const fwd = fwdToggle.checked;

    // Table title
    mainTableTitle.classList.remove('hidden');
    mainTableTitle.textContent = fwd
        ? 'Pipeline Execution — Forwarding Enabled'
        : 'Pipeline Execution — Stall Only';

    // Stats bar
    renderStats();

    mainTableContainer.innerHTML = generateTableHTML(currentSimResult, limitCycle);
    renderLogs(currentSimResult.hazards, stepByStep ? stepCycle : maxCycles);
    attachHoverListeners();
}

function renderStats() {
    if (!statsBar) return;
    const { stallCount, fwdCount, totalCycles } = currentSimResult;
    const fwd = fwdToggle.checked;

    let html = `<span class="stat">Total Cycles: <strong>${totalCycles}</strong></span>`;
    html    += `<span class="stat stat-stall">Stalls: <strong>${stallCount}</strong></span>`;

    if (fwd) {
        html += `<span class="stat stat-fwd">Forwarded: <strong>${fwdCount}</strong></span>`;
        if (baselineStalls !== null) {
            const saved = baselineStalls - stallCount;
            if (saved > 0)
                html += `<span class="stat stat-saved">▼ ${saved} stall${saved > 1 ? 's' : ''} saved vs stall-only</span>`;
            else
                html += `<span class="stat stat-saved">No stalls eliminated (load-use only)</span>`;
        }
    }
    statsBar.innerHTML = html;
    statsBar.classList.remove('hidden');
}

function generateTableHTML(simResult, limitCycle) {
    const totalCycles = limitCycle ?? simResult.totalCycles;

    let html = '<table><thead><tr><th>Instruction</th>';
    for (let c = 1; c <= totalCycles; c++) {
        html += `<th class="${c === limitCycle ? 'active-col' : ''}">Cycle ${c}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (let i = 0; i < simResult.instructions.length; i++) {
        const instr = simResult.instructions[i];
        const deps  = findDependencies(i, simResult.instructions);

        html += `<tr class="row-instr row-idx-${i}" data-idx="${i}" data-src="${deps.join(',')}">`;
        html += `<td class="instr-col">I${i + 1}: ${instr.raw}</td>`;

        const rowData = simResult.table[i];
        for (let c = 1; c <= totalCycles; c++) {
            const cell = rowData.find(x => x.cycle === c);
            if (!cell || cell.type === 'empty') {
                html += `<td class="${c === limitCycle ? 'active-col' : ''}"></td>`;
            } else {
                const cls        = `cell-${cell.type}`;
                const activeClass = c === limitCycle ? 'active-col' : '';
                const tip        = cell.tooltip ? `data-tooltip="${cell.tooltip}"` : '';
                html += `<td class="${cls} ${activeClass}" ${tip}>${cell.label}</td>`;
            }
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function renderLogs(hazards, currentCycle) {
    eventLogContainer.innerHTML = '';

    const visible = currentCycle
        ? hazards.filter(h => {
            const m = h.msg.match(/Cycle (\d+)/);
            return m ? parseInt(m[1]) <= currentCycle : true;
          })
        : hazards;

    if (visible.length === 0) {
        eventLogContainer.innerHTML = '<div class="log-entry log-ok">✓ No hazards detected.</div>';
        return;
    }
    visible.forEach(h => {
        const div = document.createElement('div');
        // color by kind: 'fwd' = green, 'stall' = red/dim (default)
        div.className = h.kind === 'fwd' ? 'log-entry log-fwd' : 'log-entry log-stall';
        div.textContent = (h.kind === 'fwd' ? '⟶ ' : '⚠ ') + h.msg;
        eventLogContainer.appendChild(div);
    });
}

function findDependencies(i, instructions) {
    const curr = instructions[i];
    if (!curr.src) return [];
    return instructions
        .slice(0, i)
        .map((ins, j) => (ins.dest && curr.src.includes(ins.dest) ? j : -1))
        .filter(j => j !== -1);
}

function attachHoverListeners() {
    document.querySelectorAll('td.cell-stage, td.cell-stall, td.cell-fwd').forEach(cell => {
        cell.addEventListener('mouseenter', e => {
            const tr  = e.target.closest('tr');
            const idx = tr.getAttribute('data-idx');
            const srcs = tr.getAttribute('data-src');
            tr.classList.add('highlighted-row');
            if (srcs) srcs.split(',').forEach(p => {
                if (p !== '') document.querySelectorAll(`.row-idx-${p}`).forEach(r => r.classList.add('highlighted-row'));
            });
            document.querySelectorAll('tr.row-instr').forEach(r => {
                if ((r.getAttribute('data-src') || '').split(',').includes(idx))
                    r.classList.add('highlighted-row');
            });
        });
        cell.addEventListener('mouseleave', () =>
            document.querySelectorAll('tr.highlighted-row').forEach(r => r.classList.remove('highlighted-row'))
        );
    });
}

// ── Event Listeners ───────────────────────────────────────────────────────────
btnRun.addEventListener('click', runFullSimulation);
btnStep.addEventListener('click', handleStep);
btnReset.addEventListener('click', handleReset);
btnAddInstr.addEventListener('click', () => addInstructionRow());
btnClearInstr.addEventListener('click', clearAllInstructions);
inputEl.addEventListener('input', () => { clearError(); syncFromTextarea(); });

// ── Seed initial rows ─────────────────────────────────────────────────────────
addInstructionRow({ op: 'ADD', r1: 'R1', r2: 'R2', r3: 'R3' });
addInstructionRow({ op: 'SUB', r1: 'R4', r2: 'R1', r3: 'R5' });
addInstructionRow({ op: 'LW',  r1: 'R6', r2: '0',  r3: 'R1' });