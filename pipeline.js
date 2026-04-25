/*
 * pipeline.js -- Pipeline Logic Datastructures
 *
 * Author: Esraaj Sarkar Gupta, Rohan Gupta, Kanishk Khandelwal
 */

const ALU_OPS = new Set(['ADD', 'SUB', 'AND', 'OR']);
const IMM_OPS = new Set(['ADDI', 'ORI']);
const MAX_INSTRUCTIONS = 10;
const REGISTER_PATTERN = /^R\d+$/i;
const INTEGER_PATTERN = /^-?\d+$/;

class Instruction {
    constructor(rawText, id) {
        this.id = id;
        this.rawText = rawText.trim();
        this.opcode = null;
        this.dest = null;
        this.src1 = null;
        this.src2 = null;
        this.sources = [];
        this.kind = 'UNKNOWN';
        this.valid = true;
        this.error = '';
        this.schedule = [];
        this.stages = [];
        this.timing = {};
    }
}

class PipelineSimulator {
    constructor() {
        this.instructions = [];
        this.cycle = 0;
        this.pipelineType = 5;
        this.forwarding = false;
        this.hazards = [];
        this.fullHazards = [];
        this.forwardingEvents = [];
        this.visibleForwardingEvents = [];
        this.errors = [];
    }

    getStages() {
        return this.pipelineType === 5 ? ['IF', 'ID', 'EX', 'MEM', 'WB'] : ['IF', 'ID', 'EX', 'MEM/WB'];
    }

    getDisplayStage(stage) {
        return this.pipelineType === 4 && stage === 'MEM' ? 'MEM/WB' : stage;
    }

    loadInstructions(rawTextArray) {
        const nonEmptyLines = rawTextArray
            .map((line, idx) => ({ text: line.trim(), lineNumber: idx + 1 }))
            .filter(line => line.text !== '');
        const candidateLines = nonEmptyLines.slice(0, MAX_INSTRUCTIONS);
        const parsedInstructions = candidateLines.map((line, idx) => {
            const inst = new Instruction(line.text, `I${idx + 1}`);
            inst.lineNumber = line.lineNumber;
            this.parseInstruction(inst);
            return inst;
        });

        this.instructions = [];
        this.cycle = 0;
        this.hazards = [];
        this.fullHazards = [];
        this.forwardingEvents = [];
        this.visibleForwardingEvents = [];
        const countErrors = nonEmptyLines.length > MAX_INSTRUCTIONS
            ? [`Maximum ${MAX_INSTRUCTIONS} instructions allowed; received ${nonEmptyLines.length}.`]
            : [];
        const parseErrors = parsedInstructions
            .filter(inst => !inst.valid)
            .map(inst => `Line ${inst.lineNumber}: "${inst.rawText}" could not be parsed. ${inst.error}`);
        this.errors = countErrors.concat(parseErrors);

        if (this.errors.length > 0) {
            return;
        }

        this.instructions = parsedInstructions;
        this.buildSchedule();
    }

    normalizeRegister(registerName) {
        return registerName ? registerName.toUpperCase() : null;
    }

