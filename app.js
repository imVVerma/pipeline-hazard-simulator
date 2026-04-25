import { runSimulation } from './simulator.js';

// DOM Elements
const inputEl = document.getElementById('instructions-input');
const errorMsgEl = document.getElementById('error-message');
const stagesSelect = document.getElementById('stages-select');
const branchStrategySelect = document.getElementById('branch-strategy');
const fwdToggle = document.getElementById('forwarding-toggle');
const compareToggle = document.getElementById('compare-toggle');

const exampleSelect = document.getElementById('example-select');
const btnRun = document.getElementById('btn-run');
const btnStep = document.getElementById('btn-step');
const btnReset = document.getElementById('btn-reset');

const btnAddInstr = document.getElementById('btn-add-instr');
const btnClearInstr = document.getElementById('btn-clear-instr');
const instructionList = document.getElementById('instruction-list');

const simulatorView = document.getElementById('simulator-view');
const mainTableContainer = document.getElementById('main-table');
const mainTableTitle = document.getElementById('main-table-title');
const compareTableWrapper = document.getElementById('compare-table-wrapper');
const compareTableContainer = document.getElementById('compare-table');
const compareSummary = document.getElementById('compare-summary');
const eventLogContainer = document.getElementById('event-log');

// State
let currentSimResult = null;
let currentCompareResult = null;
let stepCycle = 0;
let maxCycles = 0;
let isStepMode = false;

const MAX_INSTRUCTIONS = 10;

// Event Listeners
btnRun.addEventListener('click', runFullSimulation);
btnStep.addEventListener('click', handleStep);
btnReset.addEventListener('click', handleReset);
btnAddInstr.addEventListener('click', () => addInstructionRow());
btnClearInstr.addEventListener('click', clearAllInstructions);
inputEl.addEventListener('input', () => {
    clearError();
    syncFromTextarea();
});

exampleSelect.addEventListener('change', (e) => {
    if (e.target.value && examples[e.target.value]) {
        inputEl.value = examples[e.target.value];
        syncFromTextarea();
        clearError();
    }
    e.target.value = '';
});

// Examples using R-registers
const examples = {
  'raw-1': `ADD R1, R2, R3\nSUB R4, R1, R5\nAND R6, R1, R7`,
  'raw-2': `ADD R1, R2, R3\nSUB R4, R1, R5\nOR R6, R4, R1\nXOR R7, R6, R4`,
  'load-use-1': `LW R1, 0(R2)\nADD R3, R1, R4`,
  'load-use-2': `LW R1, 0(R2)\nSUB R5, R6, R7\nADD R3, R1, R4`,
  'control-1': `BEQ R1, R2, target\nADD R3, R4, R5\ntarget:\nSUB R6, R7, R8`,
};

function addInstructionRow(data = { op: 'ADD', r1: '', r2: '', r3: '' }) {
    const rowCount = instructionList.children.length;
    if (rowCount >= MAX_INSTRUCTIONS) {
        showError(`Maximum of ${MAX_INSTRUCTIONS} instructions allowed.`);
        return;
    }

    const row = document.createElement('div');
    row.className = 'instruction-row';
    row.innerHTML = `
        <select class="instr-op">
            <option value="ADD" ${data.op === 'ADD' ? 'selected' : ''}>ADD</option>
            <option value="SUB" ${data.op === 'SUB' ? 'selected' : ''}>SUB</option>
            <option value="LW" ${data.op === 'LW' ? 'selected' : ''}>LW</option>
            <option value="SW" ${data.op === 'SW' ? 'selected' : ''}>SW</option>
            <option value="BEQ" ${data.op === 'BEQ' ? 'selected' : ''}>BEQ</option>
            <option value="BNE" ${data.op === 'BNE' ? 'selected' : ''}>BNE</option>
        </select>
        <input type="text" class="instr-r1" placeholder="R1" value="${data.r1}">
        <input type="text" class="instr-r2" placeholder="R2" value="${data.r2}">
        <input type="text" class="instr-r3" placeholder="R3" value="${data.r3}">
        <button class="btn-remove">×</button>
    `;

    row.querySelector('.btn-remove').addEventListener('click', () => {
        row.remove();
        syncToTextarea();
    });

    row.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', syncToTextarea);
    });

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
    const rows = instructionList.querySelectorAll('.instruction-row');
    rows.forEach(row => {
        const op = row.querySelector('.instr-op').value;
        const r1 = row.querySelector('.instr-r1').value.trim();
        const r2 = row.querySelector('.instr-r2').value.trim();
        const r3 = row.querySelector('.instr-r3').value.trim();
        
        if (op === 'LW' || op === 'SW') {
            lines.push(`${op} ${r1}, ${r2}(${r3})`);
        } else if (op === 'BEQ' || op === 'BNE') {
            lines.push(`${op} ${r1}, ${r2}, ${r3}`);
        } else {
            lines.push(`${op} ${r1}, ${r2}, ${r3}`);
        }
    });
    inputEl.value = lines.join('\n');
}

