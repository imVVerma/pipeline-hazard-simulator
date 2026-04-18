import { runSimulation } from "./simulator.js"

const instructions = [
  { type: "lw", dest: "$t0", src: ["$t1"] },
  { type: "add", dest: "$t2", src: ["$t0", "$t3"] }
]

runSimulation(instructions, "5-stage", true)

console.log(result)