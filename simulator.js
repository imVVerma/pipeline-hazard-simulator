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
  
  let table     = [];
  let hazards   = [];
  let stallCount = 0;
  let fwdCount   = 0;
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
                stallCount++;
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
                    let type  = 'stage';
                    let tooltip = '';
                    
                    if (config.forwardingEnabled && label === 'EX') {
                        let fwdInfo = checkForwarding(i, states, snapshot, config, stages);
                        if (fwdInfo.forwarded) {
                            label   = 'EX (FWD)';
                            type    = 'fwd';
                            tooltip = fwdInfo.reason;
                            fwdCount++;
                            // Log one entry per forwarded register
                            fwdInfo.events.forEach(evt => {
                                hazards.push({
                                    kind: 'fwd',
                                    msg: `Cycle ${cycle}: ${evt.register} forwarded from I${evt.fromInstr} (${evt.fromStage}) → I${i+1} (EX)`
                                });
                            });
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
  
  return { instructions, table, hazards, totalCycles, stallCount, fwdCount };
}

function checkStalls(i, states, snapshot, config, stages, cycle, hazards) {
    let curr = states[i];
    const wbStage = stages.length - 1;   // index of last stage (MEM/WB or WB)
    const exStage = 2;                    // index of EX stage

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
                    hazards.push({ kind: 'stall', msg: `Cycle ${cycle}: I${i+1} stalled — RAW on ${destReg} from I${prevIdx+1} (no forwarding)` });
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
                        if (prevSnap < exStage) {
                            let msg = `Stall: load-use on ${destReg} — forwarding insufficient (LW result not yet available)`;
                            if (curr.stalls === 0)
                                hazards.push({ kind: 'stall', msg: `Cycle ${cycle}: I${i+1} stalled — Load-use on ${destReg} from I${prevIdx+1} (forwarding cannot eliminate stall)` });
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
                        if (prevSnap < wbStage) {
                            let msg = `Stall: load-use on ${destReg} — forwarding insufficient (LW result not yet available)`;
                            if (curr.stalls === 0)
                                hazards.push({ kind: 'stall', msg: `Cycle ${cycle}: I${i+1} stalled — Load-use on ${destReg} from I${prevIdx+1} (forwarding cannot eliminate stall)` });
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
    let curr    = states[i];
    let srcRegs = curr.instr.src;
    if (!srcRegs || srcRegs.length === 0) return { forwarded: false };

    // Only annotate forwarding when the consumer just entered EX (stageIdx === 2)
    if (curr.stageIdx !== 2) return { forwarded: false };

    const events = [];
    const seen   = new Set(); // avoid duplicate register events

    for (let d = 1; d <= 2; d++) {
        let prevIdx = i - d;
        if (prevIdx < 0) continue;

        let prev    = states[prevIdx];
        let destReg = prev.instr.dest;
        if (!destReg || !srcRegs.includes(destReg) || seen.has(destReg)) continue;

        // Determine which pipeline register the value is forwarded from:
        //   d=1, producer snapshot=2 (EX)  → forward from EX/MEM register
        //   d=2, producer snapshot=3 (MEM) → forward from MEM/WB register
        const producerSnap = snapshot[prevIdx];
        const fromStage    = producerSnap === 2 ? 'EX' : 'MEM';

        seen.add(destReg);
        events.push({ register: destReg, fromInstr: prevIdx + 1, fromStage });
    }

    if (events.length === 0) return { forwarded: false };

    const reason = events
        .map(e => `${e.register}: I${e.fromInstr}(${e.fromStage})→I${i+1}(EX)`)
        .join(', ');
    return { forwarded: true, events, reason };
}