    parseInstruction(inst) {
        const raw = inst.rawText.trim();
        const opcode = raw.split(/\s+/, 1)[0]?.toUpperCase() || null;
        inst.opcode = opcode;

        if (ALU_OPS.has(inst.opcode)) {
            const match = raw.match(/^([A-Za-z]+)\s+([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s]+)\s*$/);
            if (!match) {
                this.rejectInstruction(inst, `Expected ${inst.opcode} rd, rs, rt`);
                return;
            }
            const [, , dest, src1, src2] = match;
            if (![dest, src1, src2].every(register => REGISTER_PATTERN.test(register))) {
                this.rejectInstruction(inst, 'Registers must use R<number> format, e.g. R1');
                return;
            }
            inst.dest = this.normalizeRegister(dest);
            inst.src1 = this.normalizeRegister(src1);
            inst.src2 = this.normalizeRegister(src2);
            inst.sources = [inst.src1, inst.src2];
            inst.kind = 'ALU';
            return;
        }

        if (IMM_OPS.has(inst.opcode)) {
            const match = raw.match(/^([A-Za-z]+)\s+([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s]+)\s*$/);
            if (!match) {
                this.rejectInstruction(inst, `Expected ${inst.opcode} rt, rs, imm`);
                return;
            }
            const [, , dest, src1, imm] = match;
            if (![dest, src1].every(register => REGISTER_PATTERN.test(register))) {
                this.rejectInstruction(inst, 'Registers must use R<number> format, e.g. R1');
                return;
            }
            if (!INTEGER_PATTERN.test(imm)) {
                this.rejectInstruction(inst, 'Immediate must be an integer');
                return;
            }
            inst.dest = this.normalizeRegister(dest);
            inst.src1 = this.normalizeRegister(src1);
            inst.src2 = imm;
            inst.sources = [inst.src1];
            inst.kind = 'ALU';
            return;
        }

        if (inst.opcode === 'LW') {
            const match = raw.match(/^LW\s+([^,\s]+)\s*,\s*([+-]?\d+)\s*\(\s*([^) \t]+)\s*\)\s*$/i);
            if (!match) {
                this.rejectInstruction(inst, 'Expected LW rt, offset(base)');
                return;
            }
            const [, dest, , base] = match;
            if (![dest, base].every(register => REGISTER_PATTERN.test(register))) {
                this.rejectInstruction(inst, 'Registers must use R<number> format, e.g. R1');
                return;
            }
            inst.dest = this.normalizeRegister(dest);
            inst.src1 = this.normalizeRegister(base);
            inst.sources = [inst.src1];
            inst.kind = 'LOAD';
            return;
        }

