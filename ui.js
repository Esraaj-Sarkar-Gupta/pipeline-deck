function getStageDescription(inst, stage) {
    if (!inst || !inst.opcode) return '';
    switch(stage) {
        case 'IF': return `Fetches ${inst.opcode}`;
        case 'ID': return `Decodes ${inst.opcode}`;
        case 'EX':
            if (inst.kind === 'ALU') return `Uses ${inst.sources.join(' & ')}`;
            if (inst.opcode === 'LW' || inst.opcode === 'SW') return `Computes address`;
            return 'Executes';
        case 'MEM':
            if (inst.opcode === 'LW') return `Reads Memory`;
            if (inst.opcode === 'SW') return `Writes Memory`;
            if (!inst.timing.wbCycle && inst.dest) return `Writes ${inst.dest}`;
            return `Passes result`;
        case 'MEM/WB':
            if (inst.opcode === 'LW') return `Reads & writes ${inst.dest}`;
            if (inst.opcode === 'SW') return `Writes Memory`;
            if (inst.dest) return `Writes ${inst.dest}`;
            return `Completes`;
        case 'WB':
            if (inst.opcode === 'SW') return `No write-back`;
            return `Writes to ${inst.dest}`;
        case 'ST':
            return `Waiting for data`;
        default: return '';
    }
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function renderInitialTable(simulator) {
    const header = document.getElementById('table-header');
    header.innerHTML = '<th class="instruction-cell py-2 px-3 font-medium border-r border-slate-600">Instruction</th>';
    
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    if (simulator.instructions.length === 0) {
        const message = simulator.errors && simulator.errors.length > 0
            ? 'Input was rejected. Fix the listed line errors and load again.'
            : 'Load instructions to begin simulation.';
        tbody.innerHTML = `<tr><td colspan="100%" class="py-8 text-center text-slate-500 italic">${message}</td></tr>`;
    }
    
    simulator.instructions.forEach(inst => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-700/50 pipeline-row transition-colors';
        tr.id = `row-${inst.id}`;
        tr.innerHTML = `<td class="instruction-cell py-2 px-3 font-mono text-blue-300 border-r border-slate-700/50">${inst.id}: ${escapeHtml(inst.rawText)}</td>`;
        tbody.appendChild(tr);
    });

    renderHazardLog(simulator);
    renderForwardingLog(simulator);
    drawForwardingArrows(simulator);
}

function updateUI(simulator) {
    // 1. Expand Header with current cycle
    const header = document.getElementById('table-header');
    header.innerHTML = '<th class="instruction-cell py-2 px-3 font-medium border-r border-slate-600">Instruction</th>';
    for (let i = 1; i <= simulator.cycle; i++) {
        const th = document.createElement('th');
        th.className = 'cycle-cell py-2 px-2 font-medium text-center border-r border-slate-600 text-slate-300';
        th.innerText = `C${i}`;
        header.appendChild(th);
    }

    // 2. Render Stage Cells
    simulator.instructions.forEach(inst => {
        const row = document.getElementById(`row-${inst.id}`);
        row.innerHTML = `<td class="instruction-cell py-2 px-3 font-mono text-blue-300 border-r border-slate-700/50">${inst.id}: ${escapeHtml(inst.rawText)}</td>`;
        
        inst.stages.forEach((stage, index) => {
            const td = document.createElement('td');
            td.className = 'cycle-cell py-1 px-1 text-center border-r border-slate-700/50';
            
            if (stage) {
                const cycle = index + 1;
                const span = document.createElement('span');
                const isNew = index === inst.stages.length - 1;
                const popClass = isNew ? ' animate-pop-in' : '';
                const forwardClass = getForwardingCellClass(simulator, inst.id, stage, cycle);
                span.className = `stage-cell block w-full text-xs ${stage === 'ST' ? 'stage-stall' : 'stage-normal'} ${forwardClass}${popClass}`;
                
                const desc = getStageDescription(inst, stage);
                span.innerHTML = `<span class="text-sm font-bold">${stage}</span><span class="text-[0.6rem] font-medium opacity-80 mt-0.5 block whitespace-normal leading-tight">${desc}</span>`;
                
                span.setAttribute('data-cell-id', `${inst.id}-${stage}-${cycle}`);
                span.setAttribute('data-tooltip', `Cycle ${cycle}: ${inst.id} is in ${stage}`);
                td.appendChild(span);
            }
            row.appendChild(td);
        });
    });

    renderHazardLog(simulator);
    renderForwardingLog(simulator);
    drawForwardingArrows(simulator);
}

