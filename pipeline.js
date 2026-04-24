/*
 * pipeline.js -- Pipeline Logic Datastructures
 *
 * Author: Esraaj Sarkar Gupta
 *
 */


/* ---- Instruction Data Structure ---- */
class Instruction{
    // Data structure for each instruction
    constructor(rawText, id) {
        this.id = id;
        this.rawText = rawText.trim();
        
        this.opcode = null;

        this.dest = null;
        this.src1 = null;
        this.scr2 = null;

        this.stages = [];
    }
}

/* ---- Pipeline Data Structure & Methods ---- */
class PipelineSimulator {
    constructor() {
        this.instructions = []; // Array holds all the instruction objects
        this.cycle = 0;
        this.pipelineType = 5; // Assume 5 stage pipeline by default
        this.forwarding = false; // Assume no register forwarding by default
        this.hazards = [];
    }

    loadInstructions(rawTextArray) {
        /*
         * Parses a raw text block into an array of instructions.
         */

        const validLines = rawTextArray.filter(line => line.trim() !== '').slice(0, 10);
        this.instructions = validLines.map((line, idx) => {
            const inst = new Instruction(line, `I${idx + 1}`);
            this.parseInstruction(inst); // Use parsing function
            return inst;
        });

        // Reset the deck clock and logs for a fresh run
        this.cycle = 0;
        this.hazards = [];
    }

    parseInstruction(inst) {
        /*
         * Parse human readable text into machine readable data
         */

        // Basic cleaning and splitting
        const normalized = inst.rawText.toUpperCase().replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
        const parts = normalized.split(' ');

        // Edge case handling
        if (parts.length === 0) return;
        inst.opcode = parts[0];

        // MIPS formatting
        if (inst.opcode === 'ADD' || inst.opcode === 'SUB') {
            inst.dest = parts[1];         // Result register
            inst.src1 = parts[2];         // Number 1
            inst.src2 = parts[3];         // Number 2
        } else if (inst.opcode === 'LW') {
            inst.dest = parts[1];         // Load Register
            inst.src1 = parts[3];         // The base address register -- ignore offset here 
        } else if (inst.opcode === 'SW') {
            inst.src1 = parts[1];         // Register is read to be written into memory
            inst.src2 = parts[3];         // The base address register 
            inst.dest = null;
        }
    }

