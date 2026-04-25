// ===============================
// PIPELINE SIMULATOR ENGINE
// ===============================

export function runSimulation(instructionsText, config) {
  const instructions = parseInstructions(instructionsText);
  if (instructions.error) {
    throw new Error(instructions.error);
  }

  return simulate(instructions, config);
}

function parseInstructions(text) {
  const rawLines = text.split('\n');
  const instructions = [];
  
  for (let i = 0; i < rawLines.length; i++) {
    let originalRaw = rawLines[i].trim();
    if (!originalRaw) continue;
    
    // Strip labels (e.g. "loop:" or "L1: add")
    let raw = originalRaw;
    const labelMatch = raw.match(/^[a-zA-Z0-9_\-]+:\s*/);
    if (labelMatch) {
      raw = raw.slice(labelMatch[0].length).trim();
    }
    
    // If it was just a label line, skip processing it
    if (!raw) continue;
    
    // basic parsing: op arg1, arg2, arg3 OR op arg1, offset(arg2)
    const parts = raw.replace(/,/g, ' ').replace(/\(/g, ' ').replace(/\)/g, ' ').split(/\s+/).filter(p => p);
    
    if (parts.length < 2) return { error: `Line ${i + 1}: Invalid instruction format '${originalRaw}'` };
    
    const op = parts[0].toLowerCase();
    let dest = null;
    let src = [];
    
    // Register regex: matches $t0, R1, $1, etc.
    const isReg = p => /^[Rr\$][a-z0-9]+$/i.test(p);

    if (['sw', 'sh', 'sb', 'beq', 'bne'].includes(op)) {
      dest = null;
      src = parts.slice(1).filter(isReg);
    } else if (['j', 'jal', 'jr'].includes(op)) {
      dest = null; 
      src = parts.slice(1).filter(isReg);
    } else {
      // standard R-type or I-type ALU where 1st arg is dest
      const regs = parts.slice(1).filter(isReg);
      if (regs.length > 0) {
        dest = regs[0];
        src = regs.slice(1);
      }
    }
    
    instructions.push({ raw: originalRaw, op, dest, src });
  }
  
  if (instructions.length === 0) return { error: "No instructions provided" };
  
  return instructions;
}

function simulate(instructions, config) {
  const stages = config.stages === 5 ? ['IF', 'ID', 'EX', 'MEM', 'WB'] : ['IF', 'ID', 'EX', 'MEM/WB'];
  
  let table = [];
  let hazards = [];
  let totalCycles = 0;
  
  let states = instructions.map((ins, i) => ({
    instr: ins,
    stageIdx: -1, // -1: not started
    stalls: 0,
    finished: false,
    rowCells: [] 
  }));

  let cycle = 1;
  const n = states.length;
  
  while (states.some(s => !s.finished)) {
    // --- Snapshot stageIdx at START of cycle so stall checks use consistent positions ---
    const snapshot = states.map(s => s.stageIdx);

    // Fill previous empty cycles with 'empty' cells if needed (to ensure accurate alignment)
    for (let i = 0; i < n; i++) {
      while (states[i].rowCells.length < cycle - 1) {
         states[i].rowCells.push({ type: 'empty', label: '', cycle: states[i].rowCells.length + 1, instrIndex: i });
      }
    }

    for (let i = 0; i < n; i++) {
        let state = states[i];
        if (state.finished) continue;
        
        let cell = null;
        
        if (state.stageIdx === -1) {
            // Instruction i can enter IF only when instruction i-1 has MOVED to ID.
            // This prevents multiple instructions from occupying IF and matches standard fetch behavior.
            if (i === 0 || states[i-1].stageIdx >= 1) {
                state.stageIdx = 0;
                cell = { type: 'stage', label: stages[0], cycle, instrIndex: i };
            } else {
                continue;
            }
        } else {
            // Already active. Stall check uses start-of-cycle snapshot.
            let stallInfo = checkStalls(i, states, snapshot, config, stages, cycle, hazards);

            // Structural check: use LIVE stageIdx of prev (already advanced this cycle)
            // An instruction cannot enter a stage if the previous instruction is still in it.
            let structuralStall = false;
            if (i > 0) {
               // If next stage for current (state.stageIdx + 1) is <= prev's current stage, it's a conflict
               if (!states[i-1].finished && states[i-1].stageIdx <= state.stageIdx + 1) {
                   structuralStall = true;
               }
            }
            
            if (stallInfo.shouldStall || structuralStall) {
                cell = { 
                    type: 'stall', 
                    label: 'STALL', 
                    cycle, 
                    instrIndex: i,
                    tooltip: stallInfo.reason || 'Pipeline structural stall'
                };
            } else {
                // Advance
                state.stageIdx++;
                if (state.stageIdx >= stages.length) {
                    state.finished = true;
                } else {
                    let label = stages[state.stageIdx];
                    let type = 'stage';
                    let tooltip = '';
                    
                    if (config.forwardingEnabled && ['EX', 'MEM', 'MEM/WB'].includes(label)) {
                        let fwdInfo = checkForwarding(i, states, snapshot, config, stages);
                        if (fwdInfo.forwarded) {
                            label += ' (FWD)';
                            type = 'fwd';
                            tooltip = fwdInfo.reason;
                            hazards.push({ msg: `Cycle ${cycle}: I${i+1} resumes — ${fwdInfo.reason}` });
                        }
                    }
                    
                    cell = { type, label, cycle, instrIndex: i, tooltip };
                }
            }
        }
        
        if (cell) {
             state.rowCells.push(cell);
        }
    }
    cycle++;
    
    if (cycle > 100) break; // infinite loop guard
  }
  
  // totalCycles = last cycle that contained an actual stage cell (not the finishing cycle)
  let lastActiveCycle = 0;
  for (let i = 0; i < n; i++) {
    for (let cell of states[i].rowCells) {
      if (cell.type !== 'empty' && cell.cycle > lastActiveCycle) lastActiveCycle = cell.cycle;
    }
  }
  totalCycles = lastActiveCycle || (cycle - 1);

  for (let i = 0; i < n; i++) {
     let row = states[i].rowCells;
     while (row.length < totalCycles) {
         row.push({ type: 'empty', label: '', cycle: row.length + 1, instrIndex: i });
     }
     table.push(row);
  }
  
  return { instructions, table, hazards, totalCycles };
}

