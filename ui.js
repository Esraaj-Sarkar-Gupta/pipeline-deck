function getStageDescription(inst, stage) {
    if (!inst || !inst.opcode) return '';
    switch(stage) {
        case 'IF': return `Fetches ${inst.opcode}`;
        case 'ID': return `Decodes ${inst.opcode}`;
        case 'EX':
            if (inst.opcode === 'ADD' || inst.opcode === 'SUB') return `${inst.opcode}s ${inst.src1} & ${inst.src2}`;
            if (inst.opcode === 'LW' || inst.opcode === 'SW') return `Computes address`;
            return 'Executes';
        case 'MEM':
            if (inst.opcode === 'LW') return `Reads Memory`;
            if (inst.opcode === 'SW') return `Writes Memory`;
            return `Bypasses`;
        case 'WB':
            if (inst.opcode === 'SW') return `No write-back`;
            return `Writes to ${inst.dest}`;
        case 'MEM_WB':
            if (inst.opcode === 'LW') return `Reads Mem & Writes ${inst.dest}`;
            if (inst.opcode === 'SW') return `Writes Mem`;
            if (inst.opcode === 'ADD' || inst.opcode === 'SUB') return `Bypasses & Writes ${inst.dest}`;
            return `Completes`;
        case 'STALL':
            return `Waiting for data`;
        default: return '';
    }
}

function renderInitialTable(simulator) {
    const header = document.getElementById('table-header');
    header.innerHTML = '<th class="py-2 px-4 font-medium border-r border-slate-600 w-48">Instruction</th>';
    
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    
    simulator.instructions.forEach(inst => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-700/50 pipeline-row transition-colors';
        tr.id = `row-${inst.id}`;
        tr.innerHTML = `<td class="py-2 px-4 font-mono text-blue-300 border-r border-slate-700/50 w-48">${inst.id}: ${inst.rawText}</td>`;
        tbody.appendChild(tr);
    });

    document.getElementById('hazard-log').innerHTML = '<li class="text-slate-500 italic">No hazards detected yet.</li>';
}

function updateUI(simulator) {
    // 1. Expand Header with current cycle
    const header = document.getElementById('table-header');
    header.innerHTML = '<th class="py-2 px-4 font-medium border-r border-slate-600 w-48">Instruction</th>';
    for (let i = 1; i <= simulator.cycle; i++) {
        const th = document.createElement('th');
        th.className = 'py-2 px-4 font-medium text-center border-r border-slate-600 min-w-[120px] text-slate-300';
        th.innerText = `C${i}`;
        header.appendChild(th);
    }

    // 2. Render Stage Cells
    simulator.instructions.forEach(inst => {
        const row = document.getElementById(`row-${inst.id}`);
        row.innerHTML = `<td class="py-2 px-4 font-mono text-blue-300 border-r border-slate-700/50 w-48">${inst.id}: ${inst.rawText}</td>`;
        
        inst.stages.forEach((stage, index) => {
            const td = document.createElement('td');
            td.className = 'py-1 px-1 text-center border-r border-slate-700/50';
            
            if (stage) {
                const span = document.createElement('span');
                const isNew = index === inst.stages.length - 1;
                const popClass = isNew ? ' animate-pop-in' : '';
                span.className = `stage-cell block w-full text-xs py-1.5 ${stage === 'STALL' ? 'stage-stall' : 'stage-normal'}${popClass}`;
                
                const desc = getStageDescription(inst, stage);
                span.innerHTML = `<span class="text-sm font-bold">${stage}</span><span class="text-[0.6rem] font-medium opacity-80 mt-0.5 block whitespace-normal leading-tight">${desc}</span>`;
                
                span.setAttribute('data-tooltip', `Cycle ${index + 1}: ${inst.id} is in ${stage}`);
                td.appendChild(span);
            }
            row.appendChild(td);
        });
    });

    // 3. Update Hazard Alerts
    const log = document.getElementById('hazard-log');
    if (simulator.hazards.length > 0) {
        log.innerHTML = simulator.hazards.map(h => `<li class="text-red-400 font-mono text-xs">${h}</li>`).join('');
    }
}

// --- Event Listeners ---
const simulator = new PipelineSimulator();

document.getElementById('btn-parse').addEventListener('click', () => {
    const inputText = document.getElementById('instruction-input').value;
    simulator.pipelineType = parseInt(document.getElementById('pipeline-type').value);
    simulator.forwarding = document.getElementById('enable-forwarding').checked;
    
    simulator.loadInstructions(inputText.split('\n'));
    renderInitialTable(simulator);
    
    document.getElementById('btn-step').disabled = false;
    document.getElementById('btn-run').disabled = false;
});

document.getElementById('btn-step').addEventListener('click', () => {
    simulator.step();
    updateUI(simulator);
});

document.getElementById('btn-run').addEventListener('click', () => {
    simulator.runToEnd();
    updateUI(simulator);
});

document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('instruction-input').value = '';
    document.getElementById('preset-dropdown').value = '';
    simulator.instructions = [];
    simulator.cycle = 0;
    simulator.hazards = [];
    renderInitialTable(simulator);
    
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '<tr><td colspan="100%" class="py-8 text-center text-slate-500 italic">Load instructions to begin simulation.</td></tr>';
    
    document.getElementById('btn-step').disabled = true;
    document.getElementById('btn-run').disabled = true;
});

const presets = {
    'raw': 'ADD R1, R2, R3\nSUB R4, R1, R5\nADD R6, R4, R1',
    'war': 'ADD R1, R2, R3\nADD R2, R4, R5',
    'waw': 'ADD R1, R2, R3\nSUB R1, R4, R5',
    'loaduse': 'LW R1, 0(R2)\nADD R3, R1, R4'
};

document.getElementById('preset-dropdown').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val && presets[val]) {
        document.getElementById('instruction-input').value = presets[val];
    }
});