function getForwardingCellClass(simulator, instructionId, stage, cycle) {
    if (!simulator.visibleForwardingEvents) return '';

    const isSource = simulator.visibleForwardingEvents.some(event =>
        event.fromInstruction === instructionId &&
        event.fromStage === stage &&
        event.fromCycle === cycle
    );
    const isTarget = simulator.visibleForwardingEvents.some(event =>
        event.toInstruction === instructionId &&
        event.toStage === stage &&
        event.toCycle === cycle
    );

    if (isSource && isTarget) return 'stage-forward-source stage-forward-target';
    if (isSource) return 'stage-forward-source';
    if (isTarget) return 'stage-forward-target';
    return '';
}

function renderHazardLog(simulator) {
    const log = document.getElementById('hazard-log');
    if (simulator.errors && simulator.errors.length > 0) {
        log.innerHTML = simulator.errors.map(error => `<li class="text-amber-300 font-mono text-xs">${escapeHtml(error)}</li>`).join('');
    } else if (simulator.hazards.length > 0) {
        log.innerHTML = simulator.hazards.map(h => `<li class="text-red-300 font-mono text-xs">${h}</li>`).join('');
    } else if (simulator.fullHazards && simulator.fullHazards.length > 0 && simulator.cycle === 0) {
        log.innerHTML = '<li class="text-slate-500 italic">Hazards will appear as you step or run.</li>';
    } else {
        log.innerHTML = '<li class="text-slate-500 italic">No hazards detected.</li>';
    }
}

function renderForwardingLog(simulator) {
    const log = document.getElementById('forwarding-log');
    if (!log) return;

    const pipelineName = simulator.pipelineType === 5
        ? '5-stage IF/ID/EX/MEM/WB'
        : '4-stage IF/ID/EX/MEM, where MEM is the combined MEM/WB completion stage';

    const rule = simulator.forwarding
        ? `Assumption: standard single-issue in-order MIPS forwarding on the ${pipelineName} pipeline. ID reads registers and decodes memory offset/base operands. ALU results may be bypassed from EX/MEM or MEM/WB to a later EX input. Load data is available only after MEM, so a direct load-use EX consumer stalls once before MEM/WB -> EX forwarding. Store data is consumed in MEM, so store-data dependencies forward to MEM.`
        : `Forwarding is disabled. RAW hazards are resolved only by stalls. The no-forwarding model assumes no split register access, so a consumer waits until the cycle after the producer reaches WB, or MEM in the 4-stage pipeline.`;

    const visibleEvents = simulator.visibleForwardingEvents || [];
    const allEvents = simulator.forwardingEvents || [];

    let transferContent = '<p class="text-slate-500 italic">No forwarding transfers are active.</p>';
    if (simulator.forwarding && visibleEvents.length > 0) {
        transferContent = `<ul class="space-y-2">${visibleEvents.map(event => `
            <li class="rounded-md border border-amber-300/25 bg-amber-400/10 px-3 py-2">
                <span class="font-mono text-amber-200">${event.register}</span>
                from <span class="font-mono">${event.fromInstruction} ${event.fromStage}</span>
                at C${event.fromCycle} to
                <span class="font-mono">${event.toInstruction} ${event.toStage}</span>
                at C${event.toCycle}
                <span class="block text-xs text-slate-400 mt-1">${event.rule}; ${event.role}.</span>
            </li>
        `).join('')}</ul>`;
    } else if (simulator.forwarding && allEvents.length > 0 && simulator.cycle === 0) {
        transferContent = '<p class="text-slate-500 italic">Forwarding transfers are planned and will appear as you step or auto-run.</p>';
    } else if (simulator.forwarding && simulator.instructions.length > 0) {
        transferContent = '<p class="text-slate-500 italic">No RAW dependency needs forwarding in the visible cycles.</p>';
    }

    log.innerHTML = `
        <p class="text-xs leading-relaxed text-slate-300">${rule}</p>
        ${transferContent}
    `;
}

