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
    
    if (['sw', 'sh', 'sb', 'beq', 'bne'].includes(op)) {
      dest = null;
      src = parts.slice(1).filter(p => p.startsWith('$'));
    } else if (['j', 'jal', 'jr'].includes(op)) {
      dest = null; 
      src = parts.slice(1).filter(p => p.startsWith('$'));
    } else {
      // standard R-type or I-type ALU where 1st arg is dest
      const regs = parts.slice(1).filter(p => p.startsWith('$'));
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
            // IF stage availability check based on structural resources
            // A simple pipeline: instruction i can enter IF when i-1 enters ID
            if (i === 0 || states[i-1].stageIdx >= 1) {
                state.stageIdx = 0;
                cell = { type: 'stage', label: stages[0], cycle, instrIndex: i };
            } else {
                // Must wait to enter IF pipeline
                continue; 
            }
        } else {
            // Already active. Determine if stalling.
            let stallInfo = checkStalls(i, states, config, stages, cycle, hazards);
            
            // Structural check: previous instruction still in the SAME next stage means we block
            let structuralStall = false;
            if (i > 0) {
               let prev = states[i-1];
               if (!prev.finished && prev.stageIdx <= state.stageIdx) {
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
                        let fwdInfo = checkForwarding(i, states, config, stages);
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
  
  totalCycles = cycle - 1;
  for (let i = 0; i < n; i++) {
     let row = states[i].rowCells;
     while (row.length < totalCycles) {
         row.push({ type: 'empty', label: '', cycle: row.length + 1, instrIndex: i });
     }
     table.push(row);
  }
  
  return { instructions, table, hazards, totalCycles };
}

function checkStalls(i, states, config, stages, cycle, hazards) {
    let curr = states[i];
    
    // Check Control Hazard (Branch Penalty)
    if (i > 0) {
        let prev = states[i-1];
        let op = prev.instr.op;
        if (op && ['beq', 'bne', 'j', 'jal', 'jr', 'blez', 'bgtz'].includes(op)) {
            if (config.branchStrategy && config.branchStrategy !== 'predict-not-taken') {
                 // penalty is 1 for 'stall-id', 2 for 'stall-ex'
                 let resolveLimit = config.branchStrategy === 'stall-id' ? 2 : 3;
                 
                 // if curr is in IF (waiting to proceed to ID), and the branch hasn't cleared the penalty pipeline distance
                 if (curr.stageIdx === 0 && prev.stageIdx <= resolveLimit) {
                     let reason = `Control Hazard — Waiting for branch resolution`;
                     if (curr.stalls === 0) {
                         hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — Control hazard (Branch penalty)` });
                     }
                     curr.stalls++;
                     return { shouldStall: true, reason: reason };
                 }
            }
        }
    }

    let srcRegs = curr.instr.src;
    
    if (!srcRegs || srcRegs.length === 0) return { shouldStall: false };
    
    for (let d = 1; d <= 2; d++) {
       let prevIdx = i - d;
       if (prevIdx < 0) continue;
       
       let prev = states[prevIdx];
       let destReg = prev.instr.dest;
       
       if (!destReg) continue;
       
       if (srcRegs.includes(destReg)) {
           if (!config.forwardingEnabled) {
               // Must wait until WB is completely done
               if (curr.stageIdx === 1) { // Current in ID
                   let wbStage = stages.length - 1;
                   if (prev.stageIdx < wbStage) {
                       let msg = `Waiting for ${destReg} — RAW hazard`;
                       if (curr.stalls === 0) {
                           hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — depends on ${destReg} written by I${prevIdx+1} (RAW)`});
                       }
                       curr.stalls++;
                       return { shouldStall: true, reason: msg };
                   }
               }
           } else {
               // Forwarding enabled
               if (curr.stageIdx === 1) { // In ID
                   if (prev.instr.op === 'lw') {
                       // Load-Use
                       let memStage = config.stages === 5 ? 3 : 3; 
                       if (prev.stageIdx < memStage) { // Need prev to finish MEM
                           let msg = `Waiting for ${destReg} — Load-Use hazard`;
                           if (curr.stalls === 0) {
                               hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — Load-use constraint on ${destReg} from I${prevIdx+1}`});
                           }
                           curr.stalls++;
                           return { shouldStall: true, reason: msg };
                       }
                   } else {
                       // ALU-ALU
                       let exStage = 2;
                       if (prev.stageIdx < exStage) {
                           let msg = `Waiting for ${destReg} — RAW hazard`;
                           if (curr.stalls === 0) {
                                hazards.push({ msg: `Cycle ${cycle}: I${i+1} stalled — depends on I${prevIdx+1} EX`});
                           }
                           curr.stalls++;
                           return { shouldStall: true, reason: msg };
                       }
                   }
               }
           }
       }
    }
    return { shouldStall: false };
}

function checkForwarding(i, states, config, stages) {
    let curr = states[i];
    let srcRegs = curr.instr.src;
    
    if (!srcRegs || srcRegs.length === 0) return { forwarded: false };
    
    for (let d = 1; d <= 2; d++) {
        let prevIdx = i - d;
        if (prevIdx < 0) continue;
        let prev = states[prevIdx];
        let destReg = prev.instr.dest;
        
        if (destReg && srcRegs.includes(destReg)) {
           // Forwarding check
           if (curr.stageIdx === 2) { 
               return { forwarded: true, reason: `Value forwarded from I${prevIdx+1}` };
           }
        }
    }
    return { forwarded: false };
}