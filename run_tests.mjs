import { runSimulation } from './simulator.js';

const testCases = [
  { 
    name: 'TC User — R-notation registers', 
    text: `lw R1, 0(R2)\nadd R3, R1, R4\nsub R5, R3, R6\nlw R7, 4(R2)` 
  },
];

function render(result) {
  const { instructions, table, totalCycles, hazards } = result;
  let h = 'Instruction'.padEnd(24) + ' | ';
  for (let c = 1; c <= totalCycles; c++) h += `C${c}`.padEnd(10);
  console.log(h);
  console.log('-'.repeat(27 + totalCycles * 10));
  for (let i = 0; i < instructions.length; i++) {
    let line = `I${i+1}: ${instructions[i].raw}`.padEnd(24) + ' | ';
    for (let c = 1; c <= totalCycles; c++) {
      const cell = table[i].find(x => x.cycle === c);
      line += ((!cell || cell.type === 'empty') ? '.' : cell.label).padEnd(10);
    }
    console.log(line);
  }
  console.log(`Total: ${totalCycles} cycles`);
  hazards.forEach(h => console.log('  >> ' + h.msg));
}

const cfg5fwd  = { stages: 5, forwardingEnabled: true,  branchStrategy: 'predict-not-taken' };
const cfg5nofwd = { stages: 5, forwardingEnabled: false, branchStrategy: 'predict-not-taken' };

for (const tc of testCases) {
  console.log('\n' + '='.repeat(55));
  console.log(tc.name);
  console.log('='.repeat(55));
  console.log('\n[WITH Forwarding]');
  render(runSimulation(tc.text, cfg5fwd));
  console.log('\n[WITHOUT Forwarding]');
  render(runSimulation(tc.text, cfg5nofwd));
}