function checkStalls(i, states, snapshot, config, stages, cycle, hazards) {
    let curr = states[i];
    const wbStage   = stages.length - 1;  // index of last stage (MEM/WB or WB)
    const exStage   = 2;                   // index of EX stage

    // ── Control Hazard (Branch Penalty) ──────────────────────────────────────
    if (i > 0) {
        let prev = states[i-1];
        let op = prev.instr.op;
        if (op && ['beq', 'bne', 'j', 'jal', 'jr', 'blez', 'bgtz'].includes(op)) {
            if (config.branchStrategy && config.branchStrategy !== 'predict-not-taken') {
                 let resolveLimit = config.branchStrategy === 'stall-id' ? 2 : 3;
                 if (curr.stageIdx === 0 && snapshot[i-1] <= resolveLimit) {
                     let reason = `Control Hazard — Waiting for branch resolution`;
                     if (curr.stalls === 0) {
                         hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — Control hazard (Branch penalty)` });
                     }
                     curr.stalls++;
                     return { shouldStall: true, reason };
                 }
            }
        }
    }

    // ── Data Hazard (RAW) ─────────────────────────────────────────────────────
    let srcRegs = curr.instr.src;
    if (!srcRegs || srcRegs.length === 0) return { shouldStall: false };

    if (!config.forwardingEnabled) {
        // WITHOUT forwarding: stall in IF (stageIdx=0).
        // Consumer waits in IF until producer reaches MEM/WB (register written).
        if (curr.stageIdx !== 0) return { shouldStall: false };

        for (let d = 1; d <= 2; d++) {
            let prevIdx = i - d;
            if (prevIdx < 0) continue;
            let prev     = states[prevIdx];
            let prevSnap = snapshot[prevIdx];
            let destReg  = prev.instr.dest;
            if (!destReg || !srcRegs.includes(destReg) || prev.finished) continue;

            if (prevSnap < wbStage) {
                let msg = `Waiting for ${destReg} — RAW hazard (no forwarding)`;
                if (curr.stalls === 0)
                    hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — depends on ${destReg} written by I${prevIdx+1} (RAW)` });
                curr.stalls++;
                return { shouldStall: true, reason: msg };
            }
        }
    } else {
        // WITH forwarding:
        if (config.stages === 5) {
            // 5-stage load-use: MEM-EX forwarding needs consumer's EX to align with
            // producer's WB. Stall 1 cycle IN IF (stageIdx=0) while prevSnap < exStage=2.
            if (curr.stageIdx === 0) {
                let prevIdx = i - 1;
                if (prevIdx >= 0) {
                    let prev     = states[prevIdx];
                    let prevSnap = snapshot[prevIdx];
                    let destReg  = prev.instr.dest;
                    if (destReg && srcRegs.includes(destReg) && prev.instr.op === 'lw' && !prev.finished) {
                        if (prevSnap < exStage) {   // exStage = 2
                            let msg = `Waiting for ${destReg} — Load-Use hazard`;
                            if (curr.stalls === 0)
                                hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — Load-use on ${destReg} from I${prevIdx+1}` });
                            curr.stalls++;
                            return { shouldStall: true, reason: msg };
                        }
                    }
                }
            }
        } else {
            // 4-stage load-use (MEM/WB combined): stall 1 cycle IN ID (stageIdx=1).
            if (curr.stageIdx === 1) {
                let prevIdx = i - 1;
                if (prevIdx >= 0) {
                    let prev     = states[prevIdx];
                    let prevSnap = snapshot[prevIdx];
                    let destReg  = prev.instr.dest;
                    if (destReg && srcRegs.includes(destReg) && prev.instr.op === 'lw' && !prev.finished) {
                        if (prevSnap < wbStage) {   // wbStage = 3 for 4-stage
                            let msg = `Waiting for ${destReg} — Load-Use hazard`;
                            if (curr.stalls === 0)
                                hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — Load-use on ${destReg} from I${prevIdx+1}` });
                            curr.stalls++;
                            return { shouldStall: true, reason: msg };
                        }
                    }
                }
            }
        }
        // ALU-ALU (any distance): forwarding resolves in time — no stall needed.
    }
    return { shouldStall: false };
}

function checkForwarding(i, states, snapshot, config, stages) {
    let curr = states[i];
    let srcRegs = curr.instr.src;
    
    if (!srcRegs || srcRegs.length === 0) return { forwarded: false };
    
    for (let d = 1; d <= 2; d++) {
        let prevIdx = i - d;
        if (prevIdx < 0) continue;
        let prev = states[prevIdx];
        let destReg = prev.instr.dest;
        
        if (destReg && srcRegs.includes(destReg)) {
            // Annotate FWD when consumer is now in EX (stageIdx 2)
            if (curr.stageIdx === 2) {
                return { forwarded: true, reason: `Value forwarded from I${prevIdx+1}` };
            }
        }
    }
    return { forwarded: false };
}