function drawForwardingArrows(simulator) {
    const viewer = document.getElementById('pipeline-viewer');
    const overlay = document.getElementById('forwarding-overlay');
    if (!viewer || !overlay) return;

    overlay.innerHTML = '';
    overlay.setAttribute('width', viewer.scrollWidth);
    overlay.setAttribute('height', viewer.scrollHeight);
    overlay.style.width = `${viewer.scrollWidth}px`;
    overlay.style.height = `${viewer.scrollHeight}px`;

    const events = simulator.visibleForwardingEvents || [];
    if (events.length === 0) return;

    const namespace = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(namespace, 'defs');
    const marker = document.createElementNS(namespace, 'marker');
    marker.setAttribute('id', 'forward-arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '4');
    marker.setAttribute('orient', 'auto');
    const arrowHead = document.createElementNS(namespace, 'path');
    arrowHead.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
    arrowHead.setAttribute('fill', '#fbbf24');
    marker.appendChild(arrowHead);
    defs.appendChild(marker);
    overlay.appendChild(defs);

    const viewerRect = viewer.getBoundingClientRect();

    events.forEach(event => {
        const fromCell = document.querySelector(`[data-cell-id="${event.fromInstruction}-${event.fromStage}-${event.fromCycle}"]`);
        const toCell = document.querySelector(`[data-cell-id="${event.toInstruction}-${event.toStage}-${event.toCycle}"]`);
        if (!fromCell || !toCell) return;

        const fromRect = fromCell.getBoundingClientRect();
        const toRect = toCell.getBoundingClientRect();
        const x1 = fromRect.left - viewerRect.left + viewer.scrollLeft + fromRect.width * 0.55;
        const y1 = fromRect.top - viewerRect.top + viewer.scrollTop + fromRect.height * 0.5;
        const x2 = toRect.left - viewerRect.left + viewer.scrollLeft + toRect.width * 0.45;
        const y2 = toRect.top - viewerRect.top + viewer.scrollTop + toRect.height * 0.5;
        const midX = (x1 + x2) / 2;
        const lift = Math.max(18, Math.min(48, Math.abs(y2 - y1) + 18));

        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1 - lift}, ${midX} ${y2 - lift}, ${x2} ${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#fbbf24');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('marker-end', 'url(#forward-arrowhead)');

        const title = document.createElementNS(namespace, 'title');
        title.textContent = event.text;
        path.appendChild(title);
        overlay.appendChild(path);
    });
}

// --- Event Listeners ---
const simulator = new PipelineSimulator();

document.getElementById('btn-parse').addEventListener('click', () => {
    const inputText = document.getElementById('instruction-input').value;
    simulator.pipelineType = parseInt(document.getElementById('pipeline-type').value);
    simulator.forwarding = document.getElementById('enable-forwarding').checked;
    
    simulator.loadInstructions(inputText.split('\n'));
    renderInitialTable(simulator);
    
    const hasErrors = simulator.errors.length > 0 || simulator.instructions.length === 0;
    document.getElementById('btn-step').disabled = hasErrors;
    document.getElementById('btn-run').disabled = hasErrors;
    document.getElementById('btn-restart').disabled = hasErrors;
});

document.getElementById('btn-step').addEventListener('click', () => {
    simulator.step();
    updateUI(simulator);
});

document.getElementById('btn-run').addEventListener('click', () => {
    simulator.runToEnd();
    updateUI(simulator);
});

document.getElementById('btn-restart').addEventListener('click', () => {
    simulator.resetRun();
    renderInitialTable(simulator);
});

document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('instruction-input').value = '';
    document.getElementById('preset-dropdown').value = '';
    simulator.instructions = [];
    simulator.cycle = 0;
    simulator.hazards = [];
    simulator.fullHazards = [];
    simulator.forwardingEvents = [];
    simulator.visibleForwardingEvents = [];
    simulator.errors = [];
    renderInitialTable(simulator);
    
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '<tr><td colspan="100%" class="py-8 text-center text-slate-500 italic">Load instructions to begin simulation.</td></tr>';
    
    document.getElementById('btn-step').disabled = true;
    document.getElementById('btn-run').disabled = true;
    document.getElementById('btn-restart').disabled = true;
});

const presets = {
    'raw': 'ADD R1, R2, R3\nSUB R4, R1, R5\nADD R6, R4, R1',
    'store': 'ADD R1, R2, R3\nADD R4, R5, R6\nSW R1, 0(R7)',
    'chain': 'LW R1, 0(R2)\nADD R3, R1, R4\nSUB R5, R3, R6',
    'loaduse': 'LW R1, 0(R2)\nADD R3, R1, R4'
};

document.getElementById('preset-dropdown').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val && presets[val]) {
        document.getElementById('instruction-input').value = presets[val];
    }
});

document.getElementById('pipeline-viewer').addEventListener('scroll', () => {
    drawForwardingArrows(simulator);
});

window.addEventListener('resize', () => {
    drawForwardingArrows(simulator);
});