        if (inst.opcode === 'SW') {
            const match = raw.match(/^SW\s+([^,\s]+)\s*,\s*([+-]?\d+)\s*\(\s*([^) \t]+)\s*\)\s*$/i);
            if (!match) {
                this.rejectInstruction(inst, 'Expected SW rt, offset(base)');
                return;
            }
            const [, data, , base] = match;
            if (![data, base].every(register => REGISTER_PATTERN.test(register))) {
                this.rejectInstruction(inst, 'Registers must use R<number> format, e.g. R1');
                return;
            }
            inst.dest = null;
            inst.src1 = this.normalizeRegister(data);
            inst.src2 = this.normalizeRegister(base);
            inst.sources = [inst.src1, inst.src2];
            inst.kind = 'STORE';
            return;
        }

        this.rejectInstruction(inst, `Unsupported instruction "${inst.opcode || inst.rawText}"`);
    }

    rejectInstruction(inst, error) {
        inst.valid = false;
        inst.error = error;
        inst.sources = [];
        inst.kind = 'UNKNOWN';
    }

    hasRawDependency(olderInst, inst) {
        return Boolean(
            olderInst.dest &&
            inst.sources.some(source => source && source === olderInst.dest)
        );
    }

    getDependencyUses(olderInst, inst) {
        if (!olderInst.dest) return [];

        if (inst.opcode === 'SW') {
            const uses = [];
            if (inst.src1 === olderInst.dest) {
                uses.push({ register: inst.src1, targetStage: 'MEM', role: 'store data' });
            }
            if (inst.src2 === olderInst.dest) {
                uses.push({ register: inst.src2, targetStage: 'EX', role: 'base address' });
            }
            return uses;
        }

        return inst.sources
            .filter(source => source && source === olderInst.dest)
            .map(source => ({ register: source, targetStage: 'EX', role: 'ALU/input operand' }));
    }

    getInstructionUses(inst) {
        if (inst.opcode === 'SW') {
            return [
                { register: inst.src1, targetStage: 'MEM', role: 'store data' },
                { register: inst.src2, targetStage: 'EX', role: 'base address' }
            ].filter(use => use.register);
        }

        return [...new Set(inst.sources)]
            .filter(Boolean)
            .map(source => ({ register: source, targetStage: 'EX', role: 'ALU/input operand' }));
    }

    getLatestRawDependencies(instIndex) {
        const inst = this.instructions[instIndex];
        const deps = [];
        const seen = new Set();

        this.getInstructionUses(inst).forEach(use => {
            for (let j = instIndex - 1; j >= 0; j--) {
                const olderInst = this.instructions[j];
                if (olderInst.dest !== use.register) continue;

                const key = `${olderInst.id}-${use.register}-${use.targetStage}`;
                if (!seen.has(key)) {
                    deps.push({ olderInst, use });
                    seen.add(key);
                }
                break;
            }
        });

        return deps;
    }

    buildSchedule() {
        const hazardMessages = [];
        const forwardingEvents = [];

        for (let i = 0; i < this.instructions.length; i++) {
            const inst = this.instructions[i];
            const prev = this.instructions[i - 1];

            let ifCycle = 1;
            if (prev) {
                ifCycle = this.pipelineType === 5
                    ? Math.max(prev.timing.ifCycle + 1, prev.timing.idCycle)
                    : prev.timing.ifCycle + 1;
            }

            let idCycle = ifCycle + 1;
            let exCycle = idCycle + 1;
            const rawDeps = [];
            const loadUseDeps = [];
            const forwardingDeps = [];

            this.getLatestRawDependencies(i).forEach(({ olderInst, use }) => {
                rawDeps.push(olderInst);

                if (!this.forwarding) {
                    idCycle = Math.max(idCycle, olderInst.timing.finalCycle + 1);
                    return;
                }

                if (olderInst.kind === 'LOAD') {
                    const requiredUseCycle = olderInst.timing.memCycle + 1;
                    if (use.targetStage === 'EX') {
                        if (this.pipelineType === 5) {
                            idCycle = Math.max(idCycle, requiredUseCycle - 1);
                        } else {
                            exCycle = Math.max(exCycle, requiredUseCycle);
                        }
                    } else {
                        exCycle = Math.max(exCycle, requiredUseCycle - 1);
                    }
                    loadUseDeps.push(olderInst);
                }
                forwardingDeps.push({ olderInst, use });
            });

            if (this.pipelineType === 5 || !this.forwarding) {
                exCycle = idCycle + 1;
            } else {
                exCycle = Math.max(exCycle, idCycle + 1);
            }

            if (prev) {
                idCycle = Math.max(idCycle, prev.timing.idCycle + 1);
                exCycle = Math.max(exCycle, idCycle + 1);
            }

            const memCycle = exCycle + 1;
            const wbCycle = this.pipelineType === 5 ? memCycle + 1 : null;
            const finalCycle = wbCycle || memCycle;

            inst.timing = { ifCycle, idCycle, exCycle, memCycle, wbCycle, finalCycle };
            inst.schedule = this.createSchedule(inst);
            inst.stages = [];

            if (this.forwarding) {
                forwardingDeps.forEach(dep => {
                    const event = this.createForwardingEvent(dep.olderInst, inst, dep.use);
                    if (event) forwardingEvents.push(event);
                });
            }

            if (rawDeps.length > 0) {
                const depList = rawDeps.map(dep => dep.id).join(', ');
                if (!this.forwarding) {
                    hazardMessages.push(`${inst.id} waits for ${depList}: RAW hazard resolved by stall(s).`);
                } else if (loadUseDeps.length > 0 && this.hasStall(inst)) {
                    hazardMessages.push(`${inst.id} waits for ${loadUseDeps.map(dep => dep.id).join(', ')}: load-use RAW hazard.`);
                }

            }
        }

        this.fullHazards = [...new Set(hazardMessages)];
        this.forwardingEvents = forwardingEvents;
    }

    createForwardingEvent(olderInst, inst, use) {
        const toCycle = use.targetStage === 'MEM' ? inst.timing.memCycle : inst.timing.exCycle;
        const valueAlreadyInRegisterFile = inst.timing.idCycle > olderInst.timing.finalCycle;
        if (valueAlreadyInRegisterFile) return null;

        let fromStage = 'EX';
        let fromCycle = olderInst.timing.exCycle;
        let rule = use.targetStage === 'MEM' ? 'EX/MEM -> MEM' : 'EX/MEM -> EX';

        if (olderInst.kind === 'LOAD') {
            fromStage = 'MEM';
            fromCycle = olderInst.timing.memCycle;
            rule = use.targetStage === 'MEM' ? 'MEM/WB -> MEM' : 'MEM/WB -> EX';
        } else if (toCycle === olderInst.timing.exCycle + 1) {
            fromStage = 'EX';
            fromCycle = olderInst.timing.exCycle;
            rule = use.targetStage === 'MEM' ? 'EX/MEM -> MEM' : 'EX/MEM -> EX';
        } else if (olderInst.timing.wbCycle && toCycle >= olderInst.timing.wbCycle) {
            fromStage = 'WB';
            fromCycle = olderInst.timing.wbCycle;
            rule = use.targetStage === 'MEM' ? 'MEM/WB -> MEM' : 'MEM/WB -> EX';
        } else {
            fromStage = 'MEM';
            fromCycle = olderInst.timing.memCycle;
            rule = use.targetStage === 'MEM' ? 'MEM/WB -> MEM' : 'MEM/WB -> EX';
        }

        const loadNote = olderInst.kind === 'LOAD' && use.targetStage === 'EX'
            ? ' after the load-use stall'
            : '';
        const displayRule = this.pipelineType === 4 && use.targetStage === 'MEM'
            ? rule.replace(' -> MEM', ' -> MEM/WB')
            : rule;

        return {
            id: `${olderInst.id}-${inst.id}-${use.register}-${use.targetStage}`,
            fromInstruction: olderInst.id,
            fromStage: this.getDisplayStage(fromStage),
            fromCycle,
            toInstruction: inst.id,
            toStage: this.getDisplayStage(use.targetStage),
            toCycle,
            register: use.register,
            role: use.role,
            rule: displayRule,
            text: `${olderInst.id} forwards ${use.register} from ${this.getDisplayStage(fromStage)} to ${inst.id} ${this.getDisplayStage(use.targetStage)} using ${displayRule}${loadNote}.`
        };
    }

    createSchedule(inst) {
        const schedule = [];
        const { ifCycle, idCycle, exCycle, memCycle, wbCycle, finalCycle } = inst.timing;

        schedule[ifCycle - 1] = 'IF';

        for (let cycle = ifCycle + 1; cycle < idCycle; cycle++) {
            schedule[cycle - 1] = 'ST';
        }

        schedule[idCycle - 1] = 'ID';

        for (let cycle = idCycle + 1; cycle < exCycle; cycle++) {
            schedule[cycle - 1] = 'ST';
        }

        schedule[exCycle - 1] = 'EX';
        schedule[memCycle - 1] = this.getDisplayStage('MEM');

        if (wbCycle) {
            schedule[wbCycle - 1] = 'WB';
        }

        for (let cycle = 1; cycle <= finalCycle; cycle++) {
            if (!schedule[cycle - 1]) schedule[cycle - 1] = '';
        }

        return schedule;
    }

    hasStall(inst) {
        return inst.schedule.includes('ST');
    }

    step() {
        if (this.instructions.length === 0 || this.errors.length > 0) return;

        const maxCycle = this.getMaxCycle();
        if (this.cycle >= maxCycle) return;

        this.cycle++;
        this.instructions.forEach(inst => {
            inst.stages = inst.schedule.slice(0, this.cycle);
        });
        this.hazards = this.visibleHazards();
        this.visibleForwardingEvents = this.getVisibleForwardingEvents();
    }

    runToEnd() {
        if (this.instructions.length === 0 || this.errors.length > 0) return;

        this.cycle = this.getMaxCycle();
        this.instructions.forEach(inst => {
            inst.stages = inst.schedule.slice(0, this.cycle);
        });
        this.hazards = this.fullHazards.slice();
        this.visibleForwardingEvents = this.getVisibleForwardingEvents();
    }

    resetRun() {
        this.cycle = 0;
        this.hazards = [];
        this.visibleForwardingEvents = [];
        this.instructions.forEach(inst => {
            inst.stages = [];
        });
    }

    getMaxCycle() {
        return Math.max(0, ...this.instructions.map(inst => inst.schedule.length));
    }

    visibleHazards() {
        const activeHazards = [];
        this.instructions.forEach(inst => {
            const visible = inst.stages;
            if (visible.includes('ST')) {
                activeHazards.push(`${inst.id}: RAW hazard visible as stall(s).`);
            }
        });

        if (this.cycle === this.getMaxCycle()) {
            return this.fullHazards.slice();
        }

        return [...new Set(activeHazards)];
    }

    getVisibleForwardingEvents() {
        if (!this.forwarding) return [];
        return this.forwardingEvents.filter(event => event.toCycle <= this.cycle);
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Instruction, PipelineSimulator };
}