function syncFromTextarea() {
    // Basic sync back to visual rows (optional, but good for when examples are loaded)
    const text = inputEl.value.trim();
    if (!text) {
        instructionList.innerHTML = '';
        return;
    }

    const lines = text.split('\n');
    instructionList.innerHTML = '';
    
    lines.forEach(line => {
        if (instructionList.children.length >= MAX_INSTRUCTIONS) return;
        
        const parts = line.replace(/,/g, ' ').replace(/\(/g, ' ').replace(/\)/g, ' ').split(/\s+/).filter(p => p);
        if (parts.length >= 2) {
            const op = parts[0].toUpperCase();
            const r1 = parts[1] || '';
            const r2 = parts[2] || '';
            const r3 = parts[3] || '';
            addInstructionRow({ op, r1, r2, r3 });
        }
    });
}

function clearError() {
    inputEl.classList.remove('error');
    errorMsgEl.classList.add('hidden');
    btnRun.disabled = false;
    btnStep.disabled = false;
}

function showError(msg) {
    inputEl.classList.add('error');
    errorMsgEl.textContent = msg;
    errorMsgEl.classList.remove('hidden');
    btnRun.disabled = true;
    btnStep.disabled = true;
    simulatorView.classList.add('hidden');
}

function getConfig(forceForwardingState = null) {
    const val = stagesSelect.value;
    const branchStrat = branchStrategySelect.value;
    return {
        stages: val === '5-stage' ? 5 : 4,
        forwardingEnabled: forceForwardingState !== null ? forceForwardingState : fwdToggle.checked,
        branchStrategy: branchStrat
    };
}

function runFullSimulation() {
    try {
        const text = inputEl.value;
        if (!text.trim()) {
            showError("Please enter at least one instruction.");
            return;
        }
        
        const config = getConfig();
        currentSimResult = runSimulation(text, config);
        
        if (compareToggle.checked) {
            currentCompareResult = runSimulation(text, { ...config, forwardingEnabled: !config.forwardingEnabled });
        } else {
            currentCompareResult = null;
        }
        
        isStepMode = false;
        maxCycles = Math.max(currentSimResult.totalCycles, currentCompareResult ? currentCompareResult.totalCycles : 0);
        stepCycle = maxCycles; 
        
        renderUI();
    } catch (e) {
        showError(e.message);
    }
}

function handleStep() {
    if (!isStepMode) {
        try {
            const text = inputEl.value;
            if (!text.trim()) {
                showError("Please enter at least one instruction.");
                return;
            }
            const config = getConfig();
            currentSimResult = runSimulation(text, config);
            
            if (compareToggle.checked) {
                currentCompareResult = runSimulation(text, { ...config, forwardingEnabled: !config.forwardingEnabled });
            } else {
                currentCompareResult = null;
            }
            
            isStepMode = true;
            maxCycles = Math.max(currentSimResult.totalCycles, currentCompareResult ? currentCompareResult.totalCycles : 0);
            stepCycle = 1;
            disableInputs(true);
            
        } catch(e) {
            showError(e.message);
            return;
        }
    } else {
        stepCycle++;
    }
    
    if (stepCycle >= maxCycles) {
        btnStep.textContent = "Done";
        btnStep.disabled = true;
    } else {
        btnStep.textContent = `Next cycle (${stepCycle}/${maxCycles})`;
    }
    
    renderUI(true);
}

function disableInputs(disabled) {
    btnRun.disabled = disabled;
    inputEl.disabled = disabled;
    stagesSelect.disabled = disabled;
    branchStrategySelect.disabled = disabled;
    fwdToggle.disabled = disabled;
    compareToggle.disabled = disabled;
    btnAddInstr.disabled = disabled;
    btnClearInstr.disabled = disabled;
    instructionList.querySelectorAll('input, select, button').forEach(el => el.disabled = disabled);
}

function handleReset() {
    currentSimResult = null;
    currentCompareResult = null;
    isStepMode = false;
    stepCycle = 0;
    maxCycles = 0;
    
    simulatorView.classList.add('hidden');
    clearError();
    disableInputs(false);
    btnStep.textContent = "Step";
}

function renderUI(stepByStep = false) {
    simulatorView.classList.remove('hidden');
    
    mainTableContainer.innerHTML = generateTableHTML(currentSimResult, stepByStep ? stepCycle : null);
    
    if (currentCompareResult && compareToggle.checked) {
        compareTableWrapper.classList.remove('hidden');
        compareTableContainer.innerHTML = generateTableHTML(currentCompareResult, stepByStep ? stepCycle : null);
        
        compareSummary.classList.remove('hidden');
        let d1 = currentSimResult.totalCycles;
        let d2 = currentCompareResult.totalCycles;
        let diff = Math.abs(d1 - d2);
        
        compareSummary.textContent = fwdToggle.checked 
            ? `With forwarding: ${d1} cycles. Without: ${d2} cycles. ${diff} cycles saved.`
            : `Without forwarding: ${d1} cycles. With: ${d2} cycles. ${diff} cycles saved.`;
    } else {
        compareTableWrapper.classList.add('hidden');
        compareSummary.classList.add('hidden');
    }
    
    renderLogs(currentSimResult.hazards, stepByStep ? stepCycle : maxCycles);
    attachHoverListeners();
}

function generateTableHTML(simResult, limitCycle) {
    const totalCycles = limitCycle ? limitCycle : simResult.totalCycles;
    
    let html = '<table><thead><tr><th>Instruction</th>';
    for (let c = 1; c <= totalCycles; c++) {
        html += `<th class="${c === limitCycle ? 'active-col' : ''}">${c}</th>`;
    }
    html += '</tr></thead><tbody>';
    
    for (let i = 0; i < simResult.instructions.length; i++) {
        let instr = simResult.instructions[i];
        let deps = findDependencies(i, simResult.instructions);
        
        html += `<tr class="row-instr row-idx-${i}" data-idx="${i}" data-src="${deps.join(',')}">`;
        html += `<td class="instr-col">${instr.raw}</td>`;
        
        let rowData = simResult.table[i];
        for (let c = 1; c <= totalCycles; c++) {
            let cell = rowData.find(x => x.cycle === c);
            if (!cell || cell.type === 'empty') {
                html += `<td class="${c === limitCycle ? 'active-col' : ''}"></td>`;
            } else {
                let cellClass = `cell-${cell.type}`;
                let tooltipAttr = cell.tooltip ? `data-tooltip="${cell.tooltip}"` : '';
                html += `<td class="${cellClass} ${c === limitCycle ? 'active-col' : ''}" ${tooltipAttr}>${cell.label}</td>`;
            }
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function renderLogs(hazards, currentCycle) {
    eventLogContainer.innerHTML = '';
    let validHazards = currentCycle ? hazards.filter(h => {
        let match = h.msg.match(/Cycle (\d+)/);
        return match ? parseInt(match[1]) <= currentCycle : true;
    }) : hazards;
    
    if (validHazards.length === 0) {
        eventLogContainer.innerHTML = '<div class="log-entry">No hazards detected.</div>';
        return;
    }
    
    validHazards.forEach(h => {
        let div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = h.msg;
        eventLogContainer.appendChild(div);
    });
}

function findDependencies(i, instructions) {
    let deps = [];
    let curr = instructions[i];
    if (!curr.src) return deps;
    for (let j = 0; j < i; j++) {
        if (instructions[j].dest && curr.src.includes(instructions[j].dest)) deps.push(j);
    }
    return deps;
}

function attachHoverListeners() {
    document.querySelectorAll('td.cell-stage, td.cell-stall, td.cell-fwd').forEach(cell => {
        cell.addEventListener('mouseenter', e => {
            const tr = e.target.closest('tr');
            const idx = tr.getAttribute('data-idx');
            const srcs = tr.getAttribute('data-src');
            tr.classList.add('highlighted-row');
            if (srcs) srcs.split(',').forEach(p => { if(p!=="") document.querySelectorAll(`.row-idx-${p}`).forEach(r => r.classList.add('highlighted-row'))});
            document.querySelectorAll('tr.row-instr').forEach(r => {
                let rSrcs = r.getAttribute('data-src');
                if (rSrcs && rSrcs.split(',').includes(idx)) r.classList.add('highlighted-row');
            });
        });
        cell.addEventListener('mouseleave', () => document.querySelectorAll('tr.highlighted-row').forEach(r => r.classList.remove('highlighted-row')));
    });
}

// Initial instructions
syncFromTextarea();
if (instructionList.children.length === 0) {
    addInstructionRow({ op: 'ADD', r1: 'R1', r2: 'R2', r3: 'R3' });
    addInstructionRow({ op: 'SUB', r1: 'R4', r2: 'R1', r3: 'R5' });
    addInstructionRow({ op: 'LW', r1: 'R6', r2: '0', r3: 'R1' });
}