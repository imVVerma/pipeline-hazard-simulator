import { runSimulation } from './simulator.js';

// DOM Elements
const inputEl = document.getElementById('instructions-input');
const errorMsgEl = document.getElementById('error-message');
const stagesSelect = document.getElementById('stages-select');
const fwdToggle = document.getElementById('forwarding-toggle');
const compareToggle = document.getElementById('compare-toggle');

const btnRun = document.getElementById('btn-run');
const btnStep = document.getElementById('btn-step');
const btnReset = document.getElementById('btn-reset');

const simulatorView = document.getElementById('simulator-view');
const mainTableWrapper = document.getElementById('main-table-wrapper');
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

// Event Listeners
btnRun.addEventListener('click', runFullSimulation);
btnStep.addEventListener('click', handleStep);
btnReset.addEventListener('click', handleReset);
inputEl.addEventListener('input', clearError);

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
    return {
        stages: val === '5-stage' ? 5 : 4,
        forwardingEnabled: forceForwardingState !== null ? forceForwardingState : fwdToggle.checked
    };
}

function runFullSimulation() {
    try {
        const text = inputEl.value;
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
        // Init step mode
        try {
            const text = inputEl.value;
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
            btnRun.disabled = true;
            inputEl.disabled = true;
            stagesSelect.disabled = true;
            fwdToggle.disabled = true;
            compareToggle.disabled = true;
            
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

function handleReset() {
    currentSimResult = null;
    currentCompareResult = null;
    isStepMode = false;
    stepCycle = 0;
    maxCycles = 0;
    
    simulatorView.classList.add('hidden');
    clearError();
    
    inputEl.disabled = false;
    stagesSelect.disabled = false;
    fwdToggle.disabled = false;
    compareToggle.disabled = false;
    
    btnRun.disabled = false;
    btnStep.disabled = false;
    btnStep.textContent = "Step";
}

function renderUI(stepByStep = false) {
    simulatorView.classList.remove('hidden');
    
    // Render main table
    mainTableTitle.classList.remove('hidden');
    mainTableTitle.textContent = compareToggle.checked ? (fwdToggle.checked ? "With Forwarding" : "Without Forwarding") : "Simulation Result";
    
    mainTableContainer.innerHTML = generateTableHTML(currentSimResult, stepByStep ? stepCycle : null);
    
    // Render compare table
    if (currentCompareResult && compareToggle.checked) {
        compareTableWrapper.classList.remove('hidden');
        compareTableContainer.innerHTML = generateTableHTML(currentCompareResult, stepByStep ? stepCycle : null);
        
        compareSummary.classList.remove('hidden');
        let d1 = currentSimResult.totalCycles;
        let d2 = currentCompareResult.totalCycles;
        let diff = Math.abs(d1 - d2);
        
        if (fwdToggle.checked) {
           compareSummary.textContent = `With forwarding: ${d1} cycles. Without: ${d2} cycles. ${diff} cycles saved.`;
        } else {
           compareSummary.textContent = `Without forwarding: ${d1} cycles. With forwarding: ${d2} cycles. ${diff} cycles saved.`;
        }
    } else {
        compareTableWrapper.classList.add('hidden');
        compareSummary.classList.add('hidden');
    }
    
    // Render Logs (up to current stepCycle if stepping)
    renderLogs(currentSimResult.hazards, stepByStep ? stepCycle : maxCycles);
    
    attachHoverListeners();
}

function generateTableHTML(simResult, limitCycle) {
    const totalCycles = limitCycle ? limitCycle : simResult.totalCycles;
    
    let html = '<table><thead><tr>';
    html += '<th>Instruction</th>';
    for (let c = 1; c <= totalCycles; c++) {
        html += `<th class="${c === limitCycle ? 'active-col' : ''}">${c}</th>`;
    }
    html += '</tr></thead><tbody>';
    
    for (let i = 0; i < simResult.instructions.length; i++) {
        let instr = simResult.instructions[i];
        let deps = findDependencies(i, simResult.instructions);
        
        let rowClass = `row-instr row-idx-${i}`;
        html += `<tr class="${rowClass}" data-idx="${i}" data-src="${deps.join(',')}">`;
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
    
    let validHazards = hazards;
    if (currentCycle) {
        validHazards = hazards.filter(h => {
            let match = h.msg.match(/Cycle (\d+)/);
            if (match) return parseInt(match[1]) <= currentCycle;
            return true;
        });
    }
    
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
    // Return array of instruction indices that instruction i depends on heavily
    let deps = [];
    let curr = instructions[i];
    if (!curr.src) return deps;
    
    for (let j = 0; j < i; j++) {
        let prev = instructions[j];
        if (prev.dest && curr.src.includes(prev.dest)) {
            deps.push(j);
        }
    }
    return deps;
}

function attachHoverListeners() {
    const tableCells = document.querySelectorAll('td.cell-stage, td.cell-stall, td.cell-fwd');
    
    tableCells.forEach(cell => {
        cell.addEventListener('mouseenter', e => {
            const tr = e.target.closest('tr');
            if (!tr) return;
            
            const idx = tr.getAttribute('data-idx');
            const srcs = tr.getAttribute('data-src');
            
            // Highlight this row
            tr.classList.add('highlighted-row');
            
            // Highlight source rows
            if (srcs) {
                let srcArray = srcs.split(',');
                srcArray.forEach(parentIdx => {
                    if(parentIdx !== "") {
                        document.querySelectorAll(`.row-idx-${parentIdx}`).forEach(r => r.classList.add('highlighted-row'));
                    }
                });
            }
            
            // Highlight dependent rows (where their src matches this idx)
            document.querySelectorAll('tr.row-instr').forEach(r => {
                let rSrcs = r.getAttribute('data-src');
                if (rSrcs) {
                    if (rSrcs.split(',').includes(idx)) {
                        r.classList.add('highlighted-row');
                    }
                }
            });
        });
        
        cell.addEventListener('mouseleave', () => {
            document.querySelectorAll('tr.highlighted-row').forEach(r => r.classList.remove('highlighted-row'));
        });
    });
}