    /* ---- The Tick Advancements ---- */
    step() {
        /*
         * This function advances the tick of the simulated computer by
         * a single tick every time it is run.
         */

        // End return case
        if(this.instructions.length === 0) return;

        this.cycle++; // Increment ticks on the clock

        // Define stages based on pipeline type flag
        const pStages = this.pipelineType === 5 ? ['IF', 'ID', 'EX', 'MEM', 'WB'] : ['IF', 'ID', 'EX', 'MEM_WB'];

        // Read history -- last cycles
        const prevStates = this.instructions.map(inst => inst.stages[this.cycle - 2] || '');

        // Iterate through each stage in sequence
        for (let i = 0; i < this.instructions.length; i++) {
            const inst = this.instructions[i];
            const prev = prevStates[i];

            let next = '';

            /* -- SCENARIO : Instruction has not been launched yet -- */
            if (prev === '' && !inst.stages.includes('IF')) {
                /*
                 * Launch When
                 * a) First instruction (i = 0)
                 * b) The previous instruction has already been fetched
                 */
                if (i === 0 || (prevStates[i-1] !== '' && prevStates[i-1] !== 'IF')) {
                    next = 'IF';
                }
            }
            
            /* -- SCENARIO : Instruction has already exited the pipeline -- */
            else if (prev === pStages[pStages.length - 1] || (prev === '' && inst.stages.includes('IF'))) {
                next = ''; // Nothing next for an instruction that has already exited the entire pipeline
            }
            
            /* -- SCENARIO : If the instruction is still within the pipeline -- */
            else {
                /*
                 * If the instruction was previously stalled, it must currently be stuck waiting
                 * for the execution stage (EX). It will now attempt to move to the EX stage.
                 * If it was not stalled, continue with whatever comes next
                 */
                let intended = (prev === 'STALL') ? 'EX' : pStages[pStages.indexOf(prev) + 1];

                /* ---- 1. Check for Data Hazards ---- */
                if (intended === 'EX') {
                    let stall = false;
                    let forwarded = false;

                    /*
                     * The program checks if any older instructions are
                     * computing a value required for the src1 and src2
                     * registers of the present instruction
                     */
                    for(let j = 0; j < i; j++) {
                        const olderInst = this.instructions[j];

                        if (olderInst.dest && (olderInst.dest === inst.src1 || olderInst.dest === inst.src2)) {
                            const olderCurrent = olderInst.stages[this.cycle - 1];

                            /*
                             * If the older instruction is in EX, MEM, or WB, the data has 
                             * not been physically committed to the register file yet.
                             */
                            if (olderCurrent === 'EX' || olderCurrent === 'MEM' || olderCurrent === 'WB' || olderCurrent === 'MEM_WB') {
                                
                                // Check for hardware bypass -- register forwarding
                                if (!this.forwarding) {
                                    stall = true; // Stall when lacking hardware bypass
                                } else {
                                    // Hardware has bypass
                                    // Check for the Load-Use penalty
                                    if (olderInst.opcode === 'LW' && (olderCurrent === 'EX' || olderCurrent === 'MEM')) {
                                        /*
                                         * Load-Use Exception: Even with forwarding, data from RAM 
                                         * isn't available until the end of MEM. Pipeline is stalled
                                         * by 1 tick.
                                         */
                                        stall = true;
                                    } else {
                                        forwarded = true;
                                    }
                                }
                            }
                        }
                    } // Damn that's quite a few nested if statemenets -- so mny brackets are always so scary

                    // Apply the hazard check results --- forwarded to the UI
                    if (stall) {
                        next = 'STALL';
                        const hazardMsg = `Cycle ${this.cycle}: RAW Hazard. Inst ${inst.id} delayed.`;
                        if (!this.hazards.includes(hazardMsg)) this.hazards.push(hazardMsg);
                    } else if (forwarded) {
                        next = 'EX';
                        const forwardMsg = `Cycle ${this.cycle}: Data forwarded to Inst ${inst.id}.`;
                        if (!this.hazards.includes(forwardMsg)) this.hazards.push(forwardMsg);
                    } else {
                        next = 'EX'; 
                    }
                } 
                
                /* ---- Check for Structural Hazards ---- */
                else if (intended === 'ID') {
                    /*
                     * Traffic Jam Rule:
                     * If the instruction directly ahead of us is stuck in ID or STALL, 
                     * the decode hardware is physically occupied. We cannot enter ID 
                     * and must remain stuck in IF for another tick.
                     */
                    if (i > 0 && (this.instructions[i-1].stages[this.cycle - 1] === 'STALL' || this.instructions[i-1].stages[this.cycle - 1] === 'ID')) {
                        next = 'IF'; 
                    } else {
                        next = 'ID';
                    }
                } 
                
                /* ---- Normal Progression ---- */
                else {
                    next = intended;
                }
            }

            // Commit the calculated next stage to the instruction's telemetry array
            inst.stages.push(next);
        }
    }

    /* --- Function to auto-run the Loop --- */
    runToEnd() {
        const pStages = this.pipelineType === 5 ? ['IF', 'ID', 'EX', 'MEM', 'WB'] : ['IF', 'ID', 'EX', 'MEM_WB'];
        const finalStage = pStages[pStages.length - 1];
        
        let safeGuard = 0; // Safe gaurd flag to ensure the program stops after n counts

        while (safeGuard < 50) {
            const allFinished = this.instructions.every(inst => {
                /* * The .every() method checks if every capsule has finished its journey.
                 * For an instruction to be considered 'retired', it must meet two criteria:
                 * 1. It must have reached the end of the track -- finalStage.
                 * 2. Its current state must be empty ('').
                 */
                const last = inst.stages[inst.stages.length - 1] || '';
                return last === '' && inst.stages.includes(finalStage);
            });

            if (allFinished) break; // We're done here

            // Else continue
            this.step();
            safeGuard++;
        }       
    